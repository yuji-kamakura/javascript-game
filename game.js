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
const difficultyButtons = [...document.querySelectorAll(".difficulty")];

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
  hard: { reaction: 0.1, speed: 355, error: 13 },
});

let state = STATES.MENU;
let selectedDifficulty = "normal";
let playerScore = 0;
let cpuScore = 0;
let countdownRemaining = GAME.countdownSeconds;
let scoredTimer = 0;
let nextServeDirection = -1;
let lastTime = performance.now();
let stateBeforePause = STATES.PLAYING;

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
  playerScore = 0;
  cpuScore = 0;
  nextServeDirection = -1;
  updateScoreDisplay();
  menuElement.classList.add("hidden");
  gameOverElement.classList.add("hidden");
  pauseMenuElement.classList.add("hidden");
  beginCountdown();
}

function pauseGame() {
  if (![STATES.PLAYING, STATES.COUNTDOWN, STATES.SCORED].includes(state)) return;
  stateBeforePause = state;
  state = STATES.PAUSED;
  pauseMenuElement.classList.remove("hidden");
}

function resumeGame() {
  if (state !== STATES.PAUSED) return;
  state = stateBeforePause;
  pauseMenuElement.classList.add("hidden");
  lastTime = performance.now();
}

function quitToMenu() {
  if (state !== STATES.PAUSED) return;
  state = STATES.MENU;
  playerScore = 0;
  cpuScore = 0;
  updateScoreDisplay();
  resetPositions();
  pauseMenuElement.classList.add("hidden");
  gameOverElement.classList.add("hidden");
  menuElement.classList.remove("hidden");
}

function updateScoreDisplay() {
  cpuScoreElement.textContent = cpuScore;
  playerScoreElement.textContent = playerScore;
}

function scorePoint(scorer) {
  if (state !== STATES.PLAYING) return;

  if (scorer === "player") playerScore += 1;
  else cpuScore += 1;

  updateScoreDisplay();
  ball.vx = 0;
  ball.vy = 0;

  if (playerScore >= GAME.winScore || cpuScore >= GAME.winScore) {
    state = STATES.GAME_OVER;
    resultTextElement.textContent = playerScore > cpuScore ? "あなたの勝ち！" : "CPUの勝ち";
    finalScoreElement.textContent = `${playerScore} - ${cpuScore}`;
    gameOverElement.classList.remove("hidden");
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
  const settings = DIFFICULTIES[selectedDifficulty];
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
  } else if (ball.x > right) {
    ball.x = right;
    ball.vx = -Math.abs(ball.vx);
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
  }
}

function draw() {
  drawTable();
  drawGoals();
  drawCenterLine();
  drawRipples();
  drawPaddle(cpu, "#c46b55");
  drawPaddle(player, "#4c9f9a");
  drawBall();

  if (state === STATES.COUNTDOWN) drawCountdown();
  if (state === STATES.SCORED) drawMessage("POINT!");
}

function drawTable() {
  const gradient = ctx.createLinearGradient(0, 0, GAME.width, GAME.height);
  gradient.addColorStop(0, "#a56537");
  gradient.addColorStop(0.5, "#8d512d");
  gradient.addColorStop(1, "#704025");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, GAME.width, GAME.height);

  ctx.save();
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
  ctx.restore();

  ctx.strokeStyle = "#3d2115";
  ctx.lineWidth = GAME.wall * 2;
  ctx.strokeRect(0, 0, GAME.width, GAME.height);
  ctx.strokeStyle = "rgba(240, 196, 133, 0.45)";
  ctx.lineWidth = 2;
  ctx.strokeRect(GAME.wall, GAME.wall, GAME.width - GAME.wall * 2, GAME.height - GAME.wall * 2);
}

function drawGoals() {
  const x = (GAME.width - GAME.goalWidth) / 2;
  ctx.fillStyle = "#24130d";
  ctx.fillRect(x, 0, GAME.goalWidth, GAME.wall + 7);
  ctx.fillRect(x, GAME.height - GAME.wall - 7, GAME.goalWidth, GAME.wall + 7);

  ctx.strokeStyle = "#f0c579";
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
  ctx.strokeStyle = "rgba(255, 236, 196, 0.5)";
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

function drawPaddle(paddle, rimColor) {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = 11;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = "#cfc9bd";
  ctx.beginPath();
  ctx.arc(paddle.x, paddle.y + 4, paddle.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";

  const gradient = ctx.createRadialGradient(
    paddle.x - 10,
    paddle.y - 12,
    3,
    paddle.x,
    paddle.y,
    paddle.radius,
  );
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.72, "#f4f0e7");
  gradient.addColorStop(1, "#cfc9bd");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(paddle.x, paddle.y, paddle.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = rimColor;
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

function handlePointer(event) {
  if (state !== STATES.PLAYING && state !== STATES.COUNTDOWN) return;
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * GAME.width;
  const y = ((event.clientY - rect.top) / rect.height) * GAME.height;
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
  ripples.push({ x: player.targetX, y: player.targetY, life: 0.38, duration: 0.38 });
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
    difficultyButtons.forEach((item) => {
      const selected = item === button;
      item.classList.toggle("selected", selected);
      item.setAttribute("aria-checked", String(selected));
    });
  });
});

startButton.addEventListener("click", startGame);
restartButton.addEventListener("click", startGame);
resumeButton.addEventListener("click", resumeGame);
quitButton.addEventListener("click", quitToMenu);
canvas.addEventListener("pointerdown", handlePointer, { passive: false });
canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType === "mouse") handlePointer(event);
}, { passive: false });
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("resize", resizeCanvas);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  event.preventDefault();
  if (state === STATES.PAUSED) resumeGame();
  else pauseGame();
});

resizeCanvas();
requestAnimationFrame(gameLoop);
