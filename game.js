"use strict";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const gameFrame = document.querySelector(".game-frame");
const cpuScoreElement = document.getElementById("cpuScore");
const playerScoreElement = document.getElementById("playerScore");
const topPlayerLabel = document.getElementById("topPlayerLabel");
const bottomPlayerLabel = document.getElementById("bottomPlayerLabel");
const topHandicapElement = document.getElementById("topHandicap");
const bottomHandicapElement = document.getElementById("bottomHandicap");
const menuElement = document.getElementById("menu");
const gameOverElement = document.getElementById("gameOver");
const resultTextElement = document.getElementById("resultText");
const finalScoreElement = document.getElementById("finalScore");
const startButton = document.getElementById("startButton");
const restartButton = document.getElementById("restartButton");
const resultMenuButton = document.getElementById("resultMenuButton");
const pauseMenuElement = document.getElementById("pauseMenu");
const resumeButton = document.getElementById("resumeButton");
const quitButton = document.getElementById("quitButton");
const topResumeButton = document.getElementById("topResumeButton");
const topQuitButton = document.getElementById("topQuitButton");
const headerMenuButton = document.getElementById("headerMenuButton");
const hardLevelPanel = document.getElementById("hardLevelPanel");
const hardLevelLabel = document.getElementById("hardLevelLabel");
const difficultySettings = document.getElementById("difficultySettings");
const difficultyButtons = [...document.querySelectorAll(".difficulty")];
const hardLevelButtons = [...document.querySelectorAll(".level")];
const modeButtons = [...document.querySelectorAll(".mode-choice")];
const shapeButtons = [...document.querySelectorAll(".shape-choice")];
const controlHelp = document.getElementById("controlHelp");

const GAME = Object.freeze({
  width: 480,
  height: 800,
  wall: 18,
  goalWidth: 160,
  winScore: 5,
  centerY: 400,
  countdownSeconds: 3,
  scoredPause: 0.75,
  paddleRadius: 34,
  playerMaxSpeed: 650,
  ballRadius: 10,
  ballStartSpeed: 310,
  ballMinSpeed: 260,
  ballMaxSpeed: 660,
  ballMinVerticalSpeed: 125,
  handicapSmall: 1.15,
  handicapLarge: 1.3,
});

const PADDLE_SHAPES = Object.freeze({
  oval: { radiusX: 1.08, radiusY: 0.88, vertices: 28 },
  rect: { radiusX: 1.36, radiusY: 0.66, vertices: 4 },
  star: { radiusX: 1.12, radiusY: 1.12, vertices: 10, innerRatio: 0.5 },
});

const STATES = Object.freeze({
  MENU: "MENU",
  COUNTDOWN: "COUNTDOWN",
  PLAYING: "PLAYING",
  SCORED: "SCORED",
  GAME_OVER: "GAME_OVER",
  PAUSED: "PAUSED",
});

const DIFFICULTIES = Object.freeze({
  easy: { reaction: 0.34, speed: 190, error: 38 },
  normal: { reaction: 0.2, speed: 270, error: 23 },
  hard: [
    { reaction: 0.14, speed: 315, error: 18 },
    { reaction: 0.12, speed: 335, error: 15 },
    { reaction: 0.1, speed: 355, error: 13 },
    { reaction: 0.08, speed: 380, error: 10 },
    { reaction: 0.06, speed: 410, error: 8 },
  ],
});

const HARD_PADDLE_COLORS = Object.freeze([
  { fill: "#f8f8f4", rim: "#aab4c0", glow: "rgba(213, 235, 255, 0.3)" },
  { fill: "#ffe44d", rim: "#b58c00", glow: "rgba(255, 228, 77, 0.42)" },
  { fill: "#ff72c6", rim: "#a91e72", glow: "rgba(255, 70, 184, 0.48)" },
  { fill: "#e32636", rim: "#721018", glow: "rgba(255, 30, 48, 0.58)" },
  { fill: "#15171b", rim: "#d8dde5", glow: "rgba(178, 44, 255, 0.75)" },
]);

let state = STATES.MENU;
let selectedDifficulty = "normal";
let selectedHardLevel = 1;
let selectedMode = "local";
let selectedShape = "oval";
let playerScore = 0;
let cpuScore = 0;
let countdownRemaining = GAME.countdownSeconds;
let scoredTimer = 0;
let nextServeDirection = -1;
let lastTime = performance.now();
let stateBeforePause = STATES.PLAYING;
let gameOverRevealTimer = 0;
let audioContext = null;
let bgmTimer = null;
let bgmStep = 0;
const activePointers = new Map();
const sideOwners = new Map();

const soundCooldowns = {
  paddle: 0,
  wall: 0,
  goal: 0,
};

const player = createPaddle(GAME.width / 2, 650);
const cpu = createPaddle(GAME.width / 2, 132);
const ball = {
  x: GAME.width / 2,
  y: GAME.height / 2,
  vx: 0,
  vy: 0,
  radius: GAME.ballRadius,
};

const cpuControl = {
  timer: 0,
  targetX: cpu.x,
  targetY: cpu.y,
};

const ripples = [];

function createPaddle(x, y) {
  return {
    x,
    y,
    targetX: x,
    targetY: y,
    vx: 0,
    vy: 0,
    radius: GAME.paddleRadius,
    targetRadius: GAME.paddleRadius,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getArenaDifficulty() {
  return selectedMode === "local" ? "normal" : selectedDifficulty;
}

function getPaddleVertices(paddle, yOffset = 0, scale = 1) {
  const shape = PADDLE_SHAPES[selectedShape];
  const radiusX = paddle.radius * shape.radiusX * scale;
  const radiusY = paddle.radius * shape.radiusY * scale;
  const points = [];

  if (selectedShape === "rect") {
    return [
      { x: paddle.x - radiusX, y: paddle.y + yOffset - radiusY },
      { x: paddle.x + radiusX, y: paddle.y + yOffset - radiusY },
      { x: paddle.x + radiusX, y: paddle.y + yOffset + radiusY },
      { x: paddle.x - radiusX, y: paddle.y + yOffset + radiusY },
    ];
  }

  for (let index = 0; index < shape.vertices; index += 1) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / shape.vertices;
    const pointScale = selectedShape === "star" && index % 2 === 1
      ? shape.innerRatio
      : 1;
    points.push({
      x: paddle.x + Math.cos(angle) * radiusX * pointScale,
      y: paddle.y + yOffset + Math.sin(angle) * radiusY * pointScale,
    });
  }
  return points;
}

function getPaddleExtents(paddle) {
  const vertices = getPaddleVertices(paddle);
  return vertices.reduce((extents, point) => ({
    x: Math.max(extents.x, Math.abs(point.x - paddle.x)),
    y: Math.max(extents.y, Math.abs(point.y - paddle.y)),
  }), { x: 0, y: 0 });
}

function tracePolygon(points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
}

function enableAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
  } catch {
    audioContext = null;
  }
}

function playTone(frequency, duration, options = {}) {
  if (!audioContext || audioContext.state !== "running") return;

  try {
    const startAt = audioContext.currentTime + (options.delay || 0);
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = options.type || "sine";
    oscillator.frequency.setValueAtTime(frequency, startAt);
    if (options.endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, startAt + duration);
    }
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(options.volume || 0.09, startAt + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.01);
  } catch {
    // 音声機能の失敗がゲーム進行へ影響しないようにする。
  }
}

function playSound(name) {
  if (!audioContext || audioContext.state !== "running") return;

  const now = performance.now();
  const cooldown = name === "paddle" ? 65 : name === "wall" ? 45 : 160;
  if (name in soundCooldowns) {
    if (now < soundCooldowns[name]) return;
    soundCooldowns[name] = now + cooldown;
  }

  if (name === "paddle") {
    playTone(240, 0.055, { type: "square", endFrequency: 165, volume: 0.07 });
  } else if (name === "wall") {
    playTone(620, 0.035, { type: "triangle", endFrequency: 460, volume: 0.045 });
  } else if (name === "goal") {
    playTone(190, 0.14, { type: "sawtooth", endFrequency: 95, volume: 0.075 });
    playTone(380, 0.11, { type: "triangle", endFrequency: 260, volume: 0.05, delay: 0.04 });
  } else if (name === "win") {
    playTone(392, 0.14, { type: "triangle", volume: 0.07 });
    playTone(523, 0.16, { type: "triangle", volume: 0.075, delay: 0.12 });
    playTone(659, 0.24, { type: "triangle", volume: 0.08, delay: 0.25 });
  } else if (name === "lose") {
    playTone(294, 0.18, { type: "sawtooth", endFrequency: 247, volume: 0.055 });
    playTone(220, 0.28, { type: "sawtooth", endFrequency: 147, volume: 0.06, delay: 0.16 });
  }
}

function vibrate(duration) {
  try {
    if (typeof navigator.vibrate === "function") navigator.vibrate(duration);
  } catch {
    // 振動非対応・拒否時もゲームは継続する。
  }
}

function getBgmTrack() {
  const arenaDifficulty = getArenaDifficulty();
  if (arenaDifficulty === "easy") {
    return {
      interval: 480,
      type: "triangle",
      volume: 0.018,
      notes: [261.63, 329.63, 392, 329.63, 293.66, 349.23, 392, 329.63],
    };
  }

  if (arenaDifficulty === "normal") {
    return {
      interval: 270,
      type: "square",
      volume: 0.014,
      notes: [329.63, 392, 493.88, 392, 440, 523.25, 493.88, 392],
    };
  }

  const intervals = [250, 215, 180, 150, 122];
  const roots = [110, 116.54, 123.47, 130.81, 138.59];
  const root = roots[selectedHardLevel - 1];
  return {
    interval: intervals[selectedHardLevel - 1],
    type: selectedHardLevel >= 4 ? "sawtooth" : "square",
    volume: 0.014 + selectedHardLevel * 0.002,
    notes: [root, root * 1.5, root, root * 1.78, root, root * 2, root * 1.5, root * 1.33],
  };
}

function playBgmStep() {
  if (![STATES.COUNTDOWN, STATES.PLAYING, STATES.SCORED].includes(state)) return;
  const track = getBgmTrack();
  const note = track.notes[bgmStep % track.notes.length];
  playTone(note, track.interval / 1000 * 0.72, {
    type: track.type,
    volume: track.volume,
  });

  if (getArenaDifficulty() === "hard" && bgmStep % 4 === 0) {
    playTone(note / 2, track.interval / 1000 * 1.8, {
      type: "sawtooth",
      volume: 0.012 + selectedHardLevel * 0.0015,
    });
  }
  bgmStep += 1;
}

function startBgm() {
  stopBgm();
  const track = getBgmTrack();
  bgmStep = 0;
  playBgmStep();
  bgmTimer = window.setInterval(playBgmStep, track.interval);
}

function stopBgm() {
  if (bgmTimer !== null) {
    window.clearInterval(bgmTimer);
    bgmTimer = null;
  }
}

function resetPositions() {
  Object.assign(player, {
    x: GAME.width / 2,
    y: 650,
    targetX: GAME.width / 2,
    targetY: 650,
    vx: 0,
    vy: 0,
  });
  Object.assign(cpu, {
    x: GAME.width / 2,
    y: 132,
    targetX: GAME.width / 2,
    targetY: 132,
    vx: 0,
    vy: 0,
  });
  ball.x = GAME.width / 2;
  ball.y = GAME.height / 2;
  ball.vx = 0;
  ball.vy = 0;
  cpuControl.targetX = cpu.x;
  cpuControl.targetY = cpu.y;
  cpuControl.timer = 0;
  ripples.length = 0;
}

function updatePaddleSizes() {
  const difference = playerScore - cpuScore;
  const gap = Math.abs(difference);
  const handicapScale = gap >= 3
    ? GAME.handicapLarge
    : gap >= 2 ? GAME.handicapSmall : 1;
  const playerScale = difference < 0 ? handicapScale : 1;
  const topScale = difference > 0 ? handicapScale : 1;
  player.targetRadius = GAME.paddleRadius * playerScale;
  cpu.targetRadius = GAME.paddleRadius * topScale;
  setHandicapText(bottomHandicapElement, playerScale);
  setHandicapText(topHandicapElement, topScale);
}

function setHandicapText(element, scale) {
  const percentage = Math.round((scale - 1) * 100);
  element.textContent = percentage > 0 ? `RACKET +${percentage}%` : "";
  element.classList.toggle("active", percentage > 0);
  element.setAttribute(
    "aria-label",
    percentage > 0 ? `負け側ハンデ、ラケット${percentage}%拡大` : "ラケットサイズ補正なし",
  );
}

function animatePaddleSizes(dt) {
  const amount = Math.min(1, dt * 8);
  player.radius += (player.targetRadius - player.radius) * amount;
  cpu.radius += (cpu.targetRadius - cpu.radius) * amount;
}

function beginCountdown() {
  state = STATES.COUNTDOWN;
  countdownRemaining = GAME.countdownSeconds;
  resetPositions();
  updatePaddleSizes();
}

function launchBall() {
  const horizontal = (Math.random() * 0.8 - 0.4) * GAME.ballStartSpeed;
  ball.vx = horizontal;
  ball.vy = nextServeDirection * Math.sqrt(
    GAME.ballStartSpeed ** 2 - horizontal ** 2,
  );
  nextServeDirection *= -1;
  state = STATES.PLAYING;
}

function startGame() {
  enableAudio();
  releaseAllPointers();
  playerScore = 0;
  cpuScore = 0;
  player.radius = GAME.paddleRadius;
  cpu.radius = GAME.paddleRadius;
  player.targetRadius = GAME.paddleRadius;
  cpu.targetRadius = GAME.paddleRadius;
  nextServeDirection = -1;
  updateScoreDisplay();
  menuElement.classList.add("hidden");
  gameOverElement.classList.add("hidden");
  gameOverElement.classList.remove("facing-top");
  pauseMenuElement.classList.add("hidden");
  cpuScoreElement.parentElement.classList.remove("victory-score");
  playerScoreElement.parentElement.classList.remove("victory-score");
  beginCountdown();
  startBgm();
}

function pauseGame() {
  if (![STATES.PLAYING, STATES.COUNTDOWN, STATES.SCORED].includes(state)) return;
  stateBeforePause = state;
  state = STATES.PAUSED;
  releaseAllPointers();
  stopBgm();
  pauseMenuElement.classList.remove("hidden");
}

function resumeGame() {
  if (state !== STATES.PAUSED) return;
  enableAudio();
  state = stateBeforePause;
  pauseMenuElement.classList.add("hidden");
  lastTime = performance.now();
  startBgm();
}

function quitToMenu() {
  if (state !== STATES.PAUSED) return;
  returnToMenu();
}

function returnToMenu() {
  state = STATES.MENU;
  stopBgm();
  releaseAllPointers();
  playerScore = 0;
  cpuScore = 0;
  updateScoreDisplay();
  resetPositions();
  pauseMenuElement.classList.add("hidden");
  gameOverElement.classList.add("hidden");
  gameOverElement.classList.remove("facing-top");
  menuElement.classList.remove("hidden");
}

function updateScoreDisplay(scorer = null) {
  updatePaddleSizes();
  cpuScoreElement.textContent = cpuScore;
  playerScoreElement.textContent = playerScore;
  setScoreStyle(cpuScoreElement, cpuScore);
  setScoreStyle(playerScoreElement, playerScore);

  const changedElement = scorer === "player" ? playerScoreElement : cpuScoreElement;
  if (scorer) {
    changedElement.classList.remove("score-pop");
    void changedElement.offsetWidth;
    changedElement.classList.add("score-pop");
  }
}

function setScoreStyle(element, score) {
  for (let value = 0; value <= GAME.winScore; value += 1) {
    element.classList.toggle(`score-value-${value}`, value === score);
  }
}

function scorePoint(scorer) {
  if (state !== STATES.PLAYING) return;

  if (scorer === "player") playerScore += 1;
  else cpuScore += 1;

  updateScoreDisplay(scorer);
  playSound("goal");
  vibrate(45);
  ball.vx = 0;
  ball.vy = 0;

  if (playerScore >= GAME.winScore || cpuScore >= GAME.winScore) {
    state = STATES.GAME_OVER;
    stopBgm();
    gameOverRevealTimer = 0.5;
    const playerWon = playerScore > cpuScore;
    gameOverElement.classList.toggle("facing-top", selectedMode === "local" && !playerWon);
    resultTextElement.textContent = selectedMode === "local"
      ? `${playerWon ? "1P" : "2P"}の勝ち！`
      : playerWon ? "あなたの勝ち！" : "CPUの勝ち";
    finalScoreElement.textContent = `${playerScore} - ${cpuScore}`;
    const winnerElement = playerWon ? playerScoreElement : cpuScoreElement;
    winnerElement.parentElement.classList.add("victory-score");
    playSound(selectedMode === "local" || playerWon ? "win" : "lose");
    vibrate(140);
    return;
  }

  state = STATES.SCORED;
  scoredTimer = GAME.scoredPause;
}

function updatePlayer(dt) {
  movePaddle(player, player.targetX, player.targetY, GAME.playerMaxSpeed, dt);
  constrainPaddle(player, "bottom");
}

function updateSecondPlayer(dt) {
  movePaddle(cpu, cpu.targetX, cpu.targetY, GAME.playerMaxSpeed, dt);
  constrainPaddle(cpu, "top");
}

function updateCpu(dt) {
  const settings = selectedDifficulty === "hard"
    ? DIFFICULTIES.hard[selectedHardLevel - 1]
    : DIFFICULTIES[selectedDifficulty];
  const extents = getPaddleExtents(cpu);
  cpuControl.timer -= dt;

  if (cpuControl.timer <= 0) {
    cpuControl.timer = settings.reaction;
    const trackingBall = ball.vy < 0 || ball.y < GAME.centerY + 70;
    const error = (Math.random() * 2 - 1) * settings.error;
    cpuControl.targetX = clamp(
      trackingBall ? ball.x + error : GAME.width / 2,
      GAME.wall + extents.x,
      GAME.width - GAME.wall - extents.x,
    );
    cpuControl.targetY = trackingBall
      ? clamp(
        ball.y - 75,
        GAME.wall + 52 + extents.y,
        GAME.centerY - 28 - extents.y,
      )
      : 132;
  }

  movePaddle(cpu, cpuControl.targetX, cpuControl.targetY, settings.speed, dt);
  constrainPaddle(cpu, "top");
}

function movePaddle(paddle, targetX, targetY, maxSpeed, dt) {
  const dx = targetX - paddle.x;
  const dy = targetY - paddle.y;
  const distance = Math.hypot(dx, dy);
  const travelDistance = maxSpeed * dt;

  if (distance <= travelDistance || distance < 0.5) {
    paddle.x = targetX;
    paddle.y = targetY;
    paddle.vx = 0;
    paddle.vy = 0;
    return;
  }

  paddle.vx = (dx / distance) * maxSpeed;
  paddle.vy = (dy / distance) * maxSpeed;
  paddle.x += paddle.vx * dt;
  paddle.y += paddle.vy * dt;
}

function constrainPaddle(paddle, side) {
  const extents = getPaddleExtents(paddle);
  const constrainedX = clamp(
    paddle.x,
    GAME.wall + extents.x,
    GAME.width - GAME.wall - extents.x,
  );
  if (constrainedX !== paddle.x) paddle.vx = 0;
  paddle.x = constrainedX;

  if (side === "top") {
    const constrainedY = clamp(
      paddle.y,
      GAME.wall + 52 + extents.y,
      GAME.centerY - 28 - extents.y,
    );
    if (constrainedY !== paddle.y) paddle.vy = 0;
    paddle.y = constrainedY;
  } else {
    const constrainedY = clamp(
      paddle.y,
      GAME.centerY + 28 + extents.y,
      GAME.height - GAME.wall - 52 - extents.y,
    );
    if (constrainedY !== paddle.y) paddle.vy = 0;
    paddle.y = constrainedY;
  }
}

function updateBall(dt) {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  const left = GAME.wall + ball.radius;
  const right = GAME.width - GAME.wall - ball.radius;
  if (ball.x < left) {
    ball.x = left;
    ball.vx = Math.abs(ball.vx);
    playSound("wall");
  } else if (ball.x > right) {
    ball.x = right;
    ball.vx = -Math.abs(ball.vx);
    playSound("wall");
  }

  collideWithPaddle(cpu);
  collideWithPaddle(player);

  const goalLeft = (GAME.width - GAME.goalWidth) / 2;
  const goalRight = goalLeft + GAME.goalWidth;
  const inGoal = ball.x > goalLeft + ball.radius * 0.25
    && ball.x < goalRight - ball.radius * 0.25;

  if (ball.y - ball.radius <= GAME.wall) {
    if (inGoal && ball.y < -ball.radius) {
      scorePoint("player");
      return;
    }
    if (!inGoal) {
      ball.y = GAME.wall + ball.radius;
      ball.vy = Math.abs(ball.vy);
      playSound("wall");
    }
  }

  if (ball.y + ball.radius >= GAME.height - GAME.wall) {
    if (inGoal && ball.y > GAME.height + ball.radius) {
      scorePoint("cpu");
      return;
    }
    if (!inGoal) {
      ball.y = GAME.height - GAME.wall - ball.radius;
      ball.vy = -Math.abs(ball.vy);
      playSound("wall");
    }
  }

  limitBallSpeed();
}

function collideWithPaddle(paddle) {
  const collision = getPaddleCollision(paddle);
  if (!collision) return;
  const { normalX, normalY, penetration } = collision;

  // 見た目と同じ輪郭の外へ押し出し、同じ接触での連続反射を防ぐ。
  ball.x += normalX * (penetration + 1);
  ball.y += normalY * (penetration + 1);

  const relativeVx = ball.vx - paddle.vx;
  const relativeVy = ball.vy - paddle.vy;
  const approachingSpeed = relativeVx * normalX + relativeVy * normalY;
  if (approachingSpeed >= 0) return;

  // 接触角度の法線で相対速度を反射する。マレットの速度も衝撃へ加わる。
  const restitution = 1.08;
  const impulse = -(1 + restitution) * approachingSpeed;
  ball.vx += impulse * normalX;
  ball.vy += impulse * normalY;

  const paddleSpeed = Math.hypot(paddle.vx, paddle.vy);
  const reflectedSpeed = Math.hypot(ball.vx, ball.vy) || 1;
  const targetSpeed = clamp(
    reflectedSpeed + paddleSpeed * 0.07,
    GAME.ballMinSpeed,
    GAME.ballMaxSpeed,
  );
  ball.vx = (ball.vx / reflectedSpeed) * targetSpeed;
  ball.vy = (ball.vy / reflectedSpeed) * targetSpeed;
  playSound("paddle");
}

function getPaddleCollision(paddle) {
  const vertices = getPaddleVertices(paddle);
  const inside = isPointInsidePolygon(ball.x, ball.y, vertices);
  let closestPoint = null;
  let closestDistanceSquared = Infinity;

  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const point = closestPointOnSegment(ball.x, ball.y, start, end);
    const dx = ball.x - point.x;
    const dy = ball.y - point.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < closestDistanceSquared) {
      closestDistanceSquared = distanceSquared;
      closestPoint = point;
    }
  }

  const distance = Math.sqrt(closestDistanceSquared);
  if (!inside && distance > ball.radius) return null;

  let normalX;
  let normalY;
  if (distance > 0.001) {
    const direction = inside ? -1 : 1;
    normalX = ((ball.x - closestPoint.x) / distance) * direction;
    normalY = ((ball.y - closestPoint.y) / distance) * direction;
  } else {
    const relativeVx = ball.vx - paddle.vx;
    const relativeVy = ball.vy - paddle.vy;
    const relativeSpeed = Math.hypot(relativeVx, relativeVy);
    if (relativeSpeed > 0.001) {
      normalX = -relativeVx / relativeSpeed;
      normalY = -relativeVy / relativeSpeed;
    } else {
      const centerDistance = Math.hypot(ball.x - paddle.x, ball.y - paddle.y) || 1;
      normalX = (ball.x - paddle.x) / centerDistance;
      normalY = (ball.y - paddle.y) / centerDistance;
    }
  }

  return {
    normalX,
    normalY,
    penetration: inside ? ball.radius + distance : ball.radius - distance,
  };
}

function closestPointOnSegment(x, y, start, end) {
  const edgeX = end.x - start.x;
  const edgeY = end.y - start.y;
  const lengthSquared = edgeX * edgeX + edgeY * edgeY;
  if (lengthSquared < 0.0001) return start;
  const amount = clamp(
    ((x - start.x) * edgeX + (y - start.y) * edgeY) / lengthSquared,
    0,
    1,
  );
  return {
    x: start.x + edgeX * amount,
    y: start.y + edgeY * amount,
  };
}

function isPointInsidePolygon(x, y, vertices) {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index, index += 1) {
    const currentPoint = vertices[index];
    const previousPoint = vertices[previous];
    const crosses = (currentPoint.y > y) !== (previousPoint.y > y)
      && x < (previousPoint.x - currentPoint.x) * (y - currentPoint.y)
        / (previousPoint.y - currentPoint.y) + currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function limitBallSpeed() {
  let speed = Math.hypot(ball.vx, ball.vy);
  if (!speed) return;

  const targetSpeed = clamp(speed, GAME.ballMinSpeed, GAME.ballMaxSpeed);
  ball.vx = (ball.vx / speed) * targetSpeed;
  ball.vy = (ball.vy / speed) * targetSpeed;

  if (Math.abs(ball.vy) < GAME.ballMinVerticalSpeed) {
    const verticalSign = ball.vy < 0 ? -1 : 1;
    ball.vy = verticalSign * GAME.ballMinVerticalSpeed;
    speed = Math.hypot(ball.vx, ball.vy);
    if (speed > GAME.ballMaxSpeed) {
      ball.vx *= GAME.ballMaxSpeed / speed;
      ball.vy *= GAME.ballMaxSpeed / speed;
    }
  }
}

function updateRipples(dt) {
  for (let i = ripples.length - 1; i >= 0; i -= 1) {
    ripples[i].life -= dt;
    if (ripples[i].life <= 0) ripples.splice(i, 1);
  }
}

function update(dt) {
  updateRipples(dt);
  animatePaddleSizes(dt);

  if (state === STATES.COUNTDOWN) {
    updatePlayer(dt);
    if (selectedMode === "cpu") updateCpu(dt);
    else updateSecondPlayer(dt);
    countdownRemaining -= dt;
    if (countdownRemaining <= 0) launchBall();
    return;
  }

  if (state === STATES.PLAYING) {
    updatePlayer(dt);
    if (selectedMode === "cpu") updateCpu(dt);
    else updateSecondPlayer(dt);
    updateBall(dt);
    return;
  }

  if (state === STATES.SCORED) {
    scoredTimer -= dt;
    if (scoredTimer <= 0) beginCountdown();
    return;
  }

  if (state === STATES.GAME_OVER && gameOverRevealTimer > 0) {
    gameOverRevealTimer -= dt;
    if (gameOverRevealTimer <= 0) gameOverElement.classList.remove("hidden");
  }
}

function draw() {
  drawTable();
  drawGoals();
  drawCenterLine();
  drawRipples();
  drawPaddle(cpu, "#c46b55", true);
  drawPaddle(player, "#4c9f9a", false);
  drawBall();

  if (state === STATES.COUNTDOWN) drawCountdown();
  if (state === STATES.SCORED) drawMessage("POINT!");
}

function drawTable() {
  const arenaDifficulty = getArenaDifficulty();
  const gradient = ctx.createLinearGradient(0, 0, GAME.width, GAME.height);
  if (arenaDifficulty === "easy") {
    gradient.addColorStop(0, "#a56537");
    gradient.addColorStop(0.5, "#8d512d");
    gradient.addColorStop(1, "#704025");
  } else if (arenaDifficulty === "normal") {
    gradient.addColorStop(0, "#287b54");
    gradient.addColorStop(0.5, "#176842");
    gradient.addColorStop(1, "#0d4c32");
  } else {
    const intensity = selectedHardLevel / 5;
    gradient.addColorStop(0, `rgb(${24 + intensity * 12}, ${42 - intensity * 12}, ${61 + intensity * 18})`);
    gradient.addColorStop(0.5, `rgb(${13 + intensity * 10}, ${28 - intensity * 9}, ${45 + intensity * 14})`);
    gradient.addColorStop(1, `rgb(${7 + intensity * 8}, ${15 - intensity * 5}, ${28 + intensity * 8})`);
  }
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GAME.width, GAME.height);

  ctx.save();
  if (arenaDifficulty === "easy") {
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "#3e2013";
    ctx.lineWidth = 2;
    for (let x = 8; x < GAME.width; x += 24) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y <= GAME.height; y += 30) {
        ctx.lineTo(x + Math.sin(y * 0.025 + x) * 5, y);
      }
      ctx.stroke();
    }
  } else {
    const gridSize = arenaDifficulty === "hard" ? 40 : 60;
    ctx.globalAlpha = arenaDifficulty === "hard" ? 0.18 + selectedHardLevel * 0.025 : 0.12;
    ctx.strokeStyle = arenaDifficulty === "hard" ? "#88cfff" : "#d7ffe9";
    ctx.lineWidth = 1;
    for (let x = 0; x <= GAME.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, GAME.height);
      ctx.stroke();
    }
    for (let y = 0; y <= GAME.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(GAME.width, y);
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.strokeStyle = arenaDifficulty === "easy"
    ? "#3d2115"
    : arenaDifficulty === "normal" ? "#063e29" : "#07101b";
  ctx.lineWidth = GAME.wall * 2;
  ctx.strokeRect(0, 0, GAME.width, GAME.height);
  ctx.strokeStyle = arenaDifficulty === "hard"
    ? `rgba(85, 196, 255, ${0.38 + selectedHardLevel * 0.08})`
    : "rgba(240, 235, 190, 0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(GAME.wall, GAME.wall, GAME.width - GAME.wall * 2, GAME.height - GAME.wall * 2);
}

function drawGoals() {
  const x = (GAME.width - GAME.goalWidth) / 2;
  ctx.fillStyle = "#24130d";
  ctx.fillRect(x, 0, GAME.goalWidth, GAME.wall + 7);
  ctx.fillRect(x, GAME.height - GAME.wall - 7, GAME.goalWidth, GAME.wall + 7);

  ctx.strokeStyle = getArenaDifficulty() === "hard" ? "#86d9ff" : "#f0e0a5";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, GAME.wall + 8);
  ctx.lineTo(x, 4);
  ctx.lineTo(x + GAME.goalWidth, 4);
  ctx.lineTo(x + GAME.goalWidth, GAME.wall + 8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, GAME.height - GAME.wall - 8);
  ctx.lineTo(x, GAME.height - 4);
  ctx.lineTo(x + GAME.goalWidth, GAME.height - 4);
  ctx.lineTo(x + GAME.goalWidth, GAME.height - GAME.wall - 8);
  ctx.stroke();
}

function drawCenterLine() {
  ctx.save();
  ctx.setLineDash([12, 12]);
  ctx.strokeStyle = getArenaDifficulty() === "hard"
    ? "rgba(119, 216, 255, 0.65)"
    : "rgba(255, 246, 214, 0.5)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(GAME.wall + 6, GAME.centerY);
  ctx.lineTo(GAME.width - GAME.wall - 6, GAME.centerY);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(GAME.width / 2, GAME.centerY, 52, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255, 236, 196, 0.22)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawPaddle(paddle, rimColor, isCpu) {
  const hardStyle = isCpu && selectedMode === "cpu" && selectedDifficulty === "hard"
    ? HARD_PADDLE_COLORS[selectedHardLevel - 1]
    : null;
  const fillColor = hardStyle ? hardStyle.fill : "#f4f0e7";
  const edgeColor = hardStyle ? hardStyle.rim : rimColor;
  const extents = getPaddleExtents(paddle);

  ctx.save();
  ctx.shadowColor = hardStyle ? hardStyle.glow : "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = hardStyle ? 10 + selectedHardLevel * 4 : 11;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = "#cfc9bd";
  tracePolygon(getPaddleVertices(paddle, 5));
  ctx.fill();
  ctx.shadowColor = "transparent";

  const gradient = ctx.createRadialGradient(
    paddle.x - extents.x * 0.28,
    paddle.y - extents.y * 0.34,
    3,
    paddle.x,
    paddle.y,
    Math.max(extents.x, extents.y),
  );
  gradient.addColorStop(0, hardStyle && selectedHardLevel === 5 ? "#777b85" : "#ffffff");
  gradient.addColorStop(0.72, fillColor);
  gradient.addColorStop(1, hardStyle && selectedHardLevel === 5 ? "#050608" : "#cfc9bd");
  ctx.fillStyle = gradient;
  tracePolygon(getPaddleVertices(paddle));
  ctx.fill();
  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = 5;
  ctx.stroke();

  tracePolygon(getPaddleVertices(paddle, 0, 0.46));
  ctx.strokeStyle = "rgba(110, 99, 85, 0.25)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawBall() {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 4;
  const gradient = ctx.createRadialGradient(
    ball.x - 3, ball.y - 4, 1, ball.x, ball.y, ball.radius,
  );
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.4, "#fff4bd");
  gradient.addColorStop(1, "#e5b85b");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawRipples() {
  for (const ripple of ripples) {
    const progress = 1 - ripple.life / ripple.duration;
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, 9 + progress * 28, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${ripple.color || "125, 225, 218"}, ${0.6 * (1 - progress)})`;
    ctx.lineWidth = 3 - progress * 2;
    ctx.stroke();
  }
}

function drawCountdown() {
  const value = Math.max(1, Math.ceil(countdownRemaining));
  drawMessage(String(value));
}

function drawMessage(text) {
  if (selectedMode === "local") {
    drawOrientedMessage(text, GAME.centerY + 58, 0, 54);
    drawOrientedMessage(text, GAME.centerY - 58, Math.PI, 54);
    return;
  }
  drawOrientedMessage(text, GAME.centerY, 0, 72);
}

function drawOrientedMessage(text, y, rotation, fontSize) {
  ctx.save();
  ctx.translate(GAME.width / 2, y);
  ctx.rotate(rotation);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `900 ${fontSize}px system-ui`;
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(54, 28, 16, 0.7)";
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = "#fff3cc";
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

function getPointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * GAME.width,
    y: ((event.clientY - rect.top) / rect.height) * GAME.height,
  };
}

function getPointerSide(event) {
  if (selectedMode === "cpu") return "bottom";
  return getPointerPosition(event).y < GAME.centerY ? "top" : "bottom";
}

function handlePointer(event, side, showRipple = true) {
  if (state !== STATES.PLAYING && state !== STATES.COUNTDOWN) return;
  if (event.cancelable) event.preventDefault();
  const position = getPointerPosition(event);
  const paddle = side === "top" ? cpu : player;
  const extents = getPaddleExtents(paddle);
  const touchOffset = event.pointerType === "touch" ? extents.y * 1.4 + 10 : 0;
  const y = position.y + (side === "top" ? touchOffset : -touchOffset);
  paddle.targetX = clamp(
    position.x,
    GAME.wall + extents.x,
    GAME.width - GAME.wall - extents.x,
  );
  paddle.targetY = side === "top"
    ? clamp(y, GAME.wall + 52 + extents.y, GAME.centerY - 28 - extents.y)
    : clamp(y, GAME.centerY + 28 + extents.y, GAME.height - GAME.wall - 52 - extents.y);
  if (showRipple) {
    ripples.push({
      x: paddle.targetX,
      y: paddle.targetY,
      color: side === "top" ? "224, 126, 103" : "125, 225, 218",
      life: 0.38,
      duration: 0.38,
    });
  }
}

function claimPointer(event) {
  if (state !== STATES.PLAYING && state !== STATES.COUNTDOWN) return;
  const side = getPointerSide(event);
  const owner = sideOwners.get(side);
  if (owner !== undefined && owner !== event.pointerId) return;
  activePointers.set(event.pointerId, side);
  sideOwners.set(side, event.pointerId);
  try {
    canvas.setPointerCapture?.(event.pointerId);
  } catch {
    // 一部ブラウザではマウスのキャプチャに対応しない。
  }
  handlePointer(event, side);
}

function releasePointer(event) {
  const side = activePointers.get(event.pointerId);
  if (!side) return;
  activePointers.delete(event.pointerId);
  if (sideOwners.get(side) === event.pointerId) sideOwners.delete(side);
  try {
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  } catch {
    // キャプチャが先に失われていても入力状態は解放する。
  }
}

function releaseAllPointers() {
  activePointers.clear();
  sideOwners.clear();
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const displayWidth = canvas.clientWidth;
  const displayHeight = canvas.clientHeight;
  const targetWidth = Math.round(displayWidth * dpr);
  const targetHeight = Math.round(displayHeight * dpr);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  ctx.setTransform(targetWidth / GAME.width, 0, 0, targetHeight / GAME.height, 0, 0);
}

function gameLoop(time) {
  const dt = Math.min((time - lastTime) / 1000, 0.033);
  lastTime = time;
  resizeCanvas();
  update(dt);
  draw();
  requestAnimationFrame(gameLoop);
}

function selectMode(mode) {
  selectedMode = mode;
  const isLocal = mode === "local";
  gameFrame.classList.toggle("local-mode", isLocal);
  difficultySettings.classList.toggle("hidden", isLocal);
  hardLevelPanel.classList.toggle("hidden", isLocal || selectedDifficulty !== "hard");
  topPlayerLabel.textContent = isLocal ? "2P" : "CPU";
  bottomPlayerLabel.textContent = isLocal ? "1P" : "YOU";
  startButton.textContent = isLocal ? "2人対戦スタート" : "CPU対戦スタート";
  controlHelp.children[0].textContent = isLocal ? "2P ↑ 上側" : "CPU ↑ 上側";
  controlHelp.children[1].textContent = isLocal ? "1P ↓ 下側" : "YOU ↓ 下側";
  gameFrame.setAttribute("aria-label", isLocal ? "1台で遊ぶ2人用ピンポンゲーム" : "CPU対戦ピンポンゲーム");
  releaseAllPointers();
  modeButtons.forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", String(selected));
  });
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => selectMode(button.dataset.mode));
});

shapeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedShape = button.dataset.shape;
    shapeButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-checked", String(selected));
    });
    constrainPaddle(cpu, "top");
    constrainPaddle(player, "bottom");
  });
});

difficultyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedDifficulty = button.dataset.level;
    hardLevelPanel.classList.toggle(
      "hidden",
      selectedMode === "local" || selectedDifficulty !== "hard",
    );
    difficultyButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-checked", String(selected));
    });
  });
});

hardLevelButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedHardLevel = Number(button.dataset.hardLevel);
    hardLevelLabel.textContent = selectedHardLevel;
    hardLevelButtons.forEach((item) => {
      item.classList.toggle("selected", item === button);
    });
  });
});

startButton.addEventListener("click", startGame);
restartButton.addEventListener("click", startGame);
resultMenuButton.addEventListener("click", returnToMenu);
resumeButton.addEventListener("click", resumeGame);
quitButton.addEventListener("click", quitToMenu);
topResumeButton.addEventListener("click", resumeGame);
topQuitButton.addEventListener("click", quitToMenu);
headerMenuButton.addEventListener("click", () => {
  if (state === STATES.PAUSED) resumeGame();
  else if (state === STATES.GAME_OVER) returnToMenu();
  else pauseGame();
});
canvas.addEventListener("pointerdown", claimPointer, { passive: false });
canvas.addEventListener("pointermove", (event) => {
  const assignedSide = activePointers.get(event.pointerId);
  if (assignedSide) {
    handlePointer(event, assignedSide, false);
  } else if (event.pointerType === "mouse") {
    const hoveredSide = getPointerSide(event);
    if (!sideOwners.has(hoveredSide)) handlePointer(event, hoveredSide, false);
  }
}, { passive: false });
canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);
canvas.addEventListener("lostpointercapture", releasePointer);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("resize", resizeCanvas);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  if (state === STATES.PAUSED) resumeGame();
  else pauseGame();
});

selectMode(selectedMode);
updateScoreDisplay();
resizeCanvas();
requestAnimationFrame(gameLoop);
