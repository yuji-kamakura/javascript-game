import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const baseUrl = process.argv[2] || "http://127.0.0.1:8765";
const browserPath = process.argv[3]
  || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const profileDirectory = await mkdtemp(join(tmpdir(), "pingpong-browser-test-"));
const browserErrors = [];

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

async function waitForValue(readValue, timeoutMs, errorMessage) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const value = await readValue();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }

  throw lastError || new Error(errorMessage);
}

class CdpSession {
  constructor(webSocketUrl) {
    this.nextId = 0;
    this.pending = new Map();
    this.webSocket = new WebSocket(webSocketUrl);
    this.ready = new Promise((resolveReady, rejectReady) => {
      this.webSocket.addEventListener("open", resolveReady, { once: true });
      this.webSocket.addEventListener("error", () => rejectReady(new Error("CDP WebSocketを開けませんでした。")), { once: true });
    });
    this.webSocket.addEventListener("message", (event) => this.handleMessage(event.data));
  }

  handleMessage(rawMessage) {
    const message = JSON.parse(rawMessage);
    if (message.id && this.pending.has(message.id)) {
      const { resolvePending, rejectPending } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) rejectPending(new Error(message.error.message));
      else resolvePending(message.result);
      return;
    }

    if (message.method === "Runtime.exceptionThrown") {
      browserErrors.push(message.params.exceptionDetails.text);
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      browserErrors.push(message.params.args.map((argument) => argument.value || argument.description).join(" "));
    }
  }

  async send(method, params = {}) {
    await this.ready;
    const id = ++this.nextId;
    const response = new Promise((resolvePending, rejectPending) => {
      this.pending.set(id, { resolvePending, rejectPending });
    });
    this.webSocket.send(JSON.stringify({ id, method, params }));
    return response;
  }

  close() {
    this.webSocket.close();
  }
}

async function evaluate(session, expression, options = {}) {
  const response = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: Boolean(options.awaitPromise),
    returnByValue: true,
    userGesture: Boolean(options.userGesture),
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
  return response.result.value;
}

const browserProcess = spawn(browserPath, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=0",
  `--user-data-dir=${profileDirectory}`,
  "about:blank",
], {
  stdio: ["ignore", "ignore", "pipe"],
  windowsHide: true,
});

let browserStderr = "";
browserProcess.stderr.on("data", (chunk) => {
  browserStderr += chunk.toString();
});

let session;
let guestSession;
let browserSession;
try {
  const activePortFile = join(profileDirectory, "DevToolsActivePort");
  const [port, browserWebSocketPath] = await waitForValue(async () => {
    const contents = await readFile(activePortFile, "utf8");
    const lines = contents.trim().split(/\r?\n/);
    return lines.length >= 2 ? lines : null;
  }, 10000, "ブラウザのデバッグポートを取得できませんでした。");
  browserSession = new CdpSession(`ws://127.0.0.1:${port}${browserWebSocketPath}`);
  await browserSession.ready;

  const targetResponse = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${baseUrl}/tests/webrtc-loopback.html`)}`,
    { method: "PUT" },
  );
  if (!targetResponse.ok) throw new Error(`テストタブを作成できませんでした: HTTP ${targetResponse.status}`);
  const target = await targetResponse.json();
  session = new CdpSession(target.webSocketDebuggerUrl);
  await session.send("Runtime.enable");
  await session.send("Page.enable");

  const loopbackResult = await waitForValue(async () => {
    const value = await evaluate(session, `(() => {
      const result = document.getElementById("result")?.textContent;
      if (result !== "PASS" && result !== "FAIL") return null;
      return {
        result,
        details: document.getElementById("details")?.textContent || "",
      };
    })()`);
    return value;
  }, 30000, "WebRTCループバックテストが完了しませんでした。");
  if (loopbackResult.result !== "PASS") throw new Error(loopbackResult.details || "WebRTCループバックテストに失敗しました。");

  await session.send("Page.navigate", { url: `${baseUrl}/index.html` });
  await waitForValue(
    () => evaluate(session, "document.readyState === 'complete'"),
    10000,
    "ゲーム画面の読み込みが完了しませんでした。",
  );

  const initialUi = await evaluate(session, `(() => ({
    canvas: Boolean(document.getElementById("gameCanvas")),
    menuVisible: !document.getElementById("menu")?.classList.contains("hidden"),
    createLabel: document.getElementById("createConnectionButton")?.textContent.trim(),
    joinLabel: document.getElementById("joinConnectionButton")?.textContent.trim(),
  }))()`);
  if (!initialUi.canvas || !initialUi.menuVisible) throw new Error("1人用ゲームの初期画面を確認できませんでした。");
  if (initialUi.createLabel !== "接続実験を作る" || initialUi.joinLabel !== "接続実験に参加する") {
    throw new Error("接続実験ボタンを確認できませんでした。");
  }

  await evaluate(session, "document.getElementById('createConnectionButton').click()", { userGesture: true });
  const offerUi = await waitForValue(async () => {
    const value = await evaluate(session, `(() => ({
      offer: document.getElementById("offerOutput")?.value || "",
      pingHidden: document.getElementById("sendPingButton")?.classList.contains("hidden"),
      error: document.getElementById("connectionMessage")?.classList.contains("error"),
      message: document.getElementById("connectionMessage")?.textContent || "",
    }))()`);
    if (value.error) throw new Error(value.message);
    return value.offer ? value : null;
  }, 20000, "画面からOfferを生成できませんでした。");
  if (!offerUi.pingHidden) throw new Error("未接続時にpingボタンが非表示になっていません。");
  const offerSignal = JSON.parse(offerUi.offer);
  if (!offerSignal.description.sdp.includes("a=candidate:")) {
    throw new Error("生成したOfferにICE Candidateがありません。");
  }

  const guestTargetResponse = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${baseUrl}/index.html`)}`,
    { method: "PUT" },
  );
  if (!guestTargetResponse.ok) throw new Error(`参加側タブを作成できませんでした: HTTP ${guestTargetResponse.status}`);
  const guestTarget = await guestTargetResponse.json();
  guestSession = new CdpSession(guestTarget.webSocketDebuggerUrl);
  await guestSession.send("Runtime.enable");
  await guestSession.send("Page.enable");
  await guestSession.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  await waitForValue(
    () => evaluate(guestSession, "document.readyState === 'complete'"),
    10000,
    "参加側画面の読み込みが完了しませんでした。",
  );

  await evaluate(guestSession, "document.getElementById('joinConnectionButton').click()", { userGesture: true });
  const mobileLayout = await evaluate(guestSession, `(() => {
    const frame = document.querySelector(".game-frame").getBoundingClientRect();
    const panel = document.querySelector(".connection-panel").getBoundingClientRect();
    return {
      width: innerWidth,
      height: innerHeight,
      panelInsideFrame: panel.top >= frame.top && panel.bottom <= frame.bottom,
      panelScrollable: getComputedStyle(document.querySelector(".connection-panel")).overflowY === "auto",
    };
  })()`);
  if (!mobileLayout.panelInsideFrame || !mobileLayout.panelScrollable) {
    throw new Error("スマートフォン縦画面で接続パネルを安全に表示できません。");
  }
  await evaluate(guestSession, `(() => {
    document.getElementById("offerInput").value = ${JSON.stringify(offerUi.offer)};
    document.getElementById("createAnswerButton").click();
  })()`, { userGesture: true });
  const answerUi = await waitForValue(async () => {
    const value = await evaluate(guestSession, `(() => ({
      answer: document.getElementById("answerOutput")?.value || "",
      error: document.getElementById("connectionMessage")?.classList.contains("error"),
      message: document.getElementById("connectionMessage")?.textContent || "",
    }))()`);
    if (value.error) throw new Error(value.message);
    return value.answer ? value : null;
  }, 20000, "画面からAnswerを生成できませんでした。");

  await evaluate(session, `(() => {
    document.getElementById("answerInput").value = ${JSON.stringify(answerUi.answer)};
    document.getElementById("applyAnswerButton").click();
  })()`, { userGesture: true });

  const connectionExpression = `(() => ({
    peer: document.getElementById("peerConnectionState")?.textContent,
    control: document.getElementById("controlChannelState")?.textContent,
    realtime: document.getElementById("realtimeChannelState")?.textContent,
    rtt: document.getElementById("connectionRtt")?.textContent,
    pingHidden: document.getElementById("sendPingButton")?.classList.contains("hidden"),
    error: document.getElementById("connectionMessage")?.classList.contains("error"),
    message: document.getElementById("connectionMessage")?.textContent || "",
  }))()`;
  const manualConnection = await waitForValue(async () => {
    const hostState = await evaluate(session, connectionExpression);
    const guestState = await evaluate(guestSession, connectionExpression);
    if (hostState.error) throw new Error(`作成側: ${hostState.message}`);
    if (guestState.error) throw new Error(`参加側: ${guestState.message}`);
    const bothOpen = [hostState, guestState].every((state) => (
      state.peer === "connected"
      && state.control === "open"
      && state.realtime === "open"
      && state.rtt !== "—"
      && !state.pingHidden
    ));
    return bothOpen ? { host: hostState, guest: guestState } : null;
  }, 20000, "コピー＆貼り付け接続が完了しませんでした。");

  await evaluate(session, "document.getElementById('sendPingButton').click()", { userGesture: true });
  await delay(100);
  await evaluate(guestSession, "document.getElementById('closeConnectionButton').click()", { userGesture: true });
  const disconnectDisplay = await waitForValue(async () => {
    const state = await evaluate(session, connectionExpression);
    const disconnected = state.error
      && state.message.includes("切断")
      && state.peer === "failed"
      && state.control === "closed"
      && state.realtime === "closed"
      && state.pingHidden;
    return disconnected ? state.message : null;
  }, 6000, "相手の切断が作成側画面に表示されませんでした。");
  await evaluate(session, "document.getElementById('closeConnectionButton').click()", { userGesture: true });

  await session.send("Page.bringToFront");
  const soloResult = await evaluate(session, `(async () => {
    document.getElementById("startButton").click();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    const canvas = document.getElementById("gameCanvas");
    const rect = canvas.getBoundingClientRect();
    const playerBefore = { x: player.x, y: player.y, targetX: player.targetX, targetY: player.targetY };
    canvas.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + rect.width * 0.75,
      clientY: rect.top + rect.height * 0.78,
      pointerType: "mouse",
    }));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
    return {
      menuHidden: document.getElementById("menu").classList.contains("hidden"),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      playerBefore,
      playerAfter: { x: player.x, y: player.y, targetX: player.targetX, targetY: player.targetY },
    };
  })()`, { awaitPromise: true, userGesture: true });
  if (
    !soloResult.menuHidden
    || soloResult.canvasWidth <= 0
    || soloResult.canvasHeight <= 0
    || soloResult.playerAfter.targetX === soloResult.playerBefore.targetX
    || soloResult.playerAfter.x === soloResult.playerBefore.x
  ) {
    throw new Error(`1人用ゲームを開始・操作できませんでした: ${JSON.stringify(soloResult)}`);
  }
  if (browserErrors.length) throw new Error(`ブラウザ例外: ${browserErrors.join(" | ")}`);

  console.log(JSON.stringify({
    loopback: JSON.parse(loopbackResult.details),
    offerHasCandidate: true,
    manualConnection,
    disconnectDisplay,
    mobileLayout,
    solo: soloResult,
    browserExceptions: 0,
  }, null, 2));
} catch (error) {
  const debugHint = browserProcess.exitCode === null ? "" : `\nBrowser exit: ${browserProcess.exitCode}\n${browserStderr}`;
  console.error(`${error.stack || error.message}${debugHint}`);
  process.exitCode = 1;
} finally {
  session?.close();
  guestSession?.close();
  if (browserSession) {
    try {
      await Promise.race([
        browserSession.send("Browser.close"),
        delay(1000),
      ]);
    } catch {
      // ブラウザが先に終了した場合は、そのまま後片付けを続ける。
    }
    browserSession.close();
  }
  await Promise.race([
    new Promise((resolveExit) => {
      if (browserProcess.exitCode !== null) resolveExit();
      else browserProcess.once("exit", resolveExit);
    }),
    delay(5000),
  ]);
  if (browserProcess.exitCode === null) browserProcess.kill();
  await delay(500);

  const resolvedProfile = resolve(profileDirectory);
  const resolvedTemp = resolve(tmpdir());
  if (dirname(resolvedProfile) === resolvedTemp && basename(resolvedProfile).startsWith("pingpong-browser-test-")) {
    await rm(resolvedProfile, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    });
  } else {
    throw new Error(`一時プロファイルのパスが不正です: ${resolvedProfile}`);
  }
}
