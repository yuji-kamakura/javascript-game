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
const ruleButtons = [...document.querySelectorAll(".rule-choice")];
const shapeButtons = [...document.querySelectorAll(".shape-choice")];
const controlHelp = document.getElementById("controlHelp");
const partyLegend = document.getElementById("partyLegend");
const topEffectsElement = document.getElementById("topEffects");
const bottomEffectsElement = document.getElementById("bottomEffects");
const partyAnnouncement = document.getElementById("partyAnnouncement");

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
  ballStartSpeed: 205,
  ballMinSpeed: 195,
  ballMaxSpeed: 660,
  ballHitSpeedGain: 28,
  ballMinVerticalSpeed: 72,
  handicapSmall: 1.15,
  handicapLarge: 1.3,
  partyEffectSeconds: 10,
  partyPaddleScale: 1.3,
  maxPaddleScale: 1.55,
  partyGoalScale: 0.58,
  partyCornerRadius: 112,
  partyFirstItemDelay: 3.5,
  partyItemDelayMin: 5.5,
  partyItemDelayMax: 8,
  partyMaxBalls: 3,
  projectileCooldown: 1,
  projectileStunSeconds: 0.5,
  projectileRadius: 10,
  physicsTravelPerStep: 6,
});

const PARTY_ITEMS = Object.freeze({
  multiball: { label: "3 BALL", shortLabel: "3B", color: "#ffd45e" },
  paddle: { label: "BIG RACKET", shortLabel: "XL", color: "#67e8a5" },
  goal: { label: "SMALL GOAL", shortLabel: "G", color: "#76c7ff" },
  round: { label: "ROUND COURT", shortLabel: "O", color: "#ef8cff" },
  weapon: { label: "FREEZE SHOT", shortLabel: "S", color: "#ff718e" },
});

const PARTY_ITEM_TYPES = Object.freeze(Object.keys(PARTY_ITEMS));

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
let selectedRule = "standard";
let selectedShape = "oval";
let playerScore = 0;
let cpuScore = 0;
let countdownRemaining = GAME.countdownSeconds;
let scoredTimer = 0;
let scoredMessage = "POINT!";
let nextServeDirection = -1;
let lastTime = performance.now();
let stateBeforePause = STATES.PLAYING;
let gameOverRevealTimer = 0;
let audioContext = null;
let bgmTimer = null;
let bgmStep = 0;
const activePointers = new Map();
const sideOwners = new Map();
const pointerGestures = new Map();

const soundCooldowns = {
  paddle: 0,
  wall: 0,
  goal: 0,
};

const player = createPaddle(GAME.width / 2, 650);
const cpu = createPaddle(GAME.width / 2, 132);
function createBall(options = {}) {
  return {
    x: options.x ?? GAME.width / 2,
    y: options.y ?? GAME.height / 2,
    vx: options.vx ?? 0,
    vy: options.vy ?? 0,
    radius: GAME.ballRadius,
    hitCount: options.hitCount ?? 0,
    isBonus: Boolean(options.isBonus),
  };
}

const ball = createBall();
const balls = [ball];
const partyItems = [];
const projectiles = [];
const partyNotices = [];
const pendingPartyEffects = [];

const partyState = {
  multiball: 0,
  multiballOwner: null,
  round: 0,
  roundOwner: null,
  top: { paddle: 0, goal: 0, weapon: 0, stun: 0, cooldown: 0 },
  bottom: { paddle: 0, goal: 0, weapon: 0, stun: 0, cooldown: 0 },
};

let partyItemTimer = GAME.partyFirstItemDelay;
let lastPartyItemType = null;
let arenaRoundness = 0;
let partyHudSignature = "";
let paddleFrameMotion = null;

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

function isPartyActive() {
  return selectedRule === "party";
}

function getPaddleHomeY(side) {
  if (isPartyActive()) return side === "top" ? 160 : 640;
  return side === "top" ? 132 : 650;
}

function getPaddleVerticalBounds(paddle, side) {
  const extents = getPaddleExtents(paddle);
  const scoreSafeEdge = isPartyActive() ? 100 : GAME.wall + 52;
  return side === "top"
    ? {
      min: scoreSafeEdge + extents.y,
      max: GAME.centerY - 28 - extents.y,
    }
    : {
      min: GAME.centerY + 28 + extents.y,
      max: GAME.height - scoreSafeEdge - extents.y,
    };
}

function clampPaddleTarget(paddle, side) {
  const verticalBounds = getPaddleVerticalBounds(paddle, side);
  paddle.targetY = clamp(paddle.targetY, verticalBounds.min, verticalBounds.max);
  const horizontalBounds = getPaddleHorizontalBounds(paddle, paddle.targetY);
  paddle.targetX = clamp(paddle.targetX, horizontalBounds.left, horizontalBounds.right);
}

function randomPartyItemDelay() {
  return GAME.partyItemDelayMin
    + Math.random() * (GAME.partyItemDelayMax - GAME.partyItemDelayMin);
}

function getReferenceBallSpeed() {
  return balls.reduce(
    (fastest, activeBall) => Math.max(fastest, Math.hypot(activeBall.vx, activeBall.vy)),
    GAME.ballStartSpeed,
  );
}

function launchBallEntity(activeBall, verticalDirection, speed, angleOffset = 0) {
  const horizontalRatio = clamp(
    Math.random() * 0.9 - 0.45 + angleOffset,
    -0.72,
    0.72,
  );
  activeBall.x = GAME.width / 2;
  activeBall.y = GAME.height / 2;
  activeBall.vx = horizontalRatio * speed;
  activeBall.vy = verticalDirection * Math.sqrt(
    Math.max(0, speed ** 2 - activeBall.vx ** 2),
  );
  activeBall.hitCount = 0;
  limitBallSpeed(activeBall);
}

function getCpuThreatBall() {
  if (!balls.length) return null;
  const incoming = balls.filter((activeBall) => activeBall.vy < 0);
  const approaching = incoming
    .map((activeBall) => ({
      activeBall,
      time: (activeBall.y - cpu.y) / -activeBall.vy,
    }))
    .filter((candidate) => candidate.time >= 0)
    .sort((first, second) => first.time - second.time);
  if (approaching.length) return approaching[0].activeBall;

  const headingToGoal = incoming
    .map((activeBall) => ({
      activeBall,
      time: (activeBall.y - (GAME.wall + activeBall.radius)) / -activeBall.vy,
    }))
    .filter((candidate) => candidate.time >= 0)
    .sort((first, second) => first.time - second.time);
  if (headingToGoal.length) return headingToGoal[0].activeBall;

  return balls.reduce(
    (best, activeBall) => (!best || activeBall.y < best.y ? activeBall : best),
    null,
  );
}

function getArenaCornerRadius() {
  return GAME.partyCornerRadius * arenaRoundness;
}

function getArenaHorizontalBounds(y, entityRadius = 0) {
  const rectangularBounds = {
    left: GAME.wall + entityRadius,
    right: GAME.width - GAME.wall - entityRadius,
  };
  const cornerRadius = getArenaCornerRadius();
  const effectiveRadius = cornerRadius - entityRadius;
  if (effectiveRadius <= 0.5) return rectangularBounds;

  const topCenterY = GAME.wall + cornerRadius;
  const bottomCenterY = GAME.height - GAME.wall - cornerRadius;
  let cornerCenterY = null;
  if (y < topCenterY) cornerCenterY = topCenterY;
  else if (y > bottomCenterY) cornerCenterY = bottomCenterY;
  if (cornerCenterY === null) return rectangularBounds;

  const safeY = clamp(
    y,
    GAME.wall + entityRadius,
    GAME.height - GAME.wall - entityRadius,
  );
  const offsetY = safeY - cornerCenterY;
  const horizontalReach = Math.sqrt(
    Math.max(0, effectiveRadius ** 2 - offsetY ** 2),
  );
  return {
    left: GAME.wall + cornerRadius - horizontalReach,
    right: GAME.width - GAME.wall - cornerRadius + horizontalReach,
  };
}

function reflectVelocity(entity, normalX, normalY) {
  const towardWall = entity.vx * normalX + entity.vy * normalY;
  if (towardWall >= 0) return;
  entity.vx -= 2 * towardWall * normalX;
  entity.vy -= 2 * towardWall * normalY;
}

function resolveArenaSideCollision(entity, shouldBounce) {
  const bounds = getArenaHorizontalBounds(entity.y, entity.radius);
  if (entity.x >= bounds.left && entity.x <= bounds.right) return false;

  const hitLeft = entity.x < bounds.left;
  const cornerRadius = getArenaCornerRadius();
  const topCenterY = GAME.wall + cornerRadius;
  const bottomCenterY = GAME.height - GAME.wall - cornerRadius;
  const inCorner = cornerRadius > entity.radius + 0.5
    && (entity.y < topCenterY || entity.y > bottomCenterY);
  let normalX;
  let normalY;

  if (inCorner) {
    const centerX = hitLeft
      ? GAME.wall + cornerRadius
      : GAME.width - GAME.wall - cornerRadius;
    const centerY = entity.y < topCenterY ? topCenterY : bottomCenterY;
    const dx = entity.x - centerX;
    const dy = entity.y - centerY;
    const distance = Math.hypot(dx, dy) || 1;
    const effectiveRadius = cornerRadius - entity.radius;
    entity.x = centerX + (dx / distance) * effectiveRadius;
    entity.y = centerY + (dy / distance) * effectiveRadius;
    normalX = -dx / distance;
    normalY = -dy / distance;
  } else {
    entity.x = hitLeft ? bounds.left : bounds.right;
    normalX = hitLeft ? 1 : -1;
    normalY = 0;
  }

  if (shouldBounce) {
    reflectVelocity(entity, normalX, normalY);
    playSound("wall");
  }
  return true;
}

function getPaddleHorizontalBounds(paddle, y = paddle.y) {
  const extents = getPaddleExtents(paddle);
  const samples = [y - extents.y, y, y + extents.y]
    .map((sampleY) => getArenaHorizontalBounds(sampleY, extents.x));
  return {
    left: Math.max(...samples.map((bounds) => bounds.left)),
    right: Math.min(...samples.map((bounds) => bounds.right)),
  };
}

function getGoalWidth(side) {
  const personalState = partyState[side];
  const scale = isPartyActive() && personalState.goal > 0
    ? GAME.partyGoalScale
    : 1;
  return GAME.goalWidth * scale;
}

function getGoalBounds(side, inset = 0) {
  const width = getGoalWidth(side);
  return {
    left: (GAME.width - width) / 2 + inset,
    right: (GAME.width + width) / 2 - inset,
    width,
  };
}

function getCrossingFraction(previousPosition, currentPosition, boundary) {
  const distance = currentPosition - previousPosition;
  if (Math.abs(distance) < 0.0001) return 1;
  return clamp((boundary - previousPosition) / distance, 0, 1);
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
  const playerHomeY = getPaddleHomeY("bottom");
  const cpuHomeY = getPaddleHomeY("top");
  Object.assign(player, {
    x: GAME.width / 2,
    y: playerHomeY,
    targetX: GAME.width / 2,
    targetY: playerHomeY,
    vx: 0,
    vy: 0,
  });
  Object.assign(cpu, {
    x: GAME.width / 2,
    y: cpuHomeY,
    targetX: GAME.width / 2,
    targetY: cpuHomeY,
    vx: 0,
    vy: 0,
  });
  Object.assign(ball, createBall());
  balls.length = 1;
  balls[0] = ball;
  partyItems.length = 0;
  projectiles.length = 0;
  pendingPartyEffects.length = 0;
  partyState.top.stun = 0;
  partyState.bottom.stun = 0;
  partyState.top.cooldown = 0;
  partyState.bottom.cooldown = 0;
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
  const playerHandicapScale = difference < 0 ? handicapScale : 1;
  const topHandicapScale = difference > 0 ? handicapScale : 1;
  const playerPartyScale = isPartyActive() && partyState.bottom.paddle > 0
    ? GAME.partyPaddleScale
    : 1;
  const topPartyScale = isPartyActive() && partyState.top.paddle > 0
    ? GAME.partyPaddleScale
    : 1;
  const playerScale = Math.min(
    playerHandicapScale * playerPartyScale,
    GAME.maxPaddleScale,
  );
  const topScale = Math.min(
    topHandicapScale * topPartyScale,
    GAME.maxPaddleScale,
  );
  player.targetRadius = GAME.paddleRadius * playerScale;
  cpu.targetRadius = GAME.paddleRadius * topScale;
  setHandicapText(bottomHandicapElement, playerHandicapScale);
  setHandicapText(topHandicapElement, topHandicapScale);
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
  launchBallEntity(ball, nextServeDirection, GAME.ballStartSpeed);
  if (isPartyActive() && partyState.multiball > 0) ensurePartyBalls();
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
  resetPartyState();
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
  resetPartyState();
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
  balls.forEach((activeBall) => {
    activeBall.vx = 0;
    activeBall.vy = 0;
  });
  partyItems.length = 0;
  projectiles.length = 0;
  partyItemTimer = randomPartyItemDelay();
  partyState.top.stun = 0;
  partyState.bottom.stun = 0;

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
  scoredMessage = "POINT!";
}

function updatePlayer(dt) {
  if (partyState.bottom.stun > 0) {
    player.vx = 0;
    player.vy = 0;
    constrainPaddle(player, "bottom");
    clampPaddleTarget(player, "bottom");
    return;
  }
  movePaddle(player, player.targetX, player.targetY, GAME.playerMaxSpeed, dt);
  constrainPaddle(player, "bottom");
}

function updateSecondPlayer(dt) {
  if (partyState.top.stun > 0) {
    cpu.vx = 0;
    cpu.vy = 0;
    constrainPaddle(cpu, "top");
    clampPaddleTarget(cpu, "top");
    return;
  }
  movePaddle(cpu, cpu.targetX, cpu.targetY, GAME.playerMaxSpeed, dt);
  constrainPaddle(cpu, "top");
}

function updateCpu(dt) {
  const settings = selectedDifficulty === "hard"
    ? DIFFICULTIES.hard[selectedHardLevel - 1]
    : DIFFICULTIES[selectedDifficulty];
  const trackingTarget = getCpuThreatBall();
  cpuControl.timer -= dt;

  if (cpuControl.timer <= 0) {
    cpuControl.timer = settings.reaction;
    const trackingBall = trackingTarget
      && (trackingTarget.vy < 0 || trackingTarget.y < GAME.centerY + 70);
    const error = (Math.random() * 2 - 1) * settings.error;
    const verticalBounds = getPaddleVerticalBounds(cpu, "top");
    cpuControl.targetY = trackingBall
      ? clamp(trackingTarget.y - 75, verticalBounds.min, verticalBounds.max)
      : getPaddleHomeY("top");
    const horizontalBounds = getPaddleHorizontalBounds(cpu, cpuControl.targetY);
    cpuControl.targetX = clamp(
      trackingBall ? trackingTarget.x + error : GAME.width / 2,
      horizontalBounds.left,
      horizontalBounds.right,
    );
  }

  if (partyState.top.stun > 0) {
    cpu.vx = 0;
    cpu.vy = 0;
    constrainPaddle(cpu, "top");
    clampPaddleTarget(cpu, "top");
    return;
  }
  movePaddle(cpu, cpuControl.targetX, cpuControl.targetY, settings.speed, dt);
  constrainPaddle(cpu, "top");
  if (isPartyActive() && partyState.top.weapon > 0 && partyState.top.cooldown <= 0) {
    const aimWindow = 70 + selectedHardLevel * 8;
    if (Math.abs(cpu.x - player.x) <= aimWindow) fireProjectile("top");
  }
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
  const horizontalBounds = getPaddleHorizontalBounds(paddle);
  const constrainedX = clamp(
    paddle.x,
    horizontalBounds.left,
    horizontalBounds.right,
  );
  if (constrainedX !== paddle.x) paddle.vx = 0;
  paddle.x = constrainedX;

  const verticalBounds = getPaddleVerticalBounds(paddle, side);
  const constrainedY = clamp(paddle.y, verticalBounds.min, verticalBounds.max);
  if (constrainedY !== paddle.y) paddle.vy = 0;
  paddle.y = constrainedY;
}

function beginPaddleFrame(dt) {
  const makeMotion = (paddle) => ({
    paddle,
    startX: paddle.x,
    startY: paddle.y,
    endX: paddle.x,
    endY: paddle.y,
    endVx: paddle.vx,
    endVy: paddle.vy,
    collisionVx: 0,
    collisionVy: 0,
    freezeProgress: null,
  });
  paddleFrameMotion = {
    dt,
    top: makeMotion(cpu),
    bottom: makeMotion(player),
  };
}

function finishPaddleFrame() {
  if (!paddleFrameMotion) return;
  for (const side of ["top", "bottom"]) {
    const motion = paddleFrameMotion[side];
    const paddle = motion.paddle;
    motion.endX = paddle.x;
    motion.endY = paddle.y;
    motion.endVx = paddle.vx;
    motion.endVy = paddle.vy;
    motion.collisionVx = (motion.endX - motion.startX) / paddleFrameMotion.dt;
    motion.collisionVy = (motion.endY - motion.startY) / paddleFrameMotion.dt;
  }
}

function positionPaddlesAtFrameProgress(progress) {
  if (!paddleFrameMotion) return;
  for (const side of ["top", "bottom"]) {
    const motion = paddleFrameMotion[side];
    const paddle = motion.paddle;
    const frozen = motion.freezeProgress !== null;
    const moving = !frozen || progress < motion.freezeProgress;
    const movementProgress = frozen && moving
      ? progress / motion.freezeProgress
      : progress;
    paddle.x = moving
      ? motion.startX + (motion.endX - motion.startX) * movementProgress
      : motion.endX;
    paddle.y = moving
      ? motion.startY + (motion.endY - motion.startY) * movementProgress
      : motion.endY;
    paddle.vx = moving ? motion.collisionVx : 0;
    paddle.vy = moving ? motion.collisionVy : 0;
    constrainPaddle(paddle, side);
  }
}

function freezePaddleFrame(side, progress) {
  if (!paddleFrameMotion) return;
  const motion = paddleFrameMotion[side];
  const safeProgress = clamp(progress, 0.0001, 1);
  motion.endX = motion.paddle.x;
  motion.endY = motion.paddle.y;
  motion.endVx = 0;
  motion.endVy = 0;
  motion.freezeProgress = safeProgress;
  motion.collisionVx = (motion.endX - motion.startX)
    / (paddleFrameMotion.dt * safeProgress);
  motion.collisionVy = (motion.endY - motion.startY)
    / (paddleFrameMotion.dt * safeProgress);
}

function restorePaddlesAfterPhysics() {
  if (!paddleFrameMotion) return;
  for (const side of ["top", "bottom"]) {
    const motion = paddleFrameMotion[side];
    const paddle = motion.paddle;
    paddle.x = motion.endX;
    paddle.y = motion.endY;
    paddle.vx = motion.endVx;
    paddle.vy = motion.endVy;
    constrainPaddle(paddle, side);
    clampPaddleTarget(paddle, side);
  }
  paddleFrameMotion = null;
}

function updateBallStep(activeBall, dt) {
  const previousX = activeBall.x;
  const previousY = activeBall.y;
  activeBall.x += activeBall.vx * dt;
  activeBall.y += activeBall.vy * dt;

  const topPlane = GAME.wall + activeBall.radius;
  const bottomPlane = GAME.height - GAME.wall - activeBall.radius;
  if (previousY >= topPlane && activeBall.y <= topPlane) {
    const fraction = getCrossingFraction(previousY, activeBall.y, topPlane);
    const crossingX = previousX + (activeBall.x - previousX) * fraction;
    const goal = getGoalBounds("top", activeBall.radius * 0.25);
    if (crossingX > goal.left && crossingX < goal.right) {
      return { scorer: "player", fraction };
    }
  }
  if (previousY <= bottomPlane && activeBall.y >= bottomPlane) {
    const fraction = getCrossingFraction(previousY, activeBall.y, bottomPlane);
    const crossingX = previousX + (activeBall.x - previousX) * fraction;
    const goal = getGoalBounds("bottom", activeBall.radius * 0.25);
    if (crossingX > goal.left && crossingX < goal.right) {
      return { scorer: "cpu", fraction };
    }
  }

  resolveArenaSideCollision(activeBall, true);
  collideWithPaddle(activeBall, cpu);
  collideWithPaddle(activeBall, player);

  if (activeBall.y - activeBall.radius <= GAME.wall) {
    activeBall.y = GAME.wall + activeBall.radius;
    activeBall.vy = Math.abs(activeBall.vy);
    playSound("wall");
  }

  if (activeBall.y + activeBall.radius >= GAME.height - GAME.wall) {
    activeBall.y = GAME.height - GAME.wall - activeBall.radius;
    activeBall.vy = -Math.abs(activeBall.vy);
    playSound("wall");
  }

  limitBallSpeed(activeBall);
  return null;
}

function collideWithPaddle(activeBall, paddle) {
  const collision = getPaddleCollision(activeBall, paddle);
  if (!collision) return;
  const { normalX, normalY, penetration } = collision;

  // 見た目と同じ輪郭の外へ押し出し、同じ接触での連続反射を防ぐ。
  activeBall.x += normalX * (penetration + 1);
  activeBall.y += normalY * (penetration + 1);

  const relativeVx = activeBall.vx - paddle.vx;
  const relativeVy = activeBall.vy - paddle.vy;
  const approachingSpeed = relativeVx * normalX + relativeVy * normalY;
  if (approachingSpeed >= 0) return;

  // 接触角度の法線で相対速度を反射する。マレットの速度も衝撃へ加わる。
  const incomingSpeed = Math.hypot(activeBall.vx, activeBall.vy) || GAME.ballStartSpeed;
  const restitution = 1;
  const impulse = -(1 + restitution) * approachingSpeed;
  activeBall.vx += impulse * normalX;
  activeBall.vy += impulse * normalY;

  const reflectedSpeed = Math.hypot(activeBall.vx, activeBall.vy) || 1;
  const targetSpeed = clamp(
    incomingSpeed + GAME.ballHitSpeedGain,
    GAME.ballMinSpeed,
    GAME.ballMaxSpeed,
  );
  activeBall.vx = (activeBall.vx / reflectedSpeed) * targetSpeed;
  activeBall.vy = (activeBall.vy / reflectedSpeed) * targetSpeed;
  activeBall.hitCount += 1;
  limitBallSpeed(activeBall);
  playSound("paddle");
}

function getPaddleCollision(circle, paddle) {
  const vertices = getPaddleVertices(paddle);
  const inside = isPointInsidePolygon(circle.x, circle.y, vertices);
  let closestPoint = null;
  let closestDistanceSquared = Infinity;

  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const point = closestPointOnSegment(circle.x, circle.y, start, end);
    const dx = circle.x - point.x;
    const dy = circle.y - point.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < closestDistanceSquared) {
      closestDistanceSquared = distanceSquared;
      closestPoint = point;
    }
  }

  const distance = Math.sqrt(closestDistanceSquared);
  if (!inside && distance > circle.radius) return null;

  let normalX;
  let normalY;
  if (distance > 0.001) {
    const direction = inside ? -1 : 1;
    normalX = ((circle.x - closestPoint.x) / distance) * direction;
    normalY = ((circle.y - closestPoint.y) / distance) * direction;
  } else {
    const relativeVx = circle.vx - paddle.vx;
    const relativeVy = circle.vy - paddle.vy;
    const relativeSpeed = Math.hypot(relativeVx, relativeVy);
    if (relativeSpeed > 0.001) {
      normalX = -relativeVx / relativeSpeed;
      normalY = -relativeVy / relativeSpeed;
    } else {
      const centerDistance = Math.hypot(circle.x - paddle.x, circle.y - paddle.y) || 1;
      normalX = (circle.x - paddle.x) / centerDistance;
      normalY = (circle.y - paddle.y) / centerDistance;
    }
  }

  return {
    normalX,
    normalY,
    penetration: inside ? circle.radius + distance : circle.radius - distance,
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

function limitBallSpeed(activeBall) {
  const speed = Math.hypot(activeBall.vx, activeBall.vy);
  if (!speed) return;

  const targetSpeed = clamp(speed, GAME.ballMinSpeed, GAME.ballMaxSpeed);
  activeBall.vx = (activeBall.vx / speed) * targetSpeed;
  activeBall.vy = (activeBall.vy / speed) * targetSpeed;

  const verticalFloor = Math.min(GAME.ballMinVerticalSpeed, targetSpeed * 0.36);
  if (Math.abs(activeBall.vy) < verticalFloor) {
    const verticalSign = activeBall.vy < 0 ? -1 : 1;
    const horizontalSign = activeBall.vx < 0 ? -1 : 1;
    activeBall.vy = verticalSign * verticalFloor;
    activeBall.vx = horizontalSign * Math.sqrt(
      Math.max(0, targetSpeed ** 2 - verticalFloor ** 2),
    );
  }
}

function updateBalls(dt) {
  if (!balls.length) return;
  const fastestSpeed = balls.reduce(
    (maximum, activeBall) => Math.max(maximum, Math.hypot(activeBall.vx, activeBall.vy)),
    0,
  );
  const stepCount = Math.max(
    1,
    Math.ceil(
      ((fastestSpeed + GAME.playerMaxSpeed) * dt) / GAME.physicsTravelPerStep,
    ),
  );
  const stepTime = dt / stepCount;

  for (let step = 0; step < stepCount; step += 1) {
    positionPaddlesAtFrameProgress((step + 1) / stepCount);
    const scoreCandidates = [];
    for (const activeBall of balls) {
      const event = updateBallStep(activeBall, stepTime);
      if (event) {
        scoreCandidates.push({
          ...event,
          time: (step + event.fraction) * stepTime,
        });
      }
    }
    if (scoreCandidates.length) {
      const endOfStepTime = (step + 1) * stepTime;
      for (const activeBall of balls) {
        const imminent = predictImminentGoal(activeBall, endOfStepTime, 0.0005);
        if (imminent) scoreCandidates.push(imminent);
      }
      resolveScoreCandidates(scoreCandidates);
      return;
    }
  }
}

function predictImminentGoal(activeBall, baseTime, windowSeconds) {
  let side;
  let plane;
  let scorer;
  if (activeBall.vy < 0) {
    side = "top";
    plane = GAME.wall + activeBall.radius;
    scorer = "player";
  } else if (activeBall.vy > 0) {
    side = "bottom";
    plane = GAME.height - GAME.wall - activeBall.radius;
    scorer = "cpu";
  } else {
    return null;
  }

  const time = (plane - activeBall.y) / activeBall.vy;
  if (time <= 0 || time > windowSeconds) return null;
  const crossingX = activeBall.x + activeBall.vx * time;
  const goal = getGoalBounds(side, activeBall.radius * 0.25);
  if (crossingX <= goal.left || crossingX >= goal.right) return null;
  return { scorer, fraction: 0, time: baseTime + time };
}

function resolveScoreCandidates(candidates) {
  candidates.sort((first, second) => first.time - second.time);
  const earliest = candidates[0];
  const oppositeAtSameTime = candidates.some((candidate) => (
    candidate.scorer !== earliest.scorer
    && Math.abs(candidate.time - earliest.time) < 0.0005
  ));
  if (oppositeAtSameTime) {
    startLetReplay();
    return;
  }
  scorePoint(earliest.scorer);
}

function startLetReplay() {
  balls.forEach((activeBall) => {
    activeBall.vx = 0;
    activeBall.vy = 0;
  });
  partyItems.length = 0;
  projectiles.length = 0;
  partyItemTimer = randomPartyItemDelay();
  partyState.top.stun = 0;
  partyState.bottom.stun = 0;
  state = STATES.SCORED;
  scoredTimer = 0.45;
  scoredMessage = "LET";
}

function ensurePartyBalls() {
  if (!isPartyActive() || partyState.multiball <= 0) return;
  const referenceSpeed = getReferenceBallSpeed();
  const primaryDirection = ball.vy < 0 ? -1 : 1;
  while (balls.length < GAME.partyMaxBalls) {
    const index = balls.length;
    const bonusBall = createBall({ isBonus: true });
    const direction = index % 2 === 0 ? -primaryDirection : primaryDirection;
    const offset = index % 2 === 0 ? 0.18 : -0.18;
    launchBallEntity(bonusBall, direction, referenceSpeed, offset);
    balls.push(bonusBall);
  }
}

function removePartyBalls() {
  for (let index = balls.length - 1; index >= 0; index -= 1) {
    if (balls[index].isBonus) balls.splice(index, 1);
  }
}

function resetPartyState() {
  partyState.multiball = 0;
  partyState.multiballOwner = null;
  partyState.round = 0;
  partyState.roundOwner = null;
  for (const side of ["top", "bottom"]) {
    Object.assign(partyState[side], {
      paddle: 0,
      goal: 0,
      weapon: 0,
      stun: 0,
      cooldown: 0,
    });
  }
  removePartyBalls();
  partyItems.length = 0;
  projectiles.length = 0;
  pendingPartyEffects.length = 0;
  partyNotices.length = 0;
  partyItemTimer = GAME.partyFirstItemDelay;
  lastPartyItemType = null;
  arenaRoundness = 0;
  partyHudSignature = "";
  updatePartyHud();
}

function updatePartyEffects(dt) {
  const multiballWasActive = partyState.multiball > 0;
  const roundWasActive = partyState.round > 0;
  const paddleWasActive = {
    top: partyState.top.paddle > 0,
    bottom: partyState.bottom.paddle > 0,
  };

  partyState.multiball = Math.max(0, partyState.multiball - dt);
  partyState.round = Math.max(0, partyState.round - dt);
  for (const side of ["top", "bottom"]) {
    const personalState = partyState[side];
    personalState.paddle = Math.max(0, personalState.paddle - dt);
    personalState.goal = Math.max(0, personalState.goal - dt);
    personalState.weapon = Math.max(0, personalState.weapon - dt);
    personalState.stun = Math.max(0, personalState.stun - dt);
    personalState.cooldown = Math.max(0, personalState.cooldown - dt);
  }

  if (multiballWasActive && partyState.multiball <= 0) {
    removePartyBalls();
    partyState.multiballOwner = null;
  }
  if (roundWasActive && partyState.round <= 0) {
    partyState.roundOwner = null;
    arenaRoundness = 0;
    constrainPaddle(cpu, "top");
    constrainPaddle(player, "bottom");
    clampPaddleTarget(cpu, "top");
    clampPaddleTarget(player, "bottom");
  }
  if (
    paddleWasActive.top !== (partyState.top.paddle > 0)
    || paddleWasActive.bottom !== (partyState.bottom.paddle > 0)
  ) {
    updatePaddleSizes();
    if (paddleWasActive.top && partyState.top.paddle <= 0) {
      cpu.radius = cpu.targetRadius;
      constrainPaddle(cpu, "top");
      clampPaddleTarget(cpu, "top");
    }
    if (paddleWasActive.bottom && partyState.bottom.paddle <= 0) {
      player.radius = player.targetRadius;
      constrainPaddle(player, "bottom");
      clampPaddleTarget(player, "bottom");
    }
  }
  updatePartyHud();
}

function updateArenaRoundness() {
  const target = isPartyActive() && partyState.round > 0 ? 1 : 0;
  arenaRoundness = target;
}

function choosePartyItemType() {
  const choices = PARTY_ITEM_TYPES.filter((type) => type !== lastPartyItemType);
  const type = choices[Math.floor(Math.random() * choices.length)];
  lastPartyItemType = type;
  return type;
}

function spawnPartyItem(type = choosePartyItemType()) {
  if (!isPartyActive() || state !== STATES.PLAYING || partyItems.length) return null;
  const speed = getReferenceBallSpeed();
  let angle = Math.random() * Math.PI * 2;
  if (Math.abs(Math.sin(angle)) < 0.32) {
    angle += Math.sin(angle) < 0 ? -0.42 : 0.42;
  }
  const item = {
    type,
    x: GAME.width / 2,
    y: GAME.height / 2,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius: GAME.ballRadius,
  };
  partyItems.push(item);
  return item;
}

function updatePartyItems(dt) {
  if (!partyItems.length) {
    partyItemTimer -= dt;
    if (partyItemTimer <= 0) spawnPartyItem();
  }

  for (let index = partyItems.length - 1; index >= 0; index -= 1) {
    const item = partyItems[index];
    const speed = Math.hypot(item.vx, item.vy);
    const stepCount = Math.max(
      1,
      Math.ceil(
        ((speed + GAME.playerMaxSpeed) * dt) / GAME.physicsTravelPerStep,
      ),
    );
    const stepTime = dt / stepCount;
    let removeItem = false;

    for (let step = 0; step < stepCount; step += 1) {
      positionPaddlesAtFrameProgress((step + 1) / stepCount);
      item.x += item.vx * stepTime;
      item.y += item.vy * stepTime;
      resolveArenaSideCollision(item, true);

      if (item.y < -item.radius || item.y > GAME.height + item.radius) {
        removeItem = true;
        break;
      }
      if (getPaddleCollision(item, cpu)) {
        collectPartyEffect(item.type, "top");
        removeItem = true;
        break;
      }
      if (getPaddleCollision(item, player)) {
        collectPartyEffect(item.type, "bottom");
        removeItem = true;
        break;
      }
    }

    if (removeItem) {
      partyItems.splice(index, 1);
      partyItemTimer = randomPartyItemDelay();
    }
  }
}

function collectPartyEffect(type, side) {
  if (paddleFrameMotion) {
    pendingPartyEffects.push({ type, side });
    return;
  }
  activatePartyEffect(type, side);
}

function flushPendingPartyEffects() {
  const effects = pendingPartyEffects.splice(0);
  for (const effect of effects) activatePartyEffect(effect.type, effect.side);
}

function activatePartyEffect(type, side) {
  const duration = GAME.partyEffectSeconds;
  if (type === "multiball") {
    partyState.multiball = duration;
    partyState.multiballOwner = side;
    ensurePartyBalls();
  } else if (type === "round") {
    partyState.round = duration;
    partyState.roundOwner = side;
    arenaRoundness = 1;
    constrainPaddle(cpu, "top");
    constrainPaddle(player, "bottom");
    clampPaddleTarget(cpu, "top");
    clampPaddleTarget(player, "bottom");
  } else {
    partyState[side][type] = duration;
    if (type === "paddle") {
      updatePaddleSizes();
      const paddle = side === "top" ? cpu : player;
      paddle.radius = paddle.targetRadius;
      constrainPaddle(paddle, side);
      clampPaddleTarget(paddle, side);
    }
  }

  const sideLabel = side === "bottom"
    ? (selectedMode === "local" ? "1P" : "YOU")
    : (selectedMode === "local" ? "2P" : "CPU");
  const text = `${sideLabel} GET  ${PARTY_ITEMS[type].label}`;
  partyNotices.push({
    side,
    text,
    life: 0.9,
    duration: 0.9,
  });
  if (partyAnnouncement) partyAnnouncement.textContent = text;
  playTone(660, 0.08, { type: "square", volume: 0.035 });
  playTone(880, 0.1, { type: "square", volume: 0.025, delay: 0.07 });
  vibrate(28);
  updatePartyHud();
}

function fireProjectile(side) {
  if (
    !isPartyActive()
    || state !== STATES.PLAYING
    || partyState[side].weapon <= 0
    || partyState[side].cooldown > 0
  ) return false;

  const paddle = side === "top" ? cpu : player;
  const direction = side === "top" ? 1 : -1;
  const extents = getPaddleExtents(paddle);
  projectiles.push({
    owner: side,
    x: paddle.x,
    y: paddle.y + direction * (extents.y + GAME.projectileRadius + 4),
    vx: 0,
    vy: direction * getReferenceBallSpeed(),
    radius: GAME.projectileRadius,
  });
  partyState[side].cooldown = GAME.projectileCooldown;
  playTone(520, 0.06, { type: "square", volume: 0.025, endFrequency: 760 });
  updatePartyHud();
  return true;
}

function updateProjectiles(dt) {
  for (let index = projectiles.length - 1; index >= 0; index -= 1) {
    const projectile = projectiles[index];
    const speed = Math.hypot(projectile.vx, projectile.vy);
    const stepCount = Math.max(
      1,
      Math.ceil(
        ((speed + GAME.playerMaxSpeed) * dt) / GAME.physicsTravelPerStep,
      ),
    );
    const stepTime = dt / stepCount;
    const targetSide = projectile.owner === "top" ? "bottom" : "top";
    const targetPaddle = targetSide === "top" ? cpu : player;
    let removeProjectile = false;

    for (let step = 0; step < stepCount; step += 1) {
      positionPaddlesAtFrameProgress((step + 1) / stepCount);
      projectile.x += projectile.vx * stepTime;
      projectile.y += projectile.vy * stepTime;
      const bounds = getArenaHorizontalBounds(projectile.y, projectile.radius);
      if (
        projectile.y - projectile.radius <= GAME.wall
        || projectile.y + projectile.radius >= GAME.height - GAME.wall
        || projectile.x < bounds.left
        || projectile.x > bounds.right
      ) {
        removeProjectile = true;
        break;
      }
      if (getPaddleCollision(projectile, targetPaddle)) {
        partyState[targetSide].stun = Math.max(
          partyState[targetSide].stun,
          GAME.projectileStunSeconds,
        );
        targetPaddle.vx = 0;
        targetPaddle.vy = 0;
        freezePaddleFrame(targetSide, (step + 1) / stepCount);
        removeProjectile = true;
        playTone(180, 0.12, { type: "sawtooth", volume: 0.03, endFrequency: 90 });
        vibrate(35);
        break;
      }
    }

    if (removeProjectile) projectiles.splice(index, 1);
  }
}

function getEffectRemaining(side, effect) {
  if (effect === "multiball") {
    return partyState.multiball;
  }
  if (effect === "round") {
    return partyState.round;
  }
  return partyState[side][effect];
}

function updateEffectSlots(container, side) {
  if (!container) return;
  container.querySelectorAll("[data-effect]").forEach((slot) => {
    const effect = slot.dataset.effect;
    const remaining = getEffectRemaining(side, effect);
    const active = isPartyActive() && remaining > 0;
    slot.classList.toggle("active", active);
    slot.style.setProperty("--effect-progress", String(clamp(remaining / GAME.partyEffectSeconds, 0, 1)));
    const timer = slot.querySelector("em");
    if (timer) timer.textContent = active ? String(Math.ceil(remaining)) : "";
    if (effect === "weapon") {
      slot.classList.toggle("cooling", active && partyState[side].cooldown > 0);
      slot.style.setProperty(
        "--cooldown-progress",
        String(clamp(partyState[side].cooldown / GAME.projectileCooldown, 0, 1)),
      );
    }
  });
}

function updatePartyHud() {
  const getSideSignature = (side) => PARTY_ITEM_TYPES.map((effect) => ({
    effect,
    seconds: Math.ceil(getEffectRemaining(side, effect)),
    cooling: effect === "weapon"
      ? Math.ceil(partyState[side].cooldown * 10)
      : 0,
  }));
  const signature = JSON.stringify({
    selectedRule,
    top: getSideSignature("top"),
    bottom: getSideSignature("bottom"),
  });
  if (signature === partyHudSignature) return;
  partyHudSignature = signature;
  updateEffectSlots(topEffectsElement, "top");
  updateEffectSlots(bottomEffectsElement, "bottom");
}

function updateRipples(dt) {
  for (let i = ripples.length - 1; i >= 0; i -= 1) {
    ripples[i].life -= dt;
    if (ripples[i].life <= 0) ripples.splice(i, 1);
  }
  for (let i = partyNotices.length - 1; i >= 0; i -= 1) {
    partyNotices[i].life -= dt;
    if (partyNotices[i].life <= 0) partyNotices.splice(i, 1);
  }
}

function update(dt) {
  if (state === STATES.PAUSED) return;

  updateRipples(dt);
  updateArenaRoundness();
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
    if (isPartyActive()) updatePartyEffects(dt);
    beginPaddleFrame(Math.max(dt, 0.0001));
    updatePlayer(dt);
    if (selectedMode === "cpu") updateCpu(dt);
    else updateSecondPlayer(dt);
    finishPaddleFrame();
    if (isPartyActive()) {
      updatePartyItems(dt);
      updateProjectiles(dt);
    }
    updateBalls(dt);
    restorePaddlesAfterPhysics();
    flushPendingPartyEffects();
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
  balls.forEach(drawBall);
  if (isPartyActive()) {
    drawPartyItems();
    drawProjectiles();
    drawPartyNotices();
  }

  if (state === STATES.COUNTDOWN) drawCountdown();
  if (state === STATES.SCORED) drawMessage(scoredMessage);
}

function traceRoundedRectPath(x, y, width, height, radius) {
  const safeRadius = clamp(radius, 0, Math.min(width, height) / 2);
  ctx.beginPath();
  if (safeRadius < 0.01) {
    ctx.rect(x, y, width, height);
    ctx.closePath();
    return;
  }
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.arcTo(x + width, y, x + width, y + safeRadius, safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.arcTo(
    x + width,
    y + height,
    x + width - safeRadius,
    y + height,
    safeRadius,
  );
  ctx.lineTo(x + safeRadius, y + height);
  ctx.arcTo(x, y + height, x, y + height - safeRadius, safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.arcTo(x, y, x + safeRadius, y, safeRadius);
  ctx.closePath();
}

function drawTable() {
  const arenaDifficulty = getArenaDifficulty();
  const cornerRadius = getArenaCornerRadius();
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
  ctx.save();
  traceRoundedRectPath(0, 0, GAME.width, GAME.height, cornerRadius + GAME.wall);
  ctx.clip();
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
  ctx.restore();

  ctx.strokeStyle = arenaDifficulty === "easy"
    ? "#3d2115"
    : arenaDifficulty === "normal" ? "#063e29" : "#07101b";
  ctx.lineWidth = GAME.wall * 2;
  traceRoundedRectPath(0, 0, GAME.width, GAME.height, cornerRadius + GAME.wall);
  ctx.stroke();
  ctx.strokeStyle = arenaDifficulty === "hard"
    ? `rgba(85, 196, 255, ${0.38 + selectedHardLevel * 0.08})`
    : "rgba(240, 235, 190, 0.45)";
  ctx.lineWidth = 2;
  traceRoundedRectPath(
    GAME.wall,
    GAME.wall,
    GAME.width - GAME.wall * 2,
    GAME.height - GAME.wall * 2,
    cornerRadius,
  );
  ctx.stroke();
}

function drawGoals() {
  const topGoal = getGoalBounds("top");
  const bottomGoal = getGoalBounds("bottom");
  ctx.fillStyle = "#24130d";
  ctx.fillRect(topGoal.left, 0, topGoal.width, GAME.wall + 7);
  ctx.fillRect(
    bottomGoal.left,
    GAME.height - GAME.wall - 7,
    bottomGoal.width,
    GAME.wall + 7,
  );

  ctx.strokeStyle = getArenaDifficulty() === "hard" ? "#86d9ff" : "#f0e0a5";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(topGoal.left, GAME.wall + 8);
  ctx.lineTo(topGoal.left, 4);
  ctx.lineTo(topGoal.right, 4);
  ctx.lineTo(topGoal.right, GAME.wall + 8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(bottomGoal.left, GAME.height - GAME.wall - 8);
  ctx.lineTo(bottomGoal.left, GAME.height - 4);
  ctx.lineTo(bottomGoal.right, GAME.height - 4);
  ctx.lineTo(bottomGoal.right, GAME.height - GAME.wall - 8);
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

  const side = isCpu ? "top" : "bottom";
  if (isPartyActive() && partyState[side].stun > 0) {
    ctx.save();
    ctx.strokeStyle = "rgba(135, 224, 255, 0.95)";
    ctx.fillStyle = "rgba(108, 195, 255, 0.18)";
    ctx.lineWidth = 4;
    ctx.shadowColor = "#79dfff";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(paddle.x, paddle.y, Math.max(extents.x, extents.y) + 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawBall(activeBall) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 7;
  ctx.shadowOffsetY = 4;
  const gradient = ctx.createRadialGradient(
    activeBall.x - 3,
    activeBall.y - 4,
    1,
    activeBall.x,
    activeBall.y,
    activeBall.radius,
  );
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.4, "#fff4bd");
  gradient.addColorStop(1, "#e5b85b");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(activeBall.x, activeBall.y, activeBall.radius, 0, Math.PI * 2);
  ctx.fill();
  if (activeBall.isBonus) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

function drawPartyItems() {
  for (const item of partyItems) {
    const style = PARTY_ITEMS[item.type];
    const speed = Math.hypot(item.vx, item.vy) || 1;
    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.fillStyle = style.color;
    ctx.shadowColor = style.color;
    ctx.shadowBlur = 14;
    ctx.globalAlpha = 0.46;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(item.x, item.y);
    ctx.lineTo(item.x - (item.vx / speed) * 20, item.y - (item.vy / speed) * 20);
    ctx.stroke();
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.arc(item.x, item.y, item.radius + 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
    ctx.fillStyle = "#17201d";
    ctx.fill();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    drawPartyItemSymbol(item);
    ctx.restore();
  }
}

function drawPartyItemSymbol(item) {
  const style = PARTY_ITEMS[item.type];
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineWidth = 1.7;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 11px system-ui";

  if (item.type === "multiball") {
    for (const offset of [-4, 0, 4]) {
      ctx.beginPath();
      ctx.arc(item.x + offset, item.y, 2.1, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (item.type === "paddle") {
    ctx.fillRect(item.x - 6, item.y - 2, 12, 4);
    ctx.beginPath();
    ctx.moveTo(item.x - 7, item.y - 5);
    ctx.lineTo(item.x - 9, item.y);
    ctx.lineTo(item.x - 7, item.y + 5);
    ctx.moveTo(item.x + 7, item.y - 5);
    ctx.lineTo(item.x + 9, item.y);
    ctx.lineTo(item.x + 7, item.y + 5);
    ctx.stroke();
  } else if (item.type === "goal") {
    ctx.beginPath();
    ctx.moveTo(item.x - 7, item.y - 6);
    ctx.lineTo(item.x - 7, item.y + 6);
    ctx.lineTo(item.x - 3, item.y + 6);
    ctx.moveTo(item.x + 7, item.y - 6);
    ctx.lineTo(item.x + 7, item.y + 6);
    ctx.lineTo(item.x + 3, item.y + 6);
    ctx.stroke();
  } else if (item.type === "round") {
    ctx.beginPath();
    ctx.arc(item.x, item.y, 6, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillText("S", item.x, item.y + 0.5);
  }
}

function drawProjectiles() {
  for (const projectile of projectiles) {
    const color = projectile.owner === "top" ? "#ff8f9f" : "#7ce9df";
    const direction = projectile.vy < 0 ? 1 : -1;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = "#f5ffff";
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(projectile.x, projectile.y);
    ctx.lineTo(projectile.x, projectile.y + direction * 18);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawPartyNotices() {
  for (const notice of partyNotices) {
    const progress = notice.life / notice.duration;
    const isTop = notice.side === "top";
    const rotation = isTop && selectedMode === "local" ? Math.PI : 0;
    const y = isTop ? 285 : 515;
    ctx.save();
    ctx.globalAlpha = Math.min(1, progress * 2.5);
    drawOrientedMessage(notice.text, y, rotation, 18);
    ctx.restore();
  }
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
  ctx.lineWidth = Math.min(10, Math.max(2, fontSize * 0.14));
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
  const verticalBounds = getPaddleVerticalBounds(paddle, side);
  paddle.targetY = clamp(y, verticalBounds.min, verticalBounds.max);
  const horizontalBounds = getPaddleHorizontalBounds(paddle, paddle.targetY);
  paddle.targetX = clamp(
    position.x,
    horizontalBounds.left,
    horizontalBounds.right,
  );
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
  const position = getPointerPosition(event);
  if (selectedMode === "cpu" && position.y < GAME.centerY) return;
  const side = getPointerSide(event);
  const owner = sideOwners.get(side);
  const canPrepareShot = isPartyActive()
    && state === STATES.PLAYING
    && partyState[side].weapon > 0;
  if (canPrepareShot) {
    pointerGestures.set(event.pointerId, {
      side,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      maxDistance: 0,
      fireOnly: owner !== undefined && owner !== event.pointerId,
      promoted: false,
    });
    try {
      canvas.setPointerCapture?.(event.pointerId);
    } catch {
      // Some browsers reject capture for secondary touch pointers.
    }
    if (event.cancelable) event.preventDefault();
    if (owner !== undefined && owner !== event.pointerId) return;
    activePointers.set(event.pointerId, side);
    sideOwners.set(side, event.pointerId);
    return;
  }
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

function movePointer(event) {
  const gesture = pointerGestures.get(event.pointerId);
  if (gesture) {
    gesture.maxDistance = Math.max(
      gesture.maxDistance,
      Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY),
    );
    if (!gesture.fireOnly && !gesture.promoted && gesture.maxDistance > 10) {
      gesture.promoted = true;
      handlePointer(event, gesture.side);
    } else if (gesture.promoted) {
      handlePointer(event, gesture.side, false);
    } else if (event.cancelable) {
      event.preventDefault();
    }
    return;
  }

  const assignedSide = activePointers.get(event.pointerId);
  if (assignedSide) {
    handlePointer(event, assignedSide, false);
  } else if (event.pointerType === "mouse") {
    const hoveredSide = getPointerSide(event);
    if (!sideOwners.has(hoveredSide)) handlePointer(event, hoveredSide, false);
  }
}

function releasePointer(event) {
  const gesture = pointerGestures.get(event.pointerId);
  if (gesture) {
    gesture.maxDistance = Math.max(
      gesture.maxDistance,
      Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY),
    );
    const duration = performance.now() - gesture.startedAt;
    if (
      event.type === "pointerup"
      && duration <= 240
      && gesture.maxDistance <= 10
      && !gesture.promoted
    ) fireProjectile(gesture.side);
    pointerGestures.delete(event.pointerId);
  }
  const side = activePointers.get(event.pointerId);
  if (side) {
    activePointers.delete(event.pointerId);
    if (sideOwners.get(side) === event.pointerId) sideOwners.delete(side);
  }
  try {
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  } catch {
    // キャプチャが先に失われていても入力状態は解放する。
  }
}

function releaseAllPointers() {
  activePointers.clear();
  sideOwners.clear();
  pointerGestures.clear();
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
  updateStartButtonText();
  controlHelp.children[0].textContent = isLocal ? "2P ↑ 上側" : "CPU ↑ 上側";
  controlHelp.children[1].textContent = isLocal ? "1P ↓ 下側" : "YOU ↓ 下側";
  gameFrame.setAttribute("aria-label", isLocal ? "1台で遊ぶ2人用ピンポンゲーム" : "CPU対戦ピンポンゲーム");
  releaseAllPointers();
  modeButtons.forEach((button) => {
    const selected = button.dataset.mode === mode;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
}

function updateStartButtonText() {
  if (selectedRule === "party") {
    startButton.textContent = selectedMode === "local"
      ? "パーティー対戦スタート"
      : "CPUパーティースタート";
    return;
  }
  startButton.textContent = selectedMode === "local"
    ? "2人対戦スタート"
    : "CPU対戦スタート";
}

function selectRule(rule) {
  selectedRule = rule;
  const isParty = rule === "party";
  gameFrame.classList.toggle("party-mode", isParty);
  partyLegend?.classList.toggle("hidden", !isParty);
  if (!isParty) resetPartyState();
  updatePaddleSizes();
  updateStartButtonText();
  ruleButtons.forEach((button) => {
    const selected = button.dataset.rule === rule;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  partyHudSignature = "";
  updatePartyHud();
}

modeButtons.forEach((button) => {
  button.addEventListener("click", () => selectMode(button.dataset.mode));
});

ruleButtons.forEach((button) => {
  button.addEventListener("click", () => selectRule(button.dataset.rule));
});

shapeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedShape = button.dataset.shape;
    shapeButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-checked", String(selected));
      item.tabIndex = selected ? 0 : -1;
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
      item.tabIndex = selected ? 0 : -1;
    });
  });
});

function enableChoiceKeyboard(buttons) {
  buttons.forEach((button, index) => {
    button.tabIndex = button.classList.contains("selected") ? 0 : -1;
    button.addEventListener("keydown", (event) => {
      const direction = ["ArrowRight", "ArrowDown"].includes(event.key)
        ? 1
        : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
      if (!direction) return;
      event.preventDefault();
      const nextIndex = (index + direction + buttons.length) % buttons.length;
      buttons[nextIndex].focus();
      buttons[nextIndex].click();
    });
  });
}

enableChoiceKeyboard(modeButtons);
enableChoiceKeyboard(ruleButtons);
enableChoiceKeyboard(shapeButtons);
enableChoiceKeyboard(difficultyButtons);

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
canvas.addEventListener("pointermove", movePointer, { passive: false });
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
selectRule(selectedRule);
updateScoreDisplay();
resizeCanvas();
requestAnimationFrame(gameLoop);
