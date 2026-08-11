"use strict";

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const cpuScoreElement = document.getElementById("cpuScore");
const playerScoreElement = document.getElementById("playerScore");
const menuElement = document.getElementById("menu");
const gameOverElement = document.getElementById("gameOver");
const resultTextElement = document.getElementById("resultText");
const finalScoreElement = document.getElementById("finalScore");
const startButton = document.getElementById("startButton");
const restartButton = document.getElementById("restartButton");
const pauseMenuElement = document.getElementById("pauseMenu");
const resumeButton = document.getElementById("resumeButton");
const quitButton = document.getElementById("quitButton");
const headerMenuButton = document.getElementById("headerMenuButton");
const hardLevelPanel = document.getElementById("hardLevelPanel");
const hardLevelLabel = document.getElementById("hardLevelLabel");
const difficultyButtons = [...document.querySelectorAll(".difficulty")];
const hardLevelButtons = [...document.querySelectorAll(".level")];

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
let activeTouchPointerId = null;

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
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
  if (selectedDifficulty === "easy") {
    return {
      interval: 480,
      type: "triangle",
      volume: 0.018,
      notes: [261.63, 329.63, 392, 329.63, 293.66, 349.23, 392, 329.63],
    };
  }

  if (selectedDifficulty === "normal") {
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

  if (selectedDifficulty === "hard" && bgmStep % 4 === 0) {
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
  Object.assign(player, createPaddle(GAME.width / 2, 650));
  Object.assign(cpu, createPaddle(GAME.width / 2, 132));
  ball.x = GAME.width / 2;
  ball.y = GAME.height / 2;
  ball.vx = 0;
  ball.vy = 0;
  cpuControl.targetX = cpu.x;
  cpuControl.targetY = cpu.y;
  cpuControl.timer = 0;
  ripples.length = 0;
}

function beginCountdown() {
  state = STATES.COUNTDOWN;
  countdownRemaining = GAME.countdownSeconds;
  resetPositions();
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
  playerScore = 0;
  cpuScore = 0;
  nextServeDirection = -1;
  updateScoreDisplay();
  menuElement.classList.add("hidden");
  gameOverElement.classList.add("hidden");
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
  state = STATES.MENU;
  stopBgm();
  playerScore = 0;
  cpuScore = 0;
  updateScoreDisplay();
  resetPositions();
  pauseMenuElement.classList.add("hidden");
  gameOverElement.classList.add("hidden");
  menuElement.classList.remove("hidden");
}

function updateScoreDisplay(scorer = null) {
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
    resultTextElement.textContent = playerScore > cpuScore ? "あなたの勝ち！" : "CPUの勝ち";
    finalScoreElement.textContent = `${playerScore} - ${cpuScore}`;
    const winnerElement = playerScore > cpuScore ? playerScoreElement : cpuScoreElement;
    winnerElement.parentElement.classList.add("victory-score");
    playSound(playerScore > cpuScore ? "win" : "lose");
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

function updateCpu(dt) {
  const settings = selectedDifficulty === "hard"
    ? DIFFICULTIES.hard[selectedHardLevel - 1]
    : DIFFICULTIES[selectedDifficulty];
  cpuControl.timer -= dt;

  if (cpuControl.timer <= 0) {
    cpuControl.timer = settings.reaction;
    const trackingBall = ball.vy < 0 || ball.y < GAME.centerY + 70;
    const error = (Math.random() * 2 - 1) * settings.error;
    cpuControl.targetX = trackingBall ? ball.x + error : GAME.width / 2;
    cpuControl.targetY = trackingBall
      ? clamp(ball.y - 75, 85, GAME.centerY - 65)
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
  paddle.x = clamp(
    paddle.x,
    GAME.wall + paddle.radius,
    GAME.width - GAME.wall - paddle.radius,
  );

  if (side === "top") {
    paddle.y = clamp(
      paddle.y,
      GAME.wall + 52 + paddle.radius,
      GAME.centerY - 28 - paddle.radius,
    );
  } else {
    paddle.y = clamp(
      paddle.y,
      GAME.centerY + 28 + paddle.radius,
      GAME.height - GAME.wall - 52 - paddle.radius,
    );
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
  let dx = ball.x - paddle.x;
  let dy = ball.y - paddle.y;
  let distance = Math.hypot(dx, dy);
  const collisionDistance = ball.radius + paddle.radius;

  if (distance > collisionDistance) return;

  if (distance < 0.001) {
    const ballSpeed = Math.hypot(ball.vx, ball.vy) || 1;
    dx = -ball.vx / ballSpeed;
    dy = -ball.vy / ballSpeed;
    distance = 1;
  }

  const normalX = dx / distance;
  const normalY = dy / distance;

  // 重なりを解消し、同じ接触で連続反射することを防ぐ。
  ball.x = paddle.x + normalX * (collisionDistance + 1);
  ball.y = paddle.y + normalY * (collisionDistance + 1);

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

  if (state === STATES.COUNTDOWN) {
    updatePlayer(dt);
    updateCpu(dt);
    countdownRemaining -= dt;
    if (countdownRemaining <= 0) launchBall();
    return;
  }

  if (state === STATES.PLAYING) {
    updatePlayer(dt);
    updateCpu(dt);
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
  const gradient = ctx.createLinearGradient(0, 0, GAME.width, GAME.height);
  if (selectedDifficulty === "easy") {
    gradient.addColorStop(0, "#a56537");
    gradient.addColorStop(0.5, "#8d512d");
    gradient.addColorStop(1, "#704025");
  } else if (selectedDifficulty === "normal") {
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
  if (selectedDifficulty === "easy") {
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
    const gridSize = selectedDifficulty === "hard" ? 40 : 60;
    ctx.globalAlpha = selectedDifficulty === "hard" ? 0.18 + selectedHardLevel * 0.025 : 0.12;
    ctx.strokeStyle = selectedDifficulty === "hard" ? "#88cfff" : "#d7ffe9";
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

  ctx.strokeStyle = selectedDifficulty === "easy"
    ? "#3d2115"
    : selectedDifficulty === "normal" ? "#063e29" : "#07101b";
  ctx.lineWidth = GAME.wall * 2;
  ctx.strokeRect(0, 0, GAME.width, GAME.height);
  ctx.strokeStyle = selectedDifficulty === "hard"
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

  ctx.strokeStyle = selectedDifficulty === "hard" ? "#86d9ff" : "#f0e0a5";
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
  ctx.strokeStyle = selectedDifficulty === "hard"
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
  const hardStyle = isCpu && selectedDifficulty === "hard"
    ? HARD_PADDLE_COLORS[selectedHardLevel - 1]
    : null;
  const fillColor = hardStyle ? hardStyle.fill : "#f4f0e7";
  const edgeColor = hardStyle ? hardStyle.rim : rimColor;

  ctx.save();
  ctx.shadowColor = hardStyle ? hardStyle.glow : "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = hardStyle ? 10 + selectedHardLevel * 4 : 11;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = "#cfc9bd";
  ctx.beginPath();
  ctx.arc(paddle.x, paddle.y + 4, paddle.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";

  if (hardStyle && selectedHardLevel >= 3) {
    const teeth = 8 + selectedHardLevel * 2;
    ctx.fillStyle = edgeColor;
    for (let i = 0; i < teeth; i += 1) {
      const angle = (Math.PI * 2 * i) / teeth;
      const inner = paddle.radius - 1;
      const outer = paddle.radius + 3 + selectedHardLevel;
      ctx.beginPath();
      ctx.moveTo(
        paddle.x + Math.cos(angle - 0.09) * inner,
        paddle.y + Math.sin(angle - 0.09) * inner,
      );
      ctx.lineTo(paddle.x + Math.cos(angle) * outer, paddle.y + Math.sin(angle) * outer);
      ctx.lineTo(
        paddle.x + Math.cos(angle + 0.09) * inner,
        paddle.y + Math.sin(angle + 0.09) * inner,
      );
      ctx.fill();
    }
  }

  const gradient = ctx.createRadialGradient(
    paddle.x - 10,
    paddle.y - 12,
    3,
    paddle.x,
    paddle.y,
    paddle.radius,
  );
  gradient.addColorStop(0, hardStyle && selectedHardLevel === 5 ? "#777b85" : "#ffffff");
  gradient.addColorStop(0.72, fillColor);
  gradient.addColorStop(1, hardStyle && selectedHardLevel === 5 ? "#050608" : "#cfc9bd");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(paddle.x, paddle.y, paddle.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = edgeColor;
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(paddle.x, paddle.y, paddle.radius * 0.46, 0, Math.PI * 2);
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
    ctx.strokeStyle = `rgba(125, 225, 218, ${0.6 * (1 - progress)})`;
    ctx.lineWidth = 3 - progress * 2;
    ctx.stroke();
  }
}

function drawCountdown() {
  const value = Math.max(1, Math.ceil(countdownRemaining));
  drawMessage(String(value));
}

function drawMessage(text) {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "900 72px system-ui";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(54, 28, 16, 0.7)";
  ctx.strokeText(text, GAME.width / 2, GAME.height / 2);
  ctx.fillStyle = "#fff3cc";
  ctx.fillText(text, GAME.width / 2, GAME.height / 2);
  ctx.restore();
}

function handlePointer(event, showRipple = true) {
  if (state !== STATES.PLAYING && state !== STATES.COUNTDOWN) return;
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * GAME.width;
  const pointerY = ((event.clientY - rect.top) / rect.height) * GAME.height;
  const touchOffset = event.pointerType === "touch" ? player.radius * 1.5 : 0;
  const y = pointerY - touchOffset;
  player.targetX = clamp(
    x,
    GAME.wall + player.radius,
    GAME.width - GAME.wall - player.radius,
  );
  player.targetY = clamp(
    y,
    GAME.centerY + 28 + player.radius,
    GAME.height - GAME.wall - 52 - player.radius,
  );
  if (showRipple) {
    ripples.push({ x: player.targetX, y: player.targetY, life: 0.38, duration: 0.38 });
  }
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

difficultyButtons.forEach((button) => {
  button.addEventListener("click", () => {
    selectedDifficulty = button.dataset.level;
    hardLevelPanel.classList.toggle("hidden", selectedDifficulty !== "hard");
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
resumeButton.addEventListener("click", resumeGame);
quitButton.addEventListener("click", quitToMenu);
headerMenuButton.addEventListener("click", () => {
  if (state === STATES.PAUSED) resumeGame();
  else pauseGame();
});
canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "mouse") {
    activeTouchPointerId = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
  }
  handlePointer(event);
}, { passive: false });
canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType === "mouse" || event.pointerId === activeTouchPointerId) {
    handlePointer(event, false);
  }
}, { passive: false });
canvas.addEventListener("pointerup", (event) => {
  if (event.pointerId === activeTouchPointerId) activeTouchPointerId = null;
});
canvas.addEventListener("pointercancel", (event) => {
  if (event.pointerId === activeTouchPointerId) activeTouchPointerId = null;
});
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("resize", resizeCanvas);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  if (state === STATES.PAUSED) resumeGame();
  else pauseGame();
});

updateScoreDisplay();
resizeCanvas();
requestAnimationFrame(gameLoop);
