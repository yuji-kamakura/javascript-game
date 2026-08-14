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
  await session.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });
  const localResult = await evaluate(session, `(async () => {
    const frameBounds = document.querySelector(".game-frame").getBoundingClientRect();
    const menuPanel = document.querySelector(".menu-panel");
    const panelBounds = menuPanel.getBoundingClientRect();
    const menuButtons = [...menuPanel.querySelectorAll("button")];
    const menuLayout = {
      viewport: { width: innerWidth, height: innerHeight },
      panelInsideFrame: panelBounds.top >= frameBounds.top
        && panelBounds.bottom <= frameBounds.bottom
        && panelBounds.left >= frameBounds.left
        && panelBounds.right <= frameBounds.right,
      panelScrollable: getComputedStyle(menuPanel).overflowY === "auto",
      controlsFit: menuButtons.every((button) => (
        button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight
      )),
    };
    const localUi = {
      selectedMode,
      topLabel: document.getElementById("topPlayerLabel").textContent,
      bottomLabel: document.getElementById("bottomPlayerLabel").textContent,
      difficultyHidden: document.getElementById("difficultySettings").classList.contains("hidden"),
      topScoreRotated: getComputedStyle(document.querySelector(".score-cpu")).transform !== "none",
      topPauseActionsVisible: getComputedStyle(document.querySelector(".top-pause-actions")).display !== "none",
    };
    const shapeVertexCounts = {};
    const shapeCollisions = {};
    for (const shape of ["oval", "rect", "star"]) {
      document.querySelector('[data-shape="' + shape + '"]').click();
      shapeVertexCounts[shape] = getPaddleVertices(player).length;
      Object.assign(player, {
        x: GAME.width / 2,
        y: 650,
        vx: 0,
        vy: 0,
        radius: GAME.paddleRadius,
        targetRadius: GAME.paddleRadius,
      });
      const extents = getPaddleExtents(player);
      Object.assign(ball, {
        x: player.x,
        y: player.y - extents.y - ball.radius + 2,
        vx: 0,
        vy: 300,
      });
      const detected = Boolean(getPaddleCollision(player));
      collideWithPaddle(player);
      shapeCollisions[shape] = { detected, reflected: ball.vy < 0 };
    }
    const topExtents = getPaddleExtents(cpu);
    const topMinimumY = GAME.wall + 52 + topExtents.y;
    Object.assign(cpu, {
      x: GAME.width / 2,
      y: topMinimumY,
      targetX: GAME.width / 2,
      targetY: 0,
      vx: 0,
      vy: 0,
    });
    movePaddle(cpu, cpu.targetX, cpu.targetY, 410, 0.033);
    constrainPaddle(cpu, "top");
    const boundaryMotion = { y: cpu.y, minimumY: topMinimumY, vy: cpu.vy };
    document.getElementById("startButton").click();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    const canvas = document.getElementById("gameCanvas");
    const rect = canvas.getBoundingClientRect();
    const before = {
      top: { x: cpu.x, y: cpu.y, targetX: cpu.targetX, targetY: cpu.targetY },
      bottom: { x: player.x, y: player.y, targetX: player.targetX, targetY: player.targetY },
    };
    canvas.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 41,
      pointerType: "touch",
      buttons: 1,
      clientX: rect.left + rect.width * 0.2,
      clientY: rect.top + rect.height * 0.22,
    }));
    canvas.dispatchEvent(new PointerEvent("pointerdown", {
      bubbles: true,
      pointerId: 42,
      pointerType: "touch",
      buttons: 1,
      clientX: rect.left + rect.width * 0.75,
      clientY: rect.top + rect.height * 0.78,
    }));
    canvas.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      pointerId: 41,
      pointerType: "touch",
      buttons: 1,
      clientX: rect.left + rect.width * 0.82,
      clientY: rect.top + rect.height * 0.74,
    }));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));

    const liveFrameBounds = document.querySelector(".game-frame").getBoundingClientRect();
    const scoreBounds = [
      document.querySelector(".score-cpu").getBoundingClientRect(),
      document.querySelector(".score-player").getBoundingClientRect(),
    ];
    const canvasPixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let paintedSamples = 0;
    for (let index = 3; index < canvasPixels.length; index += 1600) {
      if (canvasPixels[index] > 0) paintedSamples += 1;
    }
    const playLayout = {
      scoresInsideFrame: scoreBounds.every((bounds) => (
        bounds.top >= liveFrameBounds.top
        && bounds.bottom <= liveFrameBounds.bottom
        && bounds.left >= liveFrameBounds.left
        && bounds.right <= liveFrameBounds.right
      )),
      paintedSamples,
    };
    const pointerAssignments = Object.fromEntries(activePointers);
    const afterMovement = {
      top: { x: cpu.x, y: cpu.y, targetX: cpu.targetX, targetY: cpu.targetY },
      bottom: { x: player.x, y: player.y, targetX: player.targetX, targetY: player.targetY },
    };
    playerScore = 0;
    cpuScore = 2;
    updateScoreDisplay();
    const smallHandicap = {
      player: player.targetRadius,
      top: cpu.targetRadius,
      label: document.getElementById("bottomHandicap").textContent,
    };
    beginCountdown();
    animatePaddleSizes(1);
    smallHandicap.afterReset = player.targetRadius;
    smallHandicap.liveRadius = player.radius;
    playerScore = 3;
    cpuScore = 0;
    updateScoreDisplay();
    const largeHandicap = {
      player: player.targetRadius,
      top: cpu.targetRadius,
      label: document.getElementById("topHandicap").textContent,
    };
    for (const pointerId of [41, 42]) {
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        pointerId,
        pointerType: "touch",
      }));
    }
    state = STATES.PLAYING;
    playerScore = 0;
    cpuScore = GAME.winScore - 1;
    scorePoint("cpu");
    const topWinnerResult = {
      facingTop: document.getElementById("gameOver").classList.contains("facing-top"),
      text: document.getElementById("resultText").textContent,
    };
    return {
      menuLayout,
      playLayout,
      localUi,
      shapeVertexCounts,
      shapeCollisions,
      boundaryMotion,
      menuHidden: document.getElementById("menu").classList.contains("hidden"),
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      before,
      after: afterMovement,
      pointerAssignments,
      pointerCountAfterRelease: activePointers.size,
      smallHandicap,
      largeHandicap,
      topWinnerResult,
    };
  })()`, { awaitPromise: true, userGesture: true });
  if (
    localResult.menuLayout.viewport.width !== 390
    || localResult.menuLayout.viewport.height !== 844
    || !localResult.menuLayout.panelInsideFrame
    || !localResult.menuLayout.panelScrollable
    || !localResult.menuLayout.controlsFit
    || !localResult.playLayout.scoresInsideFrame
    || localResult.playLayout.paintedSamples <= 0
    || localResult.localUi.selectedMode !== "local"
    || localResult.localUi.topLabel !== "2P"
    || localResult.localUi.bottomLabel !== "1P"
    || !localResult.localUi.difficultyHidden
    || !localResult.localUi.topScoreRotated
    || !localResult.localUi.topPauseActionsVisible
    || localResult.shapeVertexCounts.oval !== 28
    || localResult.shapeVertexCounts.rect !== 4
    || localResult.shapeVertexCounts.star !== 10
    || !Object.values(localResult.shapeCollisions).every((collision) => (
      collision.detected && collision.reflected
    ))
    || Math.abs(localResult.boundaryMotion.y - localResult.boundaryMotion.minimumY) > 0.01
    || localResult.boundaryMotion.vy !== 0
    || !localResult.menuHidden
    || localResult.canvasWidth <= 0
    || localResult.canvasHeight <= 0
    || localResult.pointerAssignments[41] !== "top"
    || localResult.pointerAssignments[42] !== "bottom"
    || localResult.after.top.targetX === localResult.before.top.targetX
    || localResult.after.bottom.targetX === localResult.before.bottom.targetX
    || localResult.after.top.targetY >= 400
    || localResult.pointerCountAfterRelease !== 0
    || Math.abs(localResult.smallHandicap.player - 39.1) > 0.01
    || Math.abs(localResult.smallHandicap.afterReset - 39.1) > 0.01
    || Math.abs(localResult.smallHandicap.liveRadius - 39.1) > 0.01
    || localResult.smallHandicap.top !== 34
    || localResult.smallHandicap.label !== "RACKET +15%"
    || localResult.largeHandicap.player !== 34
    || Math.abs(localResult.largeHandicap.top - 44.2) > 0.01
    || localResult.largeHandicap.label !== "RACKET +30%"
    || !localResult.topWinnerResult.facingTop
    || localResult.topWinnerResult.text !== "2Pの勝ち！"
  ) {
    throw new Error(`2人用ゲームの機能確認に失敗しました: ${JSON.stringify(localResult)}`);
  }

  const soloResult = await evaluate(session, `(async () => {
    returnToMenu();
    document.querySelector('[data-mode="cpu"]').click();
    const modeUi = {
      selectedMode,
      topLabel: document.getElementById("topPlayerLabel").textContent,
      difficultyHidden: document.getElementById("difficultySettings").classList.contains("hidden"),
      topPauseActionsHidden: getComputedStyle(document.querySelector(".top-pause-actions")).display === "none",
    };
    document.getElementById("startButton").click();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150));
    const canvas = document.getElementById("gameCanvas");
    const rect = canvas.getBoundingClientRect();
    const playerBefore = { x: player.x, targetX: player.targetX };
    canvas.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + rect.width * 0.75,
      clientY: rect.top + rect.height * 0.78,
      pointerType: "mouse",
    }));
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
    return {
      modeUi,
      playerBefore,
      playerAfter: { x: player.x, targetX: player.targetX },
    };
  })()`, { awaitPromise: true, userGesture: true });
  if (
    soloResult.modeUi.selectedMode !== "cpu"
    || soloResult.modeUi.topLabel !== "CPU"
    || soloResult.modeUi.difficultyHidden
    || !soloResult.modeUi.topPauseActionsHidden
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
    local: localResult,
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
