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
      const collisionBall = balls[0];
      Object.assign(collisionBall, {
        x: player.x,
        y: player.y - extents.y - collisionBall.radius + 2,
        vx: 0,
        vy: 300,
      });
      const detected = Boolean(getPaddleCollision(collisionBall, player));
      collideWithPaddle(collisionBall, player);
      shapeCollisions[shape] = { detected, reflected: collisionBall.vy < 0 };
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

  const partyResult = await evaluate(session, `(() => {
    const speedOf = (entity) => Math.hypot(entity.vx, entity.vy);
    const clearParty = () => {
      resetPartyState();
      updatePaddleSizes();
      state = STATES.PLAYING;
    };

    returnToMenu();
    document.querySelector('[data-mode="local"]').click();
    const partyButton = document.querySelector('[data-rule="party"]');
    const standardButton = document.querySelector('[data-rule="standard"]');
    partyButton.click();
    const partyFrameBounds = document.querySelector(".game-frame").getBoundingClientRect();
    const partyMenuPanel = document.querySelector(".menu-panel");
    const partyPanelBounds = partyMenuPanel.getBoundingClientRect();
    const partyUi = {
      selectedRule,
      partyChecked: partyButton.getAttribute("aria-checked"),
      standardChecked: standardButton.getAttribute("aria-checked"),
      legendVisible: !document.getElementById("partyLegend").classList.contains("hidden"),
      frameClass: document.querySelector(".game-frame").classList.contains("party-mode"),
      startLabel: document.getElementById("startButton").textContent,
      panelInsideFrame: partyPanelBounds.top >= partyFrameBounds.top
        && partyPanelBounds.bottom <= partyFrameBounds.bottom
        && partyPanelBounds.left >= partyFrameBounds.left
        && partyPanelBounds.right <= partyFrameBounds.right,
      panelScrollable: getComputedStyle(partyMenuPanel).overflowY === "auto",
      controlsFit: [...partyMenuPanel.querySelectorAll("button")].every((button) => (
        button.scrollWidth <= button.clientWidth && button.scrollHeight <= button.clientHeight
      )),
    };

    document.getElementById("startButton").click();
    launchBall();
    document.querySelector('[data-shape="oval"]').click();
    const primaryBall = balls[0];
    const launchSpeed = speedOf(primaryBall);
    const prepareBottomHit = (incomingSpeed) => {
      Object.assign(player, {
        x: GAME.width / 2,
        y: 650,
        targetX: GAME.width / 2,
        targetY: 650,
        vx: 0,
        vy: 0,
        radius: GAME.paddleRadius,
        targetRadius: GAME.paddleRadius,
      });
      const extents = getPaddleExtents(player);
      Object.assign(primaryBall, {
        x: player.x,
        y: player.y - extents.y - primaryBall.radius + 2,
        vx: 0,
        vy: incomingSpeed,
      });
    };
    const hitSamples = [];
    let incomingSpeed = launchSpeed;
    for (let index = 0; index < 2; index += 1) {
      prepareBottomHit(incomingSpeed);
      const before = speedOf(primaryBall);
      const hitCountBefore = primaryBall.hitCount;
      const detected = Boolean(getPaddleCollision(primaryBall, player));
      collideWithPaddle(primaryBall, player);
      const after = speedOf(primaryBall);
      hitSamples.push({
        before,
        after,
        detected,
        reflected: primaryBall.vy < 0,
        hitCountGain: primaryBall.hitCount - hitCountBefore,
      });
      incomingSpeed = after;
    }
    for (const cappedInput of [GAME.ballMaxSpeed - 5, GAME.ballMaxSpeed]) {
      prepareBottomHit(cappedInput);
      const before = speedOf(primaryBall);
      const hitCountBefore = primaryBall.hitCount;
      const detected = Boolean(getPaddleCollision(primaryBall, player));
      collideWithPaddle(primaryBall, player);
      hitSamples.push({
        before,
        after: speedOf(primaryBall),
        detected,
        reflected: primaryBall.vy < 0,
        hitCountGain: primaryBall.hitCount - hitCountBefore,
      });
    }
    Object.assign(primaryBall, {
      x: GAME.wall + primaryBall.radius + 1,
      y: GAME.centerY,
      vx: -300,
      vy: 80,
    });
    const wallSpeedBefore = speedOf(primaryBall);
    const wallEvent = updateBallStep(primaryBall, 0.02);
    const wallBounce = {
      before: wallSpeedBefore,
      after: speedOf(primaryBall),
      reflected: primaryBall.vx > 0,
      scored: Boolean(wallEvent),
    };

    const itemSpawns = {};
    for (const type of PARTY_ITEM_TYPES) {
      partyItems.length = 0;
      const referenceSpeed = getReferenceBallSpeed();
      const item = spawnPartyItem(type);
      itemSpawns[type] = {
        exists: Boolean(item),
        type: item?.type || null,
        radius: item?.radius || null,
        speed: item ? speedOf(item) : null,
        referenceSpeed,
      };
      partyItems.length = 0;
    }

    const itemActivations = {};
    for (const type of PARTY_ITEM_TYPES) {
      clearParty();
      activatePartyEffect(type, "bottom");
      itemActivations[type] = {
        remaining: getEffectRemaining("bottom", type),
        ballCount: balls.length,
        paddleTarget: player.targetRadius,
        topGoalWidth: getGoalWidth("top"),
        bottomGoalWidth: getGoalWidth("bottom"),
        roundRemaining: partyState.round,
        weaponRemaining: partyState.bottom.weapon,
      };
    }

    clearParty();
    activatePartyEffect("paddle", "bottom");
    const firstPaddleTarget = player.targetRadius;
    updatePartyEffects(3);
    const afterDecay = partyState.bottom.paddle;
    activatePartyEffect("paddle", "bottom");
    const afterRefresh = partyState.bottom.paddle;
    const refreshedPaddleTarget = player.targetRadius;
    const frozenEffects = {};
    for (const frozenState of [STATES.COUNTDOWN, STATES.SCORED, STATES.PAUSED]) {
      state = frozenState;
      countdownRemaining = 100;
      scoredTimer = 100;
      const before = partyState.bottom.paddle;
      update(0.4);
      frozenEffects[frozenState] = {
        before,
        after: partyState.bottom.paddle,
      };
    }
    state = STATES.PLAYING;
    updatePartyEffects(1);
    const effectTiming = {
      afterDecay,
      afterRefresh,
      firstPaddleTarget,
      refreshedPaddleTarget,
      frozenEffects,
      afterPlayingSecond: partyState.bottom.paddle,
    };

    clearParty();
    activatePartyEffect("multiball", "bottom");
    const multiball = {
      initialCount: balls.length,
      initialBonusCount: balls.filter((activeBall) => activeBall.isBonus).length,
      initialRemaining: partyState.multiball,
    };
    updatePartyEffects(4);
    activatePartyEffect("multiball", "bottom");
    Object.assign(multiball, {
      refreshedCount: balls.length,
      refreshedBonusCount: balls.filter((activeBall) => activeBall.isBonus).length,
      refreshedRemaining: partyState.multiball,
    });
    updatePartyEffects(GAME.partyEffectSeconds + 0.01);
    Object.assign(multiball, {
      expiredCount: balls.length,
      expiredBonusCount: balls.filter((activeBall) => activeBall.isBonus).length,
      expiredRemaining: partyState.multiball,
    });

    clearParty();
    const baseGoals = { top: getGoalWidth("top"), bottom: getGoalWidth("bottom") };
    activatePartyEffect("goal", "top");
    const topGoalEffect = { top: getGoalWidth("top"), bottom: getGoalWidth("bottom") };
    clearParty();
    activatePartyEffect("goal", "bottom");
    const bottomGoalEffect = { top: getGoalWidth("top"), bottom: getGoalWidth("bottom") };
    const goalWidths = { base: baseGoals, topEffect: topGoalEffect, bottomEffect: bottomGoalEffect };

    clearParty();
    activatePartyEffect("round", "top");
    const roundTimer = partyState.round;
    updateArenaRoundness(1);
    const cornerY = GAME.wall + 36;
    const cornerBounds = getArenaHorizontalBounds(cornerY, GAME.ballRadius);
    const roundEntity = {
      x: cornerBounds.left - 8,
      y: cornerY,
      vx: -240,
      vy: -40,
      radius: GAME.ballRadius,
    };
    const roundSpeedBefore = speedOf(roundEntity);
    const sideCollision = resolveArenaSideCollision(roundEntity, true);
    const resolvedBounds = getArenaHorizontalBounds(roundEntity.y, roundEntity.radius);
    const roundArena = {
      timer: roundTimer,
      roundness: arenaRoundness,
      narrowedAtCorner: cornerBounds.left > GAME.wall + GAME.ballRadius,
      sideCollision,
      insideAfterCollision: roundEntity.x >= resolvedBounds.left - 0.01
        && roundEntity.x <= resolvedBounds.right + 0.01,
      speedBefore: roundSpeedBefore,
      speedAfter: speedOf(roundEntity),
      velocityChanged: roundEntity.vx !== -240 || roundEntity.vy !== -40,
    };
    updatePartyEffects(GAME.partyEffectSeconds + 0.01);
    updateArenaRoundness(1);
    roundArena.expiredTimer = partyState.round;
    roundArena.expiredRoundness = arenaRoundness;

    const exerciseProjectile = (owner) => {
      clearParty();
      resetPositions();
      state = STATES.PLAYING;
      const source = owner === "top" ? cpu : player;
      const targetSide = owner === "top" ? "bottom" : "top";
      const target = targetSide === "top" ? cpu : player;
      source.x = GAME.width / 2;
      source.targetX = source.x;
      target.x = GAME.width / 2;
      target.targetX = target.x;
      Object.assign(balls[0], {
        x: GAME.width / 2,
        y: GAME.centerY,
        vx: 0,
        vy: owner === "top" ? GAME.ballStartSpeed : -GAME.ballStartSpeed,
      });
      activatePartyEffect("weapon", owner);
      const referenceSpeed = getReferenceBallSpeed();
      const fired = fireProjectile(owner);
      const firstShot = projectiles[0] ? { ...projectiles[0] } : null;
      const cooldownStarted = partyState[owner].cooldown;
      const blockedDuringCooldown = !fireProjectile(owner);
      projectiles.length = 0;
      updatePartyEffects(GAME.projectileCooldown + 0.01);
      const cooldownCleared = partyState[owner].cooldown;
      const firedAfterCooldown = fireProjectile(owner);
      const secondShot = projectiles[0] ? { ...projectiles[0] } : null;
      updateProjectiles(3);
      const stunApplied = partyState[targetSide].stun;
      target.targetX = target.x + 80;
      target.targetY = target.y;
      const positionBeforeStunMove = target.x;
      if (targetSide === "top") updateSecondPlayer(0.1);
      else updatePlayer(0.1);
      const stoppedWhileStunned = target.x === positionBeforeStunMove
        && target.vx === 0 && target.vy === 0;
      updatePartyEffects(GAME.projectileStunSeconds + 0.01);
      if (targetSide === "top") updateSecondPlayer(0.1);
      else updatePlayer(0.1);
      return {
        owner,
        fired,
        referenceSpeed,
        firstShot,
        cooldownStarted,
        blockedDuringCooldown,
        cooldownCleared,
        firedAfterCooldown,
        secondShot,
        projectileCountAfterHit: projectiles.length,
        stunApplied,
        stoppedWhileStunned,
        stunAfterRecovery: partyState[targetSide].stun,
        movedAfterRecovery: target.x !== positionBeforeStunMove,
      };
    };
    const projectileTests = {
      bottom: exerciseProjectile("bottom"),
      top: exerciseProjectile("top"),
    };

    clearParty();
    resetPositions();
    state = STATES.PLAYING;
    activatePartyEffect("weapon", "bottom");
    releaseAllPointers();
    const canvas = document.getElementById("gameCanvas");
    const canvasRect = canvas.getBoundingClientRect();
    const pointerPosition = {
      clientX: canvasRect.left + canvasRect.width * 0.35,
      clientY: canvasRect.top + canvasRect.height * 0.78,
    };
    const canvasPoint = (xRatio, yRatio) => ({
      clientX: canvasRect.left + canvasRect.width * xRatio,
      clientY: canvasRect.top + canvasRect.height * yRatio,
    });
    const dispatchTouch = (type, pointerId, position = pointerPosition) => (
      canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      pointerId,
      pointerType: "touch",
      buttons: type === "pointerup" ? 0 : 1,
      clientX: position.clientX,
      clientY: position.clientY,
      }))
    );
    dispatchTouch("pointerdown", 71);
    const ownerAfterFirstDown = sideOwners.get("bottom");
    dispatchTouch("pointerdown", 72);
    const pointerOwnership = {
      ownerAfterFirstDown,
      ownerAfterSecondDown: sideOwners.get("bottom"),
      firstAssignment: activePointers.get(71) || null,
      secondAssignment: activePointers.get(72) || null,
    };
    dispatchTouch("pointerup", 72);
    Object.assign(pointerOwnership, {
      ownerAfterSecondUp: sideOwners.get("bottom"),
      shotCountAfterSecondTap: projectiles.length,
      secondGestureReleased: !pointerGestures.has(72),
    });
    dispatchTouch("pointerup", 71);
    pointerOwnership.pointerCountAfterRelease = activePointers.size;
    pointerOwnership.ownerCountAfterRelease = sideOwners.size;

    const prepareWeaponPointer = () => {
      clearParty();
      resetPositions();
      state = STATES.PLAYING;
      activatePartyEffect("weapon", "bottom");
      partyState.bottom.cooldown = 0;
      projectiles.length = 0;
      releaseAllPointers();
    };
    const paddleSnapshot = () => ({
      x: player.x,
      y: player.y,
      targetX: player.targetX,
      targetY: player.targetY,
    });
    const samePaddleSnapshot = (first, second) => (
      first.x === second.x
      && first.y === second.y
      && first.targetX === second.targetX
      && first.targetY === second.targetY
    );

    prepareWeaponPointer();
    const shortTapPoint = canvasPoint(0.18, 0.8);
    const shortTapBefore = paddleSnapshot();
    dispatchTouch("pointerdown", 73, shortTapPoint);
    const shortTapAfterDown = paddleSnapshot();
    dispatchTouch("pointerup", 73, shortTapPoint);
    const shortTapAfterUp = paddleSnapshot();
    const shortTapShot = projectiles[0] ? { ...projectiles[0] } : null;
    const shortTap = {
      unchangedOnDown: samePaddleSnapshot(shortTapBefore, shortTapAfterDown),
      unchangedOnUp: samePaddleSnapshot(shortTapBefore, shortTapAfterUp),
      shotCount: projectiles.length,
      shot: shortTapShot,
      pointersReleased: activePointers.size === 0 && sideOwners.size === 0,
    };

    prepareWeaponPointer();
    const dragStart = canvasPoint(0.22, 0.8);
    const dragEnd = canvasPoint(0.78, 0.72);
    const dragBefore = paddleSnapshot();
    dispatchTouch("pointerdown", 74, dragStart);
    const dragAfterDown = paddleSnapshot();
    dispatchTouch("pointermove", 74, dragEnd);
    const dragAfterMove = paddleSnapshot();
    dispatchTouch("pointerup", 74, dragEnd);
    const dragGesture = {
      unchangedOnDown: samePaddleSnapshot(dragBefore, dragAfterDown),
      targetMoved: !samePaddleSnapshot(dragAfterDown, dragAfterMove),
      shotCount: projectiles.length,
      pointersReleased: activePointers.size === 0 && sideOwners.size === 0,
      gestureReleased: !pointerGestures.has(74),
    };

    prepareWeaponPointer();
    const releaseStart = canvasPoint(0.2, 0.79);
    const releaseEnd = canvasPoint(0.8, 0.79);
    const releaseDistanceBefore = paddleSnapshot();
    dispatchTouch("pointerdown", 75, releaseStart);
    dispatchTouch("pointerup", 75, releaseEnd);
    const finalReleaseDistance = {
      shotCount: projectiles.length,
      paddleUnchanged: samePaddleSnapshot(releaseDistanceBefore, paddleSnapshot()),
      pointersReleased: activePointers.size === 0 && sideOwners.size === 0,
      gestureReleased: !pointerGestures.has(75),
    };

    prepareWeaponPointer();
    selectMode("cpu");
    const cpuUpperPoint = canvasPoint(0.5, 0.22);
    const cpuUpperBefore = paddleSnapshot();
    const rippleCountBeforeCpuUpper = ripples.length;
    dispatchTouch("pointerdown", 76, cpuUpperPoint);
    const cpuUpperPointer = {
      paddleUnchanged: samePaddleSnapshot(cpuUpperBefore, paddleSnapshot()),
      activePointerCount: activePointers.size,
      ownerCount: sideOwners.size,
      gestureCount: pointerGestures.size,
      projectileCount: projectiles.length,
      rippleCountUnchanged: ripples.length === rippleCountBeforeCpuUpper,
    };
    dispatchTouch("pointerup", 76, cpuUpperPoint);
    selectMode("local");

    const weaponPointerBehavior = {
      shortTap,
      drag: dragGesture,
      finalReleaseDistance,
      cpuUpperPointer,
    };

    const exerciseStunnedRoundConstrain = (side) => {
      clearParty();
      resetPositions();
      state = STATES.PLAYING;
      activatePartyEffect("round", side);
      const paddle = side === "top" ? cpu : player;
      const verticalBounds = getPaddleVerticalBounds(paddle, side);
      paddle.x = -100;
      paddle.y = side === "top" ? verticalBounds.min : verticalBounds.max;
      paddle.targetX = -100;
      paddle.targetY = side === "top" ? -100 : GAME.height + 100;
      paddle.vx = -300;
      paddle.vy = side === "top" ? -300 : 300;
      partyState[side].stun = GAME.projectileStunSeconds;
      if (side === "top") updateSecondPlayer(0.1);
      else updatePlayer(0.1);
      const positionBounds = getPaddleHorizontalBounds(paddle, paddle.y);
      const targetBounds = getPaddleHorizontalBounds(paddle, paddle.targetY);
      const clampedVerticalBounds = getPaddleVerticalBounds(paddle, side);
      return {
        side,
        roundness: arenaRoundness,
        positionInside: paddle.x >= positionBounds.left - 0.01
          && paddle.x <= positionBounds.right + 0.01
          && paddle.y >= clampedVerticalBounds.min - 0.01
          && paddle.y <= clampedVerticalBounds.max + 0.01,
        targetInside: paddle.targetX >= targetBounds.left - 0.01
          && paddle.targetX <= targetBounds.right + 0.01
          && paddle.targetY >= clampedVerticalBounds.min - 0.01
          && paddle.targetY <= clampedVerticalBounds.max + 0.01,
        velocityStopped: paddle.vx === 0 && paddle.vy === 0,
        stunRemaining: partyState[side].stun,
      };
    };
    const stunnedRoundConstrain = {
      top: exerciseStunnedRoundConstrain("top"),
      bottom: exerciseStunnedRoundConstrain("bottom"),
    };

    clearParty();
    resetPositions();
    state = STATES.PLAYING;
    launchBallEntity(ball, -1, GAME.ballStartSpeed);
    activatePartyEffect("multiball", "bottom");
    partyItems.length = 0;
    spawnPartyItem("goal");
    activatePartyEffect("weapon", "bottom");
    fireProjectile("bottom");
    activatePartyEffect("paddle", "bottom");
    activatePartyEffect("round", "top");
    player.targetX = player.x + 80;
    const physicsSnapshot = () => JSON.stringify({
      balls: balls.map((activeBall) => ({ ...activeBall })),
      items: partyItems.map((item) => ({ ...item })),
      projectiles: projectiles.map((projectile) => ({ ...projectile })),
      player: { ...player },
      cpu: { ...cpu },
      partyState: JSON.parse(JSON.stringify(partyState)),
      arenaRoundness,
      partyItemTimer,
    });
    pauseGame();
    const pauseSnapshotBefore = physicsSnapshot();
    update(2);
    const pauseSnapshotAfter = physicsSnapshot();
    const pausePhysics = {
      pausedState: state,
      unchanged: pauseSnapshotBefore === pauseSnapshotAfter,
      ballCount: balls.length,
      itemCount: partyItems.length,
      projectileCount: projectiles.length,
    };
    resumeGame();

    const exerciseGoalCrossing = (goalSide) => {
      clearParty();
      resetPositions();
      playerScore = 0;
      cpuScore = 0;
      updateScoreDisplay();
      state = STATES.PLAYING;
      const activeBall = balls[0];
      const isTop = goalSide === "top";
      const plane = isTop
        ? GAME.wall + activeBall.radius
        : GAME.height - GAME.wall - activeBall.radius;
      Object.assign(activeBall, {
        x: GAME.width / 2,
        y: plane + (isTop ? 1 : -1),
        vx: 0,
        vy: isTop ? -GAME.ballStartSpeed : GAME.ballStartSpeed,
      });
      updateBalls(0.01);
      return {
        side: goalSide,
        state,
        playerScore,
        cpuScore,
        ballY: activeBall.y,
        plane,
        crossedPlane: isTop ? activeBall.y < plane : activeBall.y > plane,
        notFullyExited: isTop
          ? activeBall.y > -activeBall.radius
          : activeBall.y < GAME.height + activeBall.radius,
      };
    };
    const immediateGoals = {
      top: exerciseGoalCrossing("top"),
      bottom: exerciseGoalCrossing("bottom"),
    };

    clearParty();
    resetPositions();
    state = STATES.PLAYING;
    document.querySelector('[data-shape="oval"]').click();
    const interpolationStartX = 190;
    const interpolationEndX = 290;
    const interpolationY = getPaddleHomeY("bottom");
    const probeBall = createBall({ x: GAME.width / 2, y: interpolationY });
    Object.assign(player, {
      x: interpolationStartX,
      y: interpolationY,
      targetX: interpolationStartX,
      targetY: interpolationY,
      vx: 0,
      vy: 0,
      radius: GAME.paddleRadius,
      targetRadius: GAME.paddleRadius,
    });
    const startCollision = Boolean(getPaddleCollision(probeBall, player));
    beginPaddleFrame(1);
    player.x = interpolationEndX;
    player.targetX = interpolationEndX;
    finishPaddleFrame();
    const endCollision = Boolean(getPaddleCollision(probeBall, player));
    positionPaddlesAtFrameProgress(0.5);
    const midpointX = player.x;
    const midpointCollision = Boolean(getPaddleCollision(probeBall, player));
    restorePaddlesAfterPhysics();
    Object.assign(player, {
      x: interpolationStartX,
      y: interpolationY,
      targetX: interpolationStartX,
      targetY: interpolationY,
      vx: 0,
      vy: 0,
    });
    Object.assign(ball, createBall({ x: GAME.width / 2, y: interpolationY }));
    balls.length = 1;
    balls[0] = ball;
    beginPaddleFrame(1);
    player.x = interpolationEndX;
    player.targetX = interpolationEndX;
    finishPaddleFrame();
    updateBalls(1);
    const interpolatedHitCount = ball.hitCount;
    const interpolatedBallSpeed = speedOf(ball);
    restorePaddlesAfterPhysics();
    const paddleInterpolation = {
      startCollision,
      endCollision,
      midpointCollision,
      midpointX,
      interpolatedHitCount,
      interpolatedBallSpeed,
      restoredX: player.x,
      frameMotionCleared: paddleFrameMotion === null,
    };

    clearParty();
    resetPositions();
    state = STATES.PLAYING;
    document.querySelector('[data-shape="oval"]').click();
    const projectileFrameStartX = 190;
    const projectileFrameSavedEndX = 290;
    const projectileFrameY = getPaddleHomeY("bottom");
    Object.assign(player, {
      x: projectileFrameStartX,
      y: projectileFrameY,
      targetX: projectileFrameStartX,
      targetY: projectileFrameY,
      vx: 0,
      vy: 0,
      radius: GAME.paddleRadius,
      targetRadius: GAME.paddleRadius,
    });
    beginPaddleFrame(1);
    player.x = projectileFrameSavedEndX;
    player.targetX = projectileFrameSavedEndX;
    player.vx = projectileFrameSavedEndX - projectileFrameStartX;
    finishPaddleFrame();
    const projectileProbe = {
      owner: "top",
      x: GAME.width / 2,
      y: projectileFrameY,
      vx: 0,
      vy: GAME.ballStartSpeed,
      radius: GAME.projectileRadius,
    };
    const projectileStartsClear = !getPaddleCollision(projectileProbe, {
      ...player,
      x: projectileFrameStartX,
    });
    projectiles.length = 0;
    projectiles.push(projectileProbe);
    updateProjectiles(1);
    const frozenBottomMotion = paddleFrameMotion?.bottom;
    const projectileHitX = player.x;
    const projectileFrameFreeze = {
      startsClear: projectileStartsClear,
      savedEndX: projectileFrameSavedEndX,
      hitX: projectileHitX,
      frozenEndX: frozenBottomMotion?.endX ?? null,
      freezeProgress: frozenBottomMotion?.freezeProgress ?? null,
      frozenEndVx: frozenBottomMotion?.endVx ?? null,
      frozenEndVy: frozenBottomMotion?.endVy ?? null,
      stunApplied: partyState.bottom.stun,
      projectileRemoved: projectiles.length === 0,
    };
    restorePaddlesAfterPhysics();
    Object.assign(projectileFrameFreeze, {
      restoredX: player.x,
      restoredY: player.y,
      restoredVx: player.vx,
      restoredVy: player.vy,
      stoppedBeforeSavedEnd: player.x < projectileFrameSavedEndX,
      frameMotionCleared: paddleFrameMotion === null,
    });

    clearParty();
    resetPositions();
    state = STATES.PLAYING;
    document.querySelector('[data-shape="oval"]').click();
    player.radius = GAME.paddleRadius;
    player.targetRadius = GAME.paddleRadius;
    const baseExtents = getPaddleExtents(player);
    const expandedProbeBall = createBall({
      x: player.x,
      y: player.y - baseExtents.y - GAME.ballRadius - 5,
    });
    beginPaddleFrame(0.01);
    finishPaddleFrame();
    partyItems.length = 0;
    partyItems.push({
      type: "paddle",
      x: player.x,
      y: player.y,
      vx: 0,
      vy: 0,
      radius: GAME.ballRadius,
    });
    updatePartyItems(0.01);
    Object.assign(ball, expandedProbeBall);
    balls.length = 1;
    balls[0] = ball;
    const collisionBeforeFlush = Boolean(getPaddleCollision(ball, player));
    updateBalls(0.01);
    const sameFrameHitCount = ball.hitCount;
    const queuedEffectCount = pendingPartyEffects.length;
    const timerBeforeFlush = partyState.bottom.paddle;
    const radiusBeforeFlush = player.radius;
    restorePaddlesAfterPhysics();
    flushPendingPartyEffects();
    const deferredItemEffect = {
      itemCollected: partyItems.length === 0,
      queuedEffectCount,
      timerBeforeFlush,
      radiusBeforeFlush,
      collisionBeforeFlush,
      sameFrameHitCount,
      timerAfterFlush: partyState.bottom.paddle,
      radiusAfterFlush: player.radius,
      collisionAfterFlush: Boolean(getPaddleCollision(ball, player)),
      pendingAfterFlush: pendingPartyEffects.length,
    };

    clearParty();
    state = STATES.PLAYING;
    activatePartyEffect("multiball", "top");
    activatePartyEffect("round", "top");
    for (const side of ["top", "bottom"]) {
      for (const type of ["paddle", "goal", "weapon"]) activatePartyEffect(type, side);
    }
    updatePartyHud();
    const liveFrameBounds = document.querySelector(".game-frame").getBoundingClientRect();
    const effectContainers = [
      document.getElementById("topEffects"),
      document.getElementById("bottomEffects"),
    ];
    const partyScores = [
      document.querySelector(".score-cpu"),
      document.querySelector(".score-player"),
    ];
    const hudLayout = {
      containersDisplayed: effectContainers.every((element) => getComputedStyle(element).display !== "none"),
      containersInsideFrame: effectContainers.every((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.top >= liveFrameBounds.top - 1
          && bounds.bottom <= liveFrameBounds.bottom + 1
          && bounds.left >= liveFrameBounds.left - 1
          && bounds.right <= liveFrameBounds.right + 1;
      }),
      scoresInsideFrame: partyScores.every((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.top >= liveFrameBounds.top - 1
          && bounds.bottom <= liveFrameBounds.bottom + 1
          && bounds.left >= liveFrameBounds.left - 1
          && bounds.right <= liveFrameBounds.right + 1;
      }),
      contentFits: effectContainers.every((element) => (
        element.scrollWidth <= element.clientWidth + 1
        && element.scrollHeight <= element.clientHeight + 1
        && [...element.children].every((slot) => (
          slot.scrollWidth <= slot.clientWidth + 1 && slot.scrollHeight <= slot.clientHeight + 1
        ))
      )),
      topActiveCount: document.querySelectorAll("#topEffects [data-effect].active").length,
      bottomActiveCount: document.querySelectorAll("#bottomEffects [data-effect].active").length,
    };

    returnToMenu();
    standardButton.click();
    const standardUi = {
      selectedRule,
      standardChecked: standardButton.getAttribute("aria-checked"),
      partyChecked: partyButton.getAttribute("aria-checked"),
      legendHidden: document.getElementById("partyLegend").classList.contains("hidden"),
      frameClassRemoved: !document.querySelector(".game-frame").classList.contains("party-mode"),
      hudHidden: getComputedStyle(document.getElementById("topEffects")).display === "none"
        && getComputedStyle(document.getElementById("bottomEffects")).display === "none",
    };
    document.getElementById("startButton").click();
    launchBall();
    partyItemTimer = 0;
    update(0.02);
    const standardSpawn = spawnPartyItem("paddle");
    partyState.bottom.weapon = GAME.partyEffectSeconds;
    const standardShot = fireProjectile("bottom");
    Object.assign(standardUi, {
      ballCount: balls.length,
      itemCount: partyItems.length,
      projectileCount: projectiles.length,
      spawnBlocked: standardSpawn === null,
      shotBlocked: standardShot === false,
      topGoalWidth: getGoalWidth("top"),
      bottomGoalWidth: getGoalWidth("bottom"),
    });

    return {
      config: {
        ballStartSpeed: GAME.ballStartSpeed,
        ballHitSpeedGain: GAME.ballHitSpeedGain,
        ballMaxSpeed: GAME.ballMaxSpeed,
        ballRadius: GAME.ballRadius,
        paddleRadius: GAME.paddleRadius,
        effectSeconds: GAME.partyEffectSeconds,
        goalWidth: GAME.goalWidth,
        goalScale: GAME.partyGoalScale,
        projectileCooldown: GAME.projectileCooldown,
        projectileStunSeconds: GAME.projectileStunSeconds,
        projectileRadius: GAME.projectileRadius,
      },
      partyUi,
      launch: { speed: launchSpeed, samePrimaryBall: primaryBall === balls[0] },
      hitSamples,
      wallBounce,
      itemSpawns,
      itemActivations,
      effectTiming,
      multiball,
      goalWidths,
      roundArena,
      projectileTests,
      pointerOwnership,
      weaponPointerBehavior,
      stunnedRoundConstrain,
      pausePhysics,
      immediateGoals,
      paddleInterpolation,
      projectileFrameFreeze,
      deferredItemEffect,
      hudLayout,
      standardUi,
    };
  })()`);
  const partyTypes = ["multiball", "paddle", "goal", "round", "weapon"];
  const approximatelyEqual = (left, right, tolerance = 0.02) => (
    Math.abs(left - right) <= tolerance
  );
  const itemSpawnsValid = partyTypes.every((type) => {
    const item = partyResult.itemSpawns[type];
    return item?.exists
      && item.type === type
      && approximatelyEqual(item.radius, partyResult.config.ballRadius)
      && approximatelyEqual(item.speed, item.referenceSpeed);
  });
  const itemActivationsValid = partyTypes.every((type) => (
    approximatelyEqual(
      partyResult.itemActivations[type]?.remaining,
      partyResult.config.effectSeconds,
    )
  ));
  const projectilesValid = [partyResult.projectileTests.bottom, partyResult.projectileTests.top]
    .every((test) => {
      const expectedDirection = test.owner === "top" ? 1 : -1;
      return test.fired
        && test.firstShot
        && Math.sign(test.firstShot.vy) === expectedDirection
        && approximatelyEqual(Math.hypot(test.firstShot.vx, test.firstShot.vy), test.referenceSpeed)
        && approximatelyEqual(test.firstShot.radius, partyResult.config.ballRadius)
        && approximatelyEqual(test.cooldownStarted, partyResult.config.projectileCooldown)
        && test.blockedDuringCooldown
        && approximatelyEqual(test.cooldownCleared, 0)
        && test.firedAfterCooldown
        && test.secondShot
        && Math.sign(test.secondShot.vy) === expectedDirection
        && approximatelyEqual(test.secondShot.radius, partyResult.config.ballRadius)
        && test.projectileCountAfterHit === 0
        && approximatelyEqual(test.stunApplied, partyResult.config.projectileStunSeconds)
        && test.stoppedWhileStunned
        && approximatelyEqual(test.stunAfterRecovery, 0)
        && test.movedAfterRecovery;
    });
  const pointerBehavior = partyResult.weaponPointerBehavior;
  const weaponPointerBehaviorValid = pointerBehavior.shortTap.unchangedOnDown
    && pointerBehavior.shortTap.unchangedOnUp
    && pointerBehavior.shortTap.shotCount === 1
    && approximatelyEqual(pointerBehavior.shortTap.shot?.radius, partyResult.config.ballRadius)
    && pointerBehavior.shortTap.pointersReleased
    && pointerBehavior.drag.unchangedOnDown
    && pointerBehavior.drag.targetMoved
    && pointerBehavior.drag.shotCount === 0
    && pointerBehavior.drag.pointersReleased
    && pointerBehavior.drag.gestureReleased
    && pointerBehavior.finalReleaseDistance.shotCount === 0
    && pointerBehavior.finalReleaseDistance.paddleUnchanged
    && pointerBehavior.finalReleaseDistance.pointersReleased
    && pointerBehavior.finalReleaseDistance.gestureReleased
    && pointerBehavior.cpuUpperPointer.paddleUnchanged
    && pointerBehavior.cpuUpperPointer.activePointerCount === 0
    && pointerBehavior.cpuUpperPointer.ownerCount === 0
    && pointerBehavior.cpuUpperPointer.gestureCount === 0
    && pointerBehavior.cpuUpperPointer.projectileCount === 0
    && pointerBehavior.cpuUpperPointer.rippleCountUnchanged;
  const stunnedRoundConstrainValid = Object.values(partyResult.stunnedRoundConstrain)
    .every((sample) => (
      approximatelyEqual(sample.roundness, 1)
      && sample.positionInside
      && sample.targetInside
      && sample.velocityStopped
      && approximatelyEqual(sample.stunRemaining, partyResult.config.projectileStunSeconds)
    ));
  const immediateGoalsValid = partyResult.immediateGoals.top.state === "SCORED"
    && partyResult.immediateGoals.top.playerScore === 1
    && partyResult.immediateGoals.top.cpuScore === 0
    && partyResult.immediateGoals.top.crossedPlane
    && partyResult.immediateGoals.top.notFullyExited
    && partyResult.immediateGoals.bottom.state === "SCORED"
    && partyResult.immediateGoals.bottom.playerScore === 0
    && partyResult.immediateGoals.bottom.cpuScore === 1
    && partyResult.immediateGoals.bottom.crossedPlane
    && partyResult.immediateGoals.bottom.notFullyExited;
  const paddleInterpolationValid = !partyResult.paddleInterpolation.startCollision
    && !partyResult.paddleInterpolation.endCollision
    && partyResult.paddleInterpolation.midpointCollision
    && approximatelyEqual(partyResult.paddleInterpolation.midpointX, 240)
    && partyResult.paddleInterpolation.interpolatedHitCount >= 1
    && partyResult.paddleInterpolation.interpolatedBallSpeed > 0
    && approximatelyEqual(partyResult.paddleInterpolation.restoredX, 290)
    && partyResult.paddleInterpolation.frameMotionCleared;
  const projectileFrameFreezeValid = partyResult.projectileFrameFreeze.startsClear
    && partyResult.projectileFrameFreeze.projectileRemoved
    && partyResult.projectileFrameFreeze.freezeProgress > 0
    && partyResult.projectileFrameFreeze.freezeProgress < 1
    && partyResult.projectileFrameFreeze.hitX < partyResult.projectileFrameFreeze.savedEndX
    && approximatelyEqual(
      partyResult.projectileFrameFreeze.frozenEndX,
      partyResult.projectileFrameFreeze.hitX,
    )
    && approximatelyEqual(partyResult.projectileFrameFreeze.frozenEndVx, 0)
    && approximatelyEqual(partyResult.projectileFrameFreeze.frozenEndVy, 0)
    && approximatelyEqual(
      partyResult.projectileFrameFreeze.stunApplied,
      partyResult.config.projectileStunSeconds,
    )
    && approximatelyEqual(
      partyResult.projectileFrameFreeze.restoredX,
      partyResult.projectileFrameFreeze.hitX,
    )
    && approximatelyEqual(partyResult.projectileFrameFreeze.restoredVx, 0)
    && approximatelyEqual(partyResult.projectileFrameFreeze.restoredVy, 0)
    && partyResult.projectileFrameFreeze.stoppedBeforeSavedEnd
    && partyResult.projectileFrameFreeze.frameMotionCleared;
  const deferredItemEffectValid = partyResult.deferredItemEffect.itemCollected
    && partyResult.deferredItemEffect.queuedEffectCount === 1
    && approximatelyEqual(partyResult.deferredItemEffect.timerBeforeFlush, 0)
    && approximatelyEqual(
      partyResult.deferredItemEffect.radiusBeforeFlush,
      partyResult.config.paddleRadius,
    )
    && !partyResult.deferredItemEffect.collisionBeforeFlush
    && partyResult.deferredItemEffect.sameFrameHitCount === 0
    && approximatelyEqual(
      partyResult.deferredItemEffect.timerAfterFlush,
      partyResult.config.effectSeconds,
    )
    && partyResult.deferredItemEffect.radiusAfterFlush
      > partyResult.deferredItemEffect.radiusBeforeFlush
    && partyResult.deferredItemEffect.collisionAfterFlush
    && partyResult.deferredItemEffect.pendingAfterFlush === 0;
  if (
    partyResult.partyUi.selectedRule !== "party"
    || partyResult.partyUi.partyChecked !== "true"
    || partyResult.partyUi.standardChecked !== "false"
    || !partyResult.partyUi.legendVisible
    || !partyResult.partyUi.frameClass
    || !partyResult.partyUi.startLabel.includes("パーティー")
    || !partyResult.partyUi.panelInsideFrame
    || !partyResult.partyUi.panelScrollable
    || !partyResult.partyUi.controlsFit
    || !approximatelyEqual(partyResult.launch.speed, partyResult.config.ballStartSpeed)
    || partyResult.launch.speed >= 260
    || !partyResult.launch.samePrimaryBall
    || partyResult.hitSamples.length !== 4
    || !partyResult.hitSamples.every((sample) => (
      sample.detected && sample.reflected && sample.hitCountGain === 1
    ))
    || !approximatelyEqual(
      partyResult.hitSamples[0].after - partyResult.hitSamples[0].before,
      partyResult.config.ballHitSpeedGain,
    )
    || !approximatelyEqual(
      partyResult.hitSamples[1].after - partyResult.hitSamples[1].before,
      partyResult.config.ballHitSpeedGain,
    )
    || !approximatelyEqual(partyResult.hitSamples[2].after, partyResult.config.ballMaxSpeed)
    || !approximatelyEqual(partyResult.hitSamples[3].after, partyResult.config.ballMaxSpeed)
    || !approximatelyEqual(partyResult.wallBounce.before, partyResult.wallBounce.after)
    || !partyResult.wallBounce.reflected
    || partyResult.wallBounce.scored
    || !itemSpawnsValid
    || !itemActivationsValid
    || partyResult.itemActivations.multiball.ballCount !== 3
    || partyResult.itemActivations.paddle.paddleTarget <= partyResult.config.paddleRadius
    || partyResult.itemActivations.goal.bottomGoalWidth >= partyResult.config.goalWidth
    || partyResult.itemActivations.round.roundRemaining <= 0
    || partyResult.itemActivations.weapon.weaponRemaining <= 0
    || !approximatelyEqual(partyResult.effectTiming.afterDecay, 7)
    || !approximatelyEqual(partyResult.effectTiming.afterRefresh, partyResult.config.effectSeconds)
    || !approximatelyEqual(
      partyResult.effectTiming.firstPaddleTarget,
      partyResult.effectTiming.refreshedPaddleTarget,
    )
    || !Object.values(partyResult.effectTiming.frozenEffects).every((sample) => (
      approximatelyEqual(sample.before, sample.after)
    ))
    || !approximatelyEqual(partyResult.effectTiming.afterPlayingSecond, 9)
    || partyResult.multiball.initialCount !== 3
    || partyResult.multiball.initialBonusCount !== 2
    || partyResult.multiball.refreshedCount !== 3
    || partyResult.multiball.refreshedBonusCount !== 2
    || !approximatelyEqual(
      partyResult.multiball.refreshedRemaining,
      partyResult.config.effectSeconds,
    )
    || partyResult.multiball.expiredCount !== 1
    || partyResult.multiball.expiredBonusCount !== 0
    || !approximatelyEqual(partyResult.multiball.expiredRemaining, 0)
    || !approximatelyEqual(partyResult.goalWidths.base.top, partyResult.config.goalWidth)
    || !approximatelyEqual(partyResult.goalWidths.base.bottom, partyResult.config.goalWidth)
    || !approximatelyEqual(
      partyResult.goalWidths.topEffect.top,
      partyResult.config.goalWidth * partyResult.config.goalScale,
    )
    || !approximatelyEqual(partyResult.goalWidths.topEffect.bottom, partyResult.config.goalWidth)
    || !approximatelyEqual(partyResult.goalWidths.bottomEffect.top, partyResult.config.goalWidth)
    || !approximatelyEqual(
      partyResult.goalWidths.bottomEffect.bottom,
      partyResult.config.goalWidth * partyResult.config.goalScale,
    )
    || !approximatelyEqual(partyResult.roundArena.timer, partyResult.config.effectSeconds)
    || !approximatelyEqual(partyResult.roundArena.roundness, 1)
    || !partyResult.roundArena.narrowedAtCorner
    || !partyResult.roundArena.sideCollision
    || !partyResult.roundArena.insideAfterCollision
    || !partyResult.roundArena.velocityChanged
    || !approximatelyEqual(partyResult.roundArena.speedBefore, partyResult.roundArena.speedAfter)
    || !approximatelyEqual(partyResult.roundArena.expiredTimer, 0)
    || !approximatelyEqual(partyResult.roundArena.expiredRoundness, 0)
    || !projectilesValid
    || !approximatelyEqual(partyResult.config.projectileRadius, partyResult.config.ballRadius)
    || partyResult.pointerOwnership.ownerAfterFirstDown !== 71
    || partyResult.pointerOwnership.ownerAfterSecondDown !== 71
    || partyResult.pointerOwnership.firstAssignment !== "bottom"
    || partyResult.pointerOwnership.secondAssignment !== null
    || partyResult.pointerOwnership.ownerAfterSecondUp !== 71
    || partyResult.pointerOwnership.shotCountAfterSecondTap !== 1
    || !partyResult.pointerOwnership.secondGestureReleased
    || partyResult.pointerOwnership.pointerCountAfterRelease !== 0
    || partyResult.pointerOwnership.ownerCountAfterRelease !== 0
    || !weaponPointerBehaviorValid
    || !stunnedRoundConstrainValid
    || partyResult.pausePhysics.pausedState !== "PAUSED"
    || !partyResult.pausePhysics.unchanged
    || partyResult.pausePhysics.ballCount !== 3
    || partyResult.pausePhysics.itemCount !== 1
    || partyResult.pausePhysics.projectileCount !== 1
    || !immediateGoalsValid
    || !paddleInterpolationValid
    || !projectileFrameFreezeValid
    || !deferredItemEffectValid
    || !partyResult.hudLayout.containersDisplayed
    || !partyResult.hudLayout.containersInsideFrame
    || !partyResult.hudLayout.scoresInsideFrame
    || !partyResult.hudLayout.contentFits
    || partyResult.hudLayout.topActiveCount !== 5
    || partyResult.hudLayout.bottomActiveCount !== 5
    || partyResult.standardUi.selectedRule !== "standard"
    || partyResult.standardUi.standardChecked !== "true"
    || partyResult.standardUi.partyChecked !== "false"
    || !partyResult.standardUi.legendHidden
    || !partyResult.standardUi.frameClassRemoved
    || !partyResult.standardUi.hudHidden
    || partyResult.standardUi.ballCount !== 1
    || partyResult.standardUi.itemCount !== 0
    || partyResult.standardUi.projectileCount !== 0
    || !partyResult.standardUi.spawnBlocked
    || !partyResult.standardUi.shotBlocked
    || !approximatelyEqual(partyResult.standardUi.topGoalWidth, partyResult.config.goalWidth)
    || !approximatelyEqual(partyResult.standardUi.bottomGoalWidth, partyResult.config.goalWidth)
  ) {
    throw new Error(`パーティーモードの機能確認に失敗しました: ${JSON.stringify(partyResult)}`);
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
    party: partyResult,
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
