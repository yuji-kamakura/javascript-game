const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

let player = {
  x: 100,
  y: 200,
  width: 30,
  height: 30,
  hp: 10,
  maxHp: 10,
};

let enemies = [];
let bullets = [];
let enemyBullets = [];
let items = [];
let particles = [];

let bossActive = false;
let bossExitUnlocked = false;

let lastSoundTimes = {
  shoot: 0,
  hit: 0,
  damage: 0,
};
let audioCtx = null;

function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    audioCtx = null;
  }
}

function playSound(type) {
  initAudio();
  if (!audioCtx) return;

  const now = audioCtx.currentTime;
  const cooldowns = {
    shoot: 0.05,
    hit: 0.06,
    damage: 0.08,
  };

  if (now - (lastSoundTimes[type] || 0) < cooldowns[type]) {
    return;
  }

  lastSoundTimes[type] = now;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  let frequency = 440;
  let wave = "triangle";
  let volume = 0.03;
  let duration = 0.05;

  if (type === "shoot") {
    frequency = 900;
    wave = "triangle";
    volume = 0.03;
    duration = 0.05;
  } else if (type === "hit") {
    frequency = 260;
    wave = "square";
    volume = 0.035;
    duration = 0.05;
  } else if (type === "damage") {
    frequency = 120;
    wave = "sawtooth";
    volume = 0.035;
    duration = 0.06;
  }

  osc.type = wave;
  osc.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.start(now);
  osc.stop(now + duration);
}

function spawnParticles(x, y, type, count) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = Math.random() * 2 + (type === "player" ? 1.5 : 0.5);
    const radius = type === "player" ? 2 : 1.5;
    const color =
      type === "player"
        ? Math.random() < 0.5
          ? "#ff914d"
          : "#ff3b3b"
        : "#ffe066";
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius,
      alpha: 1,
      decay: 0.04 + Math.random() * 0.02,
      life: 18,
      color,
      type,
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= p.decay;
    p.life -= 1;
    if (p.alpha <= 0 || p.life <= 0) {
      particles.splice(i, 1);
    }
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.alpha);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const dx = p.vx * 2;
    const dy = p.vy * 2;
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + dx, p.y + dy);
    ctx.stroke();
    ctx.restore();
  }
}

let mouseX = 0;
let mouseY = 0;

function updatePointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  mouseX = (event.clientX - rect.left) * (canvas.width / rect.width);
  mouseY = (event.clientY - rect.top) * (canvas.height / rect.height);
}

canvas.addEventListener("mousemove", function (event) {
  updatePointerPosition(event);
});

let displayedHp = player.hp;

let shootCooldown = 0;
let shootInterval = 10;

let enemyShootInterval = 60;

let gunLength = 25;

let nextEnemyId = 0;

let rightPressed = false;
let leftPressed = false;
let upPressed = false;
let downPressed = false;
let playerFacingX = 1;
let playerFacingY = 0;

let spacePressed = false;
let zPressed = false;
let shiftPressed = false;
let mousePressed = false;

let stamina = 100;
let maxStamina = 100;
let staminaDrain = 1;
let staminaRecovery = 0.5;
let staminaExhausted = false;

let score = 0;
let kills = 0;

// バースト（一定期間横に5発発射可能）
let burstActive = false;
let burstTimer = 0;
const burstDuration = 300; // フレーム数（60FPSなら約5秒）

let highScore = Number(localStorage.getItem("highScore")) || 0;
let bestWave = Number(localStorage.getItem("bestWave")) || 1;

let wave = 1;
let enemiesToSpawn = 3;

let waveClearTimer = 0;
let waveMessageTimer = 0;
let gameTime = 0;

let gameState = "start";

// 永続通貨（銀行）と永久アップグレード
let bank = Number(localStorage.getItem("bank")) || 0;
let permanentUpgrades = JSON.parse(
  localStorage.getItem("permanentUpgrades"),
) || {
  hpLevel: 0, // each +1 max HP
  staminaLevel: 0, // each +10 max stamina
  damageLevel: 0, // each +10% damage
};

// 古いセーブデータにも村の新項目を補う
permanentUpgrades.hpLevel = permanentUpgrades.hpLevel || 0;
permanentUpgrades.staminaLevel = permanentUpgrades.staminaLevel || 0;
permanentUpgrades.damageLevel = permanentUpgrades.damageLevel || 0;
permanentUpgrades.autoAimUnlocked = permanentUpgrades.autoAimUnlocked || false;
permanentUpgrades.autoAimEnabled = permanentUpgrades.autoAimEnabled || false;

// ラン中のアップグレード（ボス選択で得られる、そのプレイ中のみ有効）
let runUpgrades = {
  piercing: false,
  damageMultiplier: 1,
  burstExtra: false, // additional burst spread
  bulletSpeedMultiplier: 1,
  shootCooldownMultiplier: 1,
  critChance: 0,
  burstDamageMultiplier: 1,
  killDamagePerKill: 0,
};

// ボス報酬UI状態
let bossOptions = [];
let bossRerollsLeft = 0;
const bossRerollCost = 10; // 銀行からのコスト
const autoAimUnlockCost = 10; // 通常敵約10体、初心者の1〜2回の挑戦を想定

let playerRecentlyHit = 0;
const bossDodgeThreshold = 220; // 無被弾でダウンまでのフレーム数
const bossStunDuration = 120; // ボスダウン中のフレーム数
const bossWarningDuration = 60; // ダウン前の警告時間

// ヘルパー: 永続アップグレード適用
function applyPermanentUpgrades() {
  // HP
  player.hp = Math.min(player.hp, 10 + permanentUpgrades.hpLevel);
  player.maxHp = 10 + permanentUpgrades.hpLevel;

  // スタミナ
  maxStamina = 100 + permanentUpgrades.staminaLevel * 10;

  // ダメージ
  // permanent damageLevel increases base multiplier
}

let bankedThisGame = false;

// ==================================================
// 壁生成
// ==================================================

function createWalls() {
  walls = [];

  const wallCount = 3;

  for (let i = 0; i < wallCount; i++) {
    let wall;
    let valid = false;

    while (!valid) {
      wall = {
        x: 50 + Math.random() * (canvas.width - 200),
        y: 50 + Math.random() * (canvas.height - 150),
        width: 100 + Math.random() * 60,
        height: 30 + Math.random() * 30,
      };

      valid = true;

      // プレイヤーの近くには置かない
      if (
        wall.x < player.x + player.width + 150 &&
        wall.x + wall.width > player.x - 150 &&
        wall.y < player.y + player.height + 150 &&
        wall.y + wall.height > player.y - 150
      ) {
        valid = false;
        continue;
      }

      // 他の壁と重ならない
      for (const other of walls) {
        if (
          wall.x < other.x + other.width &&
          wall.x + wall.width > other.x &&
          wall.y < other.y + other.height &&
          wall.y + wall.height > other.y
        ) {
          valid = false;
          break;
        }
      }
    }

    walls.push(wall);
  }
}

// ==================================================
// エイム方向
// ==================================================

function getAimDirection() {
  const playerCenterX = player.x + player.width / 2;
  const playerCenterY = player.y + player.height / 2;

  const autoTarget = gameState === "playing" ? getNearestEnemy() : null;
  let dx = autoTarget
    ? autoTarget.x + autoTarget.width / 2 - playerCenterX
    : mouseX - playerCenterX;
  let dy = autoTarget
    ? autoTarget.y + autoTarget.height / 2 - playerCenterY
    : mouseY - playerCenterY;

  const distance = Math.sqrt(dx * dx + dy * dy);

  if (distance > 0) {
    dx /= distance;
    dy /= distance;
  }

  return {
    x: dx,
    y: dy,
  };
}

// ==================================================
// 敵生成
// ==================================================

function createEnemy(x, y, type = "normal", parentId = null) {
  if (type === "normal") {
    const normalHp = 3 + Math.floor((wave - 1) / 2);

    enemies.push({
      id: nextEnemyId++,
      damaged: false,
      x: x,
      y: y,
      width: 50,
      height: 50,
      hp: normalHp,
      maxHp: normalHp,
      speed: 1,
      color: "yellow",
      type: "normal",
      shootCooldown: Math.random() * enemyShootInterval,
    });
  }

  if (type === "big") {
    const bigHp = 8 + Math.floor((wave - 1) / 2);

    enemies.push({
      id: nextEnemyId++,
      damaged: false,
      x: x,
      y: y,
      width: 80,
      height: 80,
      hp: bigHp,
      maxHp: bigHp,
      speed: 0.5,
      color: "orange",
      type: "big",
      shootCooldown: Math.random() * enemyShootInterval,
    });
  }

  if (type === "shooter") {
    const shooterHp = 4 + Math.floor((wave - 1) / 2);

    enemies.push({
      id: nextEnemyId++,
      damaged: false,
      x: x,
      y: y,
      width: 40,
      height: 40,
      hp: shooterHp,
      maxHp: shooterHp,
      speed: 1.5,
      color: "cyan",
      type: "shooter",
      shootCooldown: Math.random() * enemyShootInterval,
    });
  }

  if (type === "tullet") {
    const tulletHp = 6 + Math.floor((wave - 1) / 2);

    enemies.push({
      id: nextEnemyId++,
      damaged: false,
      x: x,
      y: y,
      width: 60,
      height: 60,
      hp: tulletHp,
      maxHp: tulletHp,
      speed: 0.1,
      color: "gray",
      type: "tullet",
      shootCooldown: Math.random() * enemyShootInterval,
    });
  }

  if (type === "laser") {
    let enemyCenterX = x + 45 / 2;
    let enemyCenterY = y + 45 / 2;

    let dx = player.x + player.width / 2 - enemyCenterX;
    let dy = player.y + player.height / 2 - enemyCenterY;

    let distance = Math.sqrt(dx * dx + dy * dy);

    let angle = 0;

    if (distance > 0) {
      angle = Math.atan2(dy, dx);
    }

    const laserHp = 2 + Math.floor((wave - 1) / 3);

    enemies.push({
      id: nextEnemyId++,
      damaged: false,
      x: x,
      y: y,
      width: 45,
      height: 45,
      hp: laserHp,
      maxHp: laserHp,
      speed: 0,
      color: "darkred",
      type: "laser",

      // 登場時の向きを保存
      angle: angle,

      // 登場してから発射するまでの待ち時間
      shootCooldown: 120,
    });
  }

  if (type === "spawner") {
    const spawnerHp = 7 + Math.floor((wave - 1) / 3);

    enemies.push({
      damaged: false,
      x: x,
      y: y,
      width: 60,
      height: 60,
      hp: spawnerHp,
      maxHp: spawnerHp,
      speed: 0.3,
      color: "gray",
      type: "spawner",
      id: nextEnemyId++,
      shootCooldown: Math.random() * enemyShootInterval,
    });
  }

  if (type === "minion") {
    let minionHp = 1;
    let minionSpeed = 1.5;

    if (parentId !== null) {
      const parentEnemy = enemies.find((e) => e.id === parentId);
      if (parentEnemy && parentEnemy.type === "boss") {
        // boss 由来の minion のみ Wave に応じて強化
        minionHp = 1 + Math.floor(wave / 3);
        minionSpeed = 1.5 + Math.floor(wave / 5) * 0.15;
      }
    }

    enemies.push({
      id: nextEnemyId++,
      damaged: false,
      x: x,
      y: y,
      width: 10,
      height: 10,
      hp: minionHp,
      maxHp: minionHp,
      speed: minionSpeed,
      color: "gray",
      type: "minion",
      parentId: parentId,
      shootCooldown: Math.random() * enemyShootInterval,
    });
  }

  if (type === "boss") {
    // ボスは5Waveごとの強化レベルでスケール
    const bossLevel = Math.max(1, Math.floor(wave / 5));
    const baseHp = 160;
    const hp = baseHp + bossLevel * 120 + Math.floor((wave - 1) / 2) * 10;
    const speed = 0.5 + bossLevel * 0.08;
    const spawnInterval = Math.max(120, 300 - bossLevel * 20); // ミニオン召喚間隔

    enemies.push({
      id: nextEnemyId++,
      x: x,
      y: y,
      width: 120,
      height: 120,
      hp: hp,
      maxHp: hp,
      speed: speed,
      color: "darkred",
      type: "boss",

      shootCooldown: 90,
      bossAttackTimer: 0,
      bossLevel: bossLevel,
      bossSpawnInterval: spawnInterval,
      bossPhase: 0,
      integratedLaser: wave >= 10,
      integratedLaserAngle: 0,
      integratedLaserCooldown: 75,
    });

    // ボスが出現したらフラグを立てる
    bossActive = true;
  }
}

function createBoss() {
  const width = 120;
  const height = 120;

  let x;
  let y;
  let distance;

  do {
    x = Math.random() * (canvas.width - width);
    y = Math.random() * (canvas.height - height);

    const playerCenterX = player.x + player.width / 2;
    const playerCenterY = player.y + player.height / 2;

    const bossCenterX = x + width / 2;
    const bossCenterY = y + height / 2;

    const dx = bossCenterX - playerCenterX;
    const dy = bossCenterY - playerCenterY;

    distance = Math.sqrt(dx * dx + dy * dy);
  } while (distance < 300);

  enemies.push({
    id: nextEnemyId++,
    x: x,
    y: y,
    width: width,
    height: height,

    hp: 100 + wave * 20,
    maxHp: 100 + wave * 20,

    speed: 0.5,

    color: "darkred",
    type: "boss",

    shootCooldown: 120,
  });
}

// ==================================================
// ランダム敵生成
// ==================================================

function createRandomEnemy() {
  let type;
  const random = Math.random();

  if (random < 0.35) {
    type = "normal";
  } else if (random < 0.55) {
    type = "big";
  } else if (random < 0.7) {
    type = "shooter";
  } else if (random < 0.8) {
    type = "tullet";
  } else if (random < 0.9) {
    type = "laser";
  } else {
    type = "spawner";
  }

  let width;
  let height;

  if (type === "normal") {
    width = 50;
    height = 50;
  } else if (type === "big") {
    width = 80;
    height = 80;
  } else if (type === "shooter") {
    width = 40;
    height = 40;
  } else if (type === "tullet") {
    width = 60;
    height = 60;
  } else {
    width = 45;
    height = 45;
  }

  let x;
  let y;
  let distance;

  let hitWall;

  do {
    x = Math.random() * (canvas.width - width);
    y = Math.random() * (canvas.height - height);

    const playerCenterX = player.x + player.width / 2;
    const playerCenterY = player.y + player.height / 2;

    const enemyCenterX = x + width / 2;
    const enemyCenterY = y + height / 2;

    const dx = enemyCenterX - playerCenterX;
    const dy = enemyCenterY - playerCenterY;

    distance = Math.sqrt(dx * dx + dy * dy);

    // 壁との重なりをチェック
    hitWall = false;

    for (const wall of walls) {
      if (
        x < wall.x + wall.width &&
        x + width > wall.x &&
        y < wall.y + wall.height &&
        y + height > wall.y
      ) {
        hitWall = true;
        break;
      }
    }
  } while (hitWall || distance < 200);

  createEnemy(x, y, type);
}

// 壁作成

createWalls();
// 初期敵

for (let i = 0; i < 3; i++) {
  createRandomEnemy();
}

function getEnemyScore(type) {
  if (type === "normal") {
    return 10;
  } else if (type === "shooter") {
    return 40;
  } else if (type === "tullet") {
    return 25;
  } else if (type === "laser") {
    return 20;
  } else if (type === "big") {
    return 15;
  } else if (type === "minion") {
    return 5;
  } else if (type === "spawner") {
    return 35;
  } else if (type === "boss") {
    return 500;
  }

  return 0;
}

function defeatEnemy(enemy) {
  score += getEnemyScore(enemy.type);
  kills++;

  if (score > highScore) {
    highScore = score;
    localStorage.setItem("highScore", highScore);
  }

  // Spawnerを倒したら、そのSpawnerが生み出したminionも全滅
  if (enemy.type === "spawner") {
    enemies = enemies.filter((e) => e.parentId !== enemy.id);
  }

  // minionはアイテムを落とさない
  if (enemy.type !== "minion") {
    createItem(enemy.x + enemy.width / 2 - 10, enemy.y + enemy.height / 2 - 10);
  }

  // ボスを倒したらラン中アップグレード選択画面を出す
  if (enemy.type === "boss") {
    bossActive = false;

    // 戦闘だけを終了し、報酬画面は出口に入った時に開く
    enemies = [];
    bullets = [];
    enemyBullets = [];
    bossExitUnlocked = true;
  }
}

function savePermanentUpgrades() {
  localStorage.setItem("permanentUpgrades", JSON.stringify(permanentUpgrades));
}

function enterVillage() {
  gameState = "village";
  wave = 0;
  bossActive = false;
  bossExitUnlocked = false;
  waveClearTimer = 0;
  enemies = [];
  bullets = [];
  enemyBullets = [];
  items = [];
  walls = [];
  player.x = 90;
  player.y = canvas.height / 2 - player.height / 2;
  applyPermanentUpgrades();
  player.hp = player.maxHp;
  displayedHp = player.hp;
  stamina = maxStamina;
}

function beginTowerRun() {
  gameState = "playing";
  wave = 1;
  score = 0;
  kills = 0;
  gameTime = 0;
  waveClearTimer = 0;
  waveMessageTimer = 120;
  bossActive = false;
  bossExitUnlocked = false;
  bankedThisGame = false;
  runUpgrades = {
    piercing: false,
    damageMultiplier: 1,
    burstExtra: false,
    bulletSpeedMultiplier: 1,
    shootCooldownMultiplier: 1,
    critChance: 0,
    burstDamageMultiplier: 1,
    killDamagePerKill: 0,
  };
  applyPermanentUpgrades();
  player.hp = player.maxHp;
  displayedHp = player.hp;
  stamina = maxStamina;
  player.x = 50;
  player.y = canvas.height / 2 - player.height / 2;
  enemies = [];
  bullets = [];
  enemyBullets = [];
  items = [];
  createWalls();
  enemiesToSpawn = 3;
  for (let i = 0; i < enemiesToSpawn; i++) createRandomEnemy();
}

function generateBossOptions() {
  const pool = [
    {
      id: "piercing",
      name: "貫通弾",
      desc: "弾が敵を貫通する（この周回のみ）",
      apply() {
        runUpgrades.piercing = true;
      },
    },
    {
      id: "dmg10",
      name: "攻撃力 +10%",
      desc: "弾のダメージが10%増加（この周回のみ）",
      apply() {
        runUpgrades.damageMultiplier *= 1.1;
      },
    },
    {
      id: "dmg15",
      name: "攻撃力 +15%",
      desc: "弾のダメージが15%増加（この周回のみ）",
      apply() {
        runUpgrades.damageMultiplier *= 1.15;
      },
    },
    {
      id: "dmg20",
      name: "攻撃力 +20%",
      desc: "弾のダメージが20%増加（この周回のみ）",
      apply() {
        runUpgrades.damageMultiplier *= 1.2;
      },
    },
    {
      id: "dmg30",
      name: "攻撃力 +30%",
      desc: "弾のダメージが30%増加（この周回のみ）",
      apply() {
        runUpgrades.damageMultiplier *= 1.3;
      },
    },
    {
      id: "burstExtra",
      name: "バースト拡張",
      desc: "バースト弾の横並びが1段階だけ拡張する（この周回のみ）",
      apply() {
        runUpgrades.burstExtra = true;
      },
    },
    {
      id: "burstPower",
      name: "バースト強化",
      desc: "バースト弾の威力が50%増加（この周回のみ）",
      apply() {
        runUpgrades.burstDamageMultiplier *= 1.5;
      },
    },
    {
      id: "bulletSpeed",
      name: "弾速強化",
      desc: "すべての弾の速度が30%上昇（この周回のみ）",
      apply() {
        runUpgrades.bulletSpeedMultiplier *= 1.3;
      },
    },
    {
      id: "rapidFire",
      name: "高速射撃",
      desc: "攻撃間隔が20%短縮される（この周回のみ）",
      apply() {
        runUpgrades.shootCooldownMultiplier *= 0.8;
      },
    },
    {
      id: "critChamber",
      name: "臨界弾",
      desc: "15%の確率で攻撃が2倍になる（この周回のみ）",
      apply() {
        runUpgrades.critChance += 0.15;
      },
    },
    {
      id: "killBoost",
      name: "戦績連携",
      desc: "倒した敵の数×0.5%の追加ダメージ（この周回のみ）",
      apply() {
        runUpgrades.killDamagePerKill += 0.005;
      },
    },
  ];

  const opts = [];
  const pickedIds = new Set();
  const filteredPool = pool.filter(
    (opt) =>
      !(
        (opt.id === "burstExtra" && runUpgrades.burstExtra) ||
        (opt.id === "piercing" && runUpgrades.piercing) ||
        (opt.id === "burstPower" && runUpgrades.burstDamageMultiplier > 1) ||
        (opt.id === "bulletSpeed" && runUpgrades.bulletSpeedMultiplier > 1) ||
        (opt.id === "rapidFire" && runUpgrades.shootCooldownMultiplier < 1) ||
        (opt.id === "critChamber" && runUpgrades.critChance > 0) ||
        (opt.id === "killBoost" && runUpgrades.killDamagePerKill > 0)
      ),
  );

  while (opts.length < 3 && pickedIds.size < filteredPool.length) {
    const i = Math.floor(Math.random() * filteredPool.length);
    const candidate = filteredPool[i];
    if (!pickedIds.has(candidate.id)) {
      pickedIds.add(candidate.id);
      opts.push(candidate);
    }
  }

  return opts;
}

// ==================================================
// アイテム生成
// ==================================================

function createItem(x, y) {
  const random = Math.random();

  let type;

  // それぞれの出現確率
  if (random < 0.15) {
    type = "heal"; // 20%
  } else if (random < 0.23) {
    type = "explode"; // 8%
  } else if (random < 0.35) {
    type = "burst"; // 12%
  } else {
    return; // 60%は何も落とさない
  }

  items.push({
    x: x,
    y: y,
    width: 20,
    height: 20,
    type: type,
  });
}

function startNextWave() {
  wave++;
  bossExitUnlocked = false;

  if (wave > bestWave) {
    bestWave = wave;
    localStorage.setItem("bestWave", bestWave);
  }

  // ボスを1体攻略するたび、以降のWaveの同時出現上限が1体増える
  const defeatedBossCount = Math.floor((wave - 1) / 5);
  const maxNormalEnemies = 4 + defeatedBossCount;
  enemiesToSpawn = Math.min(maxNormalEnemies, 3 + Math.floor((wave - 1) / 6));

  // 新しいWaveの壁を生成
  createWalls();

  // ==================================================
  // ボスWave
  // ==================================================

  if (wave % 5 === 0) {
    // 通常敵を少し減らしてボスを追加
    for (let i = 0; i < enemiesToSpawn - 1; i++) {
      createRandomEnemy();
    }

    // ボス生成
    let bossWidth = 120;
    let bossHeight = 120;

    let x;
    let y;
    let distance;
    let hitWall;

    do {
      x = Math.random() * (canvas.width - bossWidth);
      y = Math.random() * (canvas.height - bossHeight);

      const playerCenterX = player.x + player.width / 2;
      const playerCenterY = player.y + player.height / 2;

      const bossCenterX = x + bossWidth / 2;
      const bossCenterY = y + bossHeight / 2;

      const dx = bossCenterX - playerCenterX;
      const dy = bossCenterY - playerCenterY;

      distance = Math.sqrt(dx * dx + dy * dy);

      hitWall = false;

      for (const wall of walls) {
        if (
          x < wall.x + wall.width &&
          x + bossWidth > wall.x &&
          y < wall.y + wall.height &&
          y + bossHeight > wall.y
        ) {
          hitWall = true;
          break;
        }
      }
    } while (hitWall || distance < 300);

    const bossX = x;
    const bossY = y;
    createEnemy(bossX, bossY, "boss");
  } else {
    // 通常Wave
    for (let i = 0; i < enemiesToSpawn; i++) {
      createRandomEnemy();
    }
  }

  waveMessageTimer = 120;
}

// ==================================================
// メイン更新
// ==================================================

function updateVillage() {
  let dx = (rightPressed ? 1 : 0) - (leftPressed ? 1 : 0);
  let dy = (downPressed ? 1 : 0) - (upPressed ? 1 : 0);
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  player.x = Math.max(
    24,
    Math.min(canvas.width - player.width - 8, player.x + dx * 4),
  );
  player.y = Math.max(
    55,
    Math.min(canvas.height - player.height - 24, player.y + dy * 4),
  );

  // 右端中央の塔門へ歩いて入る
  if (
    player.x + player.width >= canvas.width - 18 &&
    player.y + player.height >= canvas.height / 2 - 72 &&
    player.y <= canvas.height / 2 + 72
  ) {
    beginTowerRun();
  }
}

function isAutoAimActive() {
  return (
    permanentUpgrades.autoAimUnlocked &&
    permanentUpgrades.autoAimEnabled &&
    !mousePressed
  );
}

function getNearestEnemy() {
  if (!isAutoAimActive() || enemies.length === 0) return null;
  const px = player.x + player.width / 2;
  const py = player.y + player.height / 2;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const enemy of enemies) {
    const distance = Math.hypot(
      enemy.x + enemy.width / 2 - px,
      enemy.y + enemy.height / 2 - py,
    );
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = enemy;
    }
  }
  return nearest;
}

function update() {
  if (gameState === "village") {
    updateVillage();
    return;
  }

  // only update while playing
  if (gameState !== "playing") {
    return;
  }

  // ==================================================
  // 経過時間
  // ==================================================

  gameTime += 1 / 60;

  // ==================================================
  // プレイヤー弾クールダウン
  // ==================================================

  if (shootCooldown > 0) {
    shootCooldown--;
  }

  // ==================================================
  // HP残像
  // ==================================================

  if (displayedHp > player.hp) {
    displayedHp -= 0.1;

    if (displayedHp < player.hp) {
      displayedHp = player.hp;
    }
  } else {
    displayedHp = player.hp;
  }

  // ==================================================
  // プレイヤー移動
  // ==================================================

  let moveX = 0;
  let moveY = 0;

  if (rightPressed) {
    moveX += 1;
  }

  if (leftPressed) {
    moveX -= 1;
  }

  if (upPressed) {
    moveY -= 1;
  }

  if (downPressed) {
    moveY += 1;
  }

  const length = Math.sqrt(moveX * moveX + moveY * moveY);

  if (length > 0) {
    moveX /= length;
    moveY /= length;
    playerFacingX = moveX;
    playerFacingY = moveY;
  }

  // ==================================================
  // スタミナ・ダッシュ
  // ==================================================

  const isDashing = shiftPressed && !staminaExhausted;

  if (isDashing) {
    stamina -= staminaDrain;

    if (stamina <= 0) {
      stamina = 0;
      staminaExhausted = true;
    }
  } else {
    stamina += staminaRecovery;

    if (stamina >= maxStamina * 0.25) {
      staminaExhausted = false;
    }

    if (stamina >= maxStamina) {
      stamina = maxStamina;
    }
  }

  const playerSpeed = isDashing ? 8 : 4;

  // ==================================================
  // プレイヤーX移動
  // ==================================================

  const nextX = player.x + moveX * playerSpeed;

  const nextPlayerX = {
    x: nextX,
    y: player.y,
    width: player.width,
    height: player.height,
  };

  if (!checkCollision(nextPlayerX)) {
    player.x = nextX;
  }

  // ==================================================
  // プレイヤーY移動
  // ==================================================

  const nextY = player.y + moveY * playerSpeed;

  const nextPlayerY = {
    x: player.x,
    y: nextY,
    width: player.width,
    height: player.height,
  };

  if (!checkCollision(nextPlayerY)) {
    player.y = nextY;
  }

  // ボス撃破後、右壁の昇降扉に入るまで部屋に留まれる
  if (
    bossExitUnlocked &&
    wave % 5 === 0 &&
    player.x + player.width >= canvas.width - 42 &&
    player.y + player.height >= canvas.height / 2 - 62 &&
    player.y <= canvas.height / 2 + 62
  ) {
    bossOptions = generateBossOptions();
    bossRerollsLeft = 1;
    gameState = "bossReward";
    return;
  }

  // ==================================================
  // Zキー
  // ==================================================

  if (zPressed) {
    player.x = 0;
    player.y = 0;
  }

  // ==================================================
  // プレイヤー弾の移動
  // ==================================================

  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];

    bullet.x += bullet.velocityX;
    bullet.y += bullet.velocityY;

    if (checkBulletWallCollision(bullet)) {
      bullets.splice(i, 1);
      continue;
    }

    if (
      bullet.x + bullet.width < 0 ||
      bullet.x > canvas.width ||
      bullet.y + bullet.height < 0 ||
      bullet.y > canvas.height
    ) {
      bullets.splice(i, 1);
    }
  }

  // ==================================================
  // 敵弾の移動
  // ==================================================

  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const bullet = enemyBullets[i];

    const oldX = bullet.x;
    const oldY = bullet.y;

    bullet.x += bullet.velocityX;
    bullet.y += bullet.velocityY;

    // ==================================================
    // 通常の敵弾
    // ==================================================
    {
      if (checkBulletWallCollision(bullet)) {
        enemyBullets.splice(i, 1);
        continue;
      }
    }

    // ==================================================
    // 画面外
    // ==================================================

    if (
      bullet.x + bullet.width < 0 ||
      bullet.x > canvas.width ||
      bullet.y + bullet.height < 0 ||
      bullet.y > canvas.height
    ) {
      enemyBullets.splice(i, 1);
    }
  }

  // ==================================================
  // 敵更新
  // ==================================================

  updateEnemy();

  // ==================================================
  // 当たり判定
  // ==================================================

  checkEnemyBulletPlayerCollision();
  checkBulletEnemyCollision();
  checkPlayerEnemyCollision();
  checkItemCollision();
  updateParticles();

  if (playerRecentlyHit > 0) {
    playerRecentlyHit--;
  }

  // ==================================================
  // プレイヤー射撃
  // ==================================================

  const autoTarget = getNearestEnemy();
  if ((spacePressed || mousePressed || autoTarget) && shootCooldown <= 0) {
    const aim = getAimDirection();

    const baseBulletSpeed = burstActive ? 12 : 10;
    const bulletspeed =
      baseBulletSpeed * (runUpgrades.bulletSpeedMultiplier || 1);

    if (burstActive) {
      // バーストは横に並べて、照準方向にまっすぐ進む
      const perpX = -aim.y;
      const perpY = aim.x;
      let offsets = [-24, -12, 0, 12, 24];

      if (runUpgrades.burstExtra) {
        offsets = [-36, -24, -12, 0, 12, 24, 36];
      }

      for (const off of offsets) {
        const bx =
          player.x + player.width / 2 + aim.x * gunLength + perpX * off - 5;
        const by =
          player.y + player.height / 2 + aim.y * gunLength + perpY * off - 5;

        bullets.push({
          x: bx,
          y: by,
          width: 10,
          height: 10,
          speed: bulletspeed,
          velocityX: aim.x * bulletspeed,
          velocityY: aim.y * bulletspeed,
        });
      }
    } else {
      const bullet = {
        x: player.x + player.width / 2 + aim.x * gunLength - 5,
        y: player.y + player.height / 2 + aim.y * gunLength - 5,
        width: 10,
        height: 10,
        speed: bulletspeed,
        velocityX: aim.x * bulletspeed,
        velocityY: aim.y * bulletspeed,
      };

      bullets.push(bullet);
    }

    const baseCooldown = burstActive
      ? Math.max(5, shootInterval - 4)
      : shootInterval;
    shootCooldown = Math.max(
      2,
      Math.round(baseCooldown * (runUpgrades.shootCooldownMultiplier || 1)),
    );
  }

  // ==================================================
  // Wave
  // ==================================================

  if (
    enemies.length === 0 &&
    waveClearTimer <= 0 &&
    !bossActive &&
    !bossExitUnlocked
  ) {
    waveClearTimer = 90;
    bullets = [];
    enemyBullets = [];
  }

  if (waveClearTimer > 0) {
    waveClearTimer--;

    if (waveClearTimer === 0) {
      startNextWave();
    }
  }

  if (waveMessageTimer > 0) {
    waveMessageTimer--;
  }

  // バースト残り時間処理
  if (burstActive) {
    burstTimer--;
    if (burstTimer <= 0) {
      burstActive = false;
      burstTimer = 0;
    }
  }
} // ← ここで初めて update() を閉じる

// ==================================================
// 敵更新
// ==================================================

function updateEnemy() {
  for (const enemy of enemies) {
    // ==================================================
    // プレイヤー方向
    // ==================================================

    let dx = player.x + player.width / 2 - (enemy.x + enemy.width / 2);

    let dy = player.y + player.height / 2 - (enemy.y + enemy.height / 2);

    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance === 0) {
      continue;
    }

    dx /= distance;
    dy /= distance;

    let moveX = dx * enemy.speed;
    let moveY = dy * enemy.speed;

    // ==================================================
    // Boss
    // ==================================================

    if (enemy.type === "boss") {
      // プレイヤーとの距離が近すぎたら少し離れる
      if (distance < 220) {
        moveX *= -1;
        moveY *= -1;
      }
      // 遠すぎる間はゆっくり近づく
      else if (distance > 350) {
        moveX *= 0.7;
        moveY *= 0.7;
      }
      // ちょうどいい距離なら停止
      else {
        moveX = 0;
        moveY = 0;
      }
    }

    // ==================================================
    // Shooter
    // ==================================================

    if (enemy.type === "shooter") {
      const distanceToPlayer = distance;

      if (distanceToPlayer < 250) {
        moveX *= -1;
        moveY *= -1;
      } else if (distanceToPlayer < 350) {
        moveX = 0;
        moveY = 0;
      }
    }

    // ==================================================
    // Spawner
    // プレイヤーから逃げる
    // ==================================================

    if (enemy.type === "spawner") {
      moveX *= -1;
      moveY *= -1;
    }

    // ==================================================
    // X方向の移動
    // ==================================================

    const nextX = {
      x: enemy.x + moveX,
      y: enemy.y,
      width: enemy.width,
      height: enemy.height,
    };

    if (!checkCollision(nextX)) {
      enemy.x += moveX;
    }

    // ==================================================
    // Y方向の移動
    // ==================================================

    const nextY = {
      x: enemy.x,
      y: enemy.y + moveY,
      width: enemy.width,
      height: enemy.height,
    };

    if (!checkCollision(nextY)) {
      enemy.y += moveY;
    }

    // ==================================================
    // Laser: 十字レーザーを回転させる
    // ==================================================
    if (enemy.type === "laser") {
      enemy.angle = (enemy.angle || 0) + 0.0008; // ゆっくり回転
      if (enemy.angle > Math.PI * 2) {
        enemy.angle -= Math.PI * 2;
      }
    }

    // ==================================================
    // Boss 固有：攻撃強化ギミック
    // ==================================================
    if (enemy.type === "boss") {
      const hpRatio = enemy.hp / enemy.maxHp;
      let interval = enemy.bossSpawnInterval || 240;
      if (hpRatio <= 0.75) interval = Math.max(140, interval - 20);
      if (hpRatio <= 0.5) interval = Math.max(120, interval - 20);

      enemy.bossAttackTimer = (enemy.bossAttackTimer || 0) + 1;

      if (enemy.integratedLaser) {
        enemy.integratedLaserAngle =
          (enemy.integratedLaserAngle + 0.008) % (Math.PI * 2);
        enemy.integratedLaserCooldown--;
        if (enemy.integratedLaserCooldown <= 0) {
          const laserSpeed = 6;
          const bossCenterX = enemy.x + enemy.width / 2;
          const bossCenterY = enemy.y + enemy.height / 2;
          for (let i = 0; i < 4; i++) {
            const angle = enemy.integratedLaserAngle + i * Math.PI / 2;
            enemyBullets.push({
              x: bossCenterX - 4,
              y: bossCenterY - 4,
              width: 8,
              height: 8,
              speed: laserSpeed,
              velocityX: Math.cos(angle) * laserSpeed,
              velocityY: Math.sin(angle) * laserSpeed,
            });
          }
          enemy.integratedLaserCooldown = Math.max(8, 15 - enemy.bossLevel);
        }
      }

      if (enemy.bossAttackTimer >= interval) {
        enemy.bossAttackTimer = 0;

        const spawnCount = 1 + Math.floor(wave / 8);

        for (let i = 0; i < spawnCount; i++) {
          const angle = ((Math.PI * 2) / spawnCount) * i;
          const spawnDistance = enemy.width / 2 + 12;
          const spawnX =
            enemy.x + enemy.width / 2 - 5 + Math.cos(angle) * spawnDistance;
          const spawnY =
            enemy.y + enemy.height / 2 - 5 + Math.sin(angle) * spawnDistance;
          const minion = {
            x: spawnX,
            y: spawnY,
            width: 10,
            height: 10,
          };
          if (!checkCollision(minion)) {
            createEnemy(spawnX, spawnY, "minion", enemy.id);
          }
        }
      }

      if (hpRatio <= 0.85 && enemy.bossPhase === 0) {
        enemy.bossPhase = 1;
        const normalSpawn = {
          x: enemy.x + 10,
          y: enemy.y + 10,
          width: 50,
          height: 50,
        };
        if (!checkCollision(normalSpawn)) {
          createEnemy(enemy.x + 10, enemy.y + 10, "normal");
        }

      }

      if (hpRatio <= 0.6 && enemy.bossPhase === 1) {
        enemy.bossPhase = 2;
        for (let i = 0; i < 2; i++) {
          const angle = Math.random() * Math.PI * 2;
          const spawnDistance = enemy.width / 2 + 20 + i * 10;
          const spawnX =
            enemy.x + enemy.width / 2 - 5 + Math.cos(angle) * spawnDistance;
          const spawnY =
            enemy.y + enemy.height / 2 - 5 + Math.sin(angle) * spawnDistance;
          const bigSpawn = {
            x: spawnX,
            y: spawnY,
            width: 80,
            height: 80,
          };
          if (!checkCollision(bigSpawn)) {
            createEnemy(spawnX, spawnY, "big");
          }
        }
      }

      if (hpRatio <= 0.35 && enemy.bossPhase === 2) {
        enemy.bossPhase = 3;
        for (let i = 0; i < 2; i++) {
          const angle = Math.random() * Math.PI * 2;
          const spawnDistance = enemy.width / 2 + 20 + i * 10;
          const spawnX =
            enemy.x + enemy.width / 2 - 10 + Math.cos(angle) * spawnDistance;
          const spawnY =
            enemy.y + enemy.height / 2 - 10 + Math.sin(angle) * spawnDistance;
          const spawnType = i === 0 ? "tullet" : "big";
          const spawnSize =
            spawnType === "tullet"
              ? { width: 60, height: 60 }
              : { width: 80, height: 80 };
          const spawnProbe = {
            x: spawnX,
            y: spawnY,
            width: spawnSize.width,
            height: spawnSize.height,
          };
          if (!checkCollision(spawnProbe)) {
            createEnemy(spawnX, spawnY, spawnType);
          }
        }
      }
    }

    // ==================================================
    // 敵射撃クールダウン
    // ==================================================

    if (enemy.shootCooldown > 0) {
      enemy.shootCooldown--;
    }

    // ==================================================
    // 敵射撃
    // ==================================================

    if (enemy.shootCooldown <= 0) {
      const enemyCenterX = enemy.x + enemy.width / 2;
      const enemyCenterY = enemy.y + enemy.height / 2;

      dx = player.x + player.width / 2 - enemyCenterX;

      dy = player.y + player.height / 2 - enemyCenterY;

      const distanceToPlayer = Math.sqrt(dx * dx + dy * dy);

      if (distanceToPlayer > 0) {
        dx /= distanceToPlayer;
        dy /= distanceToPlayer;
      }

      // ==================================================
      // Shooter
      // ==================================================

      if (enemy.type === "shooter") {
        const bulletSpeed = 8;

        enemyBullets.push({
          x: enemyCenterX - 3,
          y: enemyCenterY - 3,
          width: 6,
          height: 6,
          speed: bulletSpeed,
          velocityX: dx * bulletSpeed,
          velocityY: dy * bulletSpeed,
        });

        enemy.shootCooldown = enemyShootInterval * 0.7;
      }

      // ==================================================
      // Big
      // ==================================================
      else if (enemy.type === "big") {
        const baseAngle = Math.atan2(dy, dx);

        const angles = [
          -Math.PI / 4,
          -Math.PI / 8,
          0,
          Math.PI / 8,
          Math.PI / 4,
        ];

        const bulletSpeed = 3;

        for (const angleOffset of angles) {
          const angle = baseAngle + angleOffset;

          enemyBullets.push({
            x: enemyCenterX - 3,
            y: enemyCenterY - 3,
            width: 6,
            height: 6,
            speed: bulletSpeed,
            velocityX: Math.cos(angle) * bulletSpeed,
            velocityY: Math.sin(angle) * bulletSpeed,
          });
        }

        enemy.shootCooldown = enemyShootInterval;
      }

      // ==================================================
      // Tullet
      // ==================================================
      else if (enemy.type === "tullet") {
        const baseAngle = Math.atan2(dy, dx);

        // 中央を削除して左右2発
        const angles = [-Math.PI / 10, Math.PI / 10];

        const bulletSpeed = 6;

        for (const angleOffset of angles) {
          const angle = baseAngle + angleOffset;

          enemyBullets.push({
            x: enemyCenterX - 3,
            y: enemyCenterY - 3,
            width: 6,
            height: 6,
            speed: bulletSpeed,
            velocityX: Math.cos(angle) * bulletSpeed,
            velocityY: Math.sin(angle) * bulletSpeed,
          });
        }

        enemy.shootCooldown = enemyShootInterval;
      }

      // ==================================================
      // Laser
      // ==================================================
      else if (enemy.type === "laser") {
        const bulletSpeed = 6;

        // プレイヤー方向を基準に4方向
        const angles = [
          enemy.angle,
          enemy.angle + Math.PI / 2,
          enemy.angle + Math.PI,
          enemy.angle + (Math.PI * 3) / 2,
        ];

        for (const angle of angles) {
          enemyBullets.push({
            x: enemyCenterX - 3,
            y: enemyCenterY - 3,
            width: 6,
            height: 6,
            speed: bulletSpeed,
            velocityX: Math.cos(angle) * bulletSpeed,
            velocityY: Math.sin(angle) * bulletSpeed,
          });
        }

        enemy.shootCooldown = 0.00000001;
      }

      // ==================================================
      // Spawner
      // ==================================================
      else if (enemy.type === "spawner") {
        const spawnCount = 2;

        for (let i = 0; i < spawnCount; i++) {
          const angle = ((Math.PI * 2) / spawnCount) * i;

          const spawnDistance = 25;

          const spawnX =
            enemy.x + enemy.width / 2 - 5 + Math.cos(angle) * spawnDistance;

          const spawnY =
            enemy.y + enemy.height / 2 - 5 + Math.sin(angle) * spawnDistance;

          createEnemy(spawnX, spawnY, "minion", enemy.id);
        }

        // 4秒後に再召喚（60FPS）
        enemy.shootCooldown = 180;
      }

      // ==================================================
      // Normal
      // ==================================================
      else if (enemy.type === "normal") {
        const bulletSpeed = 3;

        enemyBullets.push({
          x: enemyCenterX - 3,
          y: enemyCenterY - 3,
          width: 6,
          height: 6,
          speed: bulletSpeed,
          velocityX: dx * bulletSpeed,
          velocityY: dy * bulletSpeed,
        });

        enemy.shootCooldown = enemyShootInterval;
      }

      // ==================================================
      // Boss
      // ==================================================
      else if (enemy.type === "boss") {
        const hpRatio = enemy.hp / enemy.maxHp;

        // ------------------------------------------
        // HPによって移動速度変化
        // ------------------------------------------

        let bossSpeed = enemy.speed;

        if (hpRatio <= 0.5) {
          bossSpeed = 0.8;
        }

        moveX = dx * bossSpeed;
        moveY = dy * bossSpeed;

        // 近すぎたら離れる
        if (distance < 220) {
          moveX *= -1;
          moveY *= -1;
        }

        // ------------------------------------------
        // 攻撃クールダウン
        // ------------------------------------------

        if (enemy.shootCooldown > 0) {
          enemy.shootCooldown--;
        }

        if (enemy.shootCooldown <= 0) {
          const baseAngle = Math.atan2(dy, dx);

          // ==================================================
          // HP50%以上
          // 8方向弾
          // ==================================================

          if (hpRatio > 0.5) {
            const bulletCount = 8;
            const bulletSpeed = 4;

            for (let i = 0; i < bulletCount; i++) {
              const angle = baseAngle + ((Math.PI * 2) / bulletCount) * i;

              enemyBullets.push({
                x: enemyCenterX - 4,
                y: enemyCenterY - 4,
                width: 8,
                height: 8,
                speed: bulletSpeed,
                velocityX: Math.cos(angle) * bulletSpeed,
                velocityY: Math.sin(angle) * bulletSpeed,
              });
            }

            enemy.shootCooldown = 90;
          }

          // ==================================================
          // HP50%以下
          // 狙い撃ち + 8方向
          // ==================================================
          else {
            // 8方向弾
            const bulletCount = 8;
            const bulletSpeed = 4.5;

            for (let i = 0; i < bulletCount; i++) {
              const angle = baseAngle + ((Math.PI * 2) / bulletCount) * i;

              enemyBullets.push({
                x: enemyCenterX - 4,
                y: enemyCenterY - 4,
                width: 8,
                height: 8,
                speed: bulletSpeed,
                velocityX: Math.cos(angle) * bulletSpeed,
                velocityY: Math.sin(angle) * bulletSpeed,
              });
            }

            // プレイヤーへの高速弾
            const aimedSpeed = 9;

            enemyBullets.push({
              x: enemyCenterX - 4,
              y: enemyCenterY - 4,
              width: 8,
              height: 8,
              speed: aimedSpeed,
              velocityX: dx * aimedSpeed,
              velocityY: dy * aimedSpeed,
            });

            enemy.shootCooldown = 55;
          }
        }
      }
    }
  }
}

// ==================================================
// プレイヤー弾 → 敵
// ==================================================

function checkBulletEnemyCollision() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const bullet = bullets[i];

    // ボス撃破処理などで弾配列が差し替えられた場合の安全策
    if (!bullet) {
      bullets.splice(i, 1);
      continue;
    }

    bullet.hitEnemyIds = bullet.hitEnemyIds || new Set();

    for (let j = enemies.length - 1; j >= 0; j--) {
      const enemy = enemies[j];

      if (
        bullet.x < enemy.x + enemy.width &&
        bullet.x + bullet.width > enemy.x &&
        bullet.y < enemy.y + enemy.height &&
        bullet.y + bullet.height > enemy.y
      ) {
        if (bullet.hitEnemyIds.has(enemy.id)) {
          continue;
        }

        // ダメージ計算（ランアップグレードを反映）
        const baseDamage = 1;
        const permMultiplier = 1 + (permanentUpgrades.damageLevel || 0) * 0.1;
        let damage = Math.ceil(
          baseDamage *
            (runUpgrades.damageMultiplier || 1) *
            permMultiplier *
            (1 + (runUpgrades.killDamagePerKill || 0) * kills) *
            (burstActive ? runUpgrades.burstDamageMultiplier || 1 : 1),
        );

        if (Math.random() < (runUpgrades.critChance || 0)) {
          damage *= 2;
        }

        enemy.damaged = true;
        enemy.hp -= damage;
        enemy.hp = Math.max(0, enemy.hp);
        bullet.hitEnemyIds.add(enemy.id);

        spawnParticles(
          bullet.x + bullet.width / 2,
          bullet.y + bullet.height / 2,
          "hit",
          6,
        );
        playSound("hit");

        if (enemy.hp <= 0) {
          const defeatedBoss = enemy.type === "boss";
          defeatEnemy(enemy);

          if (defeatedBoss) {
            bossActive = false;
            // defeatEnemy() が敵・弾配列を初期化するため、古いループを終了する
            return;
          }

          enemies.splice(j, 1);
        }

        // ピアス効果が無ければ弾を消す
        if (!runUpgrades.piercing) {
          bullets.splice(i, 1);
          break;
        }
      }
    }
  }
}

// ==================================================
// プレイヤー → 敵
// ==================================================

function checkPlayerEnemyCollision() {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];

    if (
      player.x < enemy.x + enemy.width &&
      player.x + player.width > enemy.x &&
      player.y < enemy.y + enemy.height &&
      player.y + player.height > enemy.y
    ) {
      player.hp -= enemy.hp;

      // 敵を倒した扱いにしてスコアやアイテムを処理
      defeatEnemy(enemy);

      // ボスならフラグを折る
      if (enemy.type === "boss") {
        bossActive = false;
      }

      enemies.splice(i, 1);

      if (player.hp <= 0) {
        gameState = "gameover";
      }

      return;
    }
  }
}

// ==================================================
// プレイヤー・敵・壁の衝突
// ==================================================

// ==================================================
// プレイヤー・敵・壁の衝突
// ==================================================

function checkCollision(object) {
  // 画面外
  if (
    object.x < 0 ||
    object.x + object.width > canvas.width ||
    object.y < 0 ||
    object.y + object.height > canvas.height
  ) {
    return true;
  }

  // 壁
  for (const wall of walls) {
    if (
      object.x < wall.x + wall.width &&
      object.x + object.width > wall.x &&
      object.y < wall.y + wall.height &&
      object.y + object.height > wall.y
    ) {
      return true;
    }
  }

  return false;
}

// ==================================================
// 敵弾 → プレイヤー
// ==================================================

function checkEnemyBulletPlayerCollision() {
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    const bullet = enemyBullets[i];

    if (
      bullet.x < player.x + player.width &&
      bullet.x + bullet.width > player.x &&
      bullet.y < player.y + player.height &&
      bullet.y + bullet.height > player.y
    ) {
      enemyBullets.splice(i, 1);

      player.hp--;
      playerRecentlyHit = 60;
      spawnParticles(
        player.x + player.width / 2,
        player.y + player.height / 2,
        "player",
        10,
      );
      playSound("damage");

      if (player.hp <= 0) {
        gameState = "gameover";
      }
    }
  }
}

// ==================================================
// アイテム取得
// ==================================================

function checkItemCollision() {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];

    if (
      item.x < player.x + player.width &&
      item.x + item.width > player.x &&
      item.y < player.y + player.height &&
      item.y + item.height > player.y
    ) {
      if (item.type === "heal") {
        player.hp = Math.min(player.hp + 2, player.maxHp);
      } else if (item.type === "explode") {
        const bulletSpeed = 20;
        const bulletCount = 96;

        for (let j = 0; j < bulletCount; j++) {
          const angle = ((Math.PI * 2) / bulletCount) * j;

          bullets.push({
            x: player.x + player.width / 2 - 3,
            y: player.y + player.height / 2 - 3,
            width: 6,
            height: 6,
            speed: bulletSpeed,
            velocityX: Math.cos(angle) * bulletSpeed,
            velocityY: Math.sin(angle) * bulletSpeed,
          });
        }
      } else if (item.type === "burst") {
        // バースト取得：一定時間プレイヤーの射撃が横5発になる
        burstActive = true;
        burstTimer = burstDuration;

        // burstActiveを付与している間はリロードを少し短くし、爽快感を追加
        shootCooldown = Math.max(0, shootCooldown - 2);
      }

      items.splice(i, 1);
    }
  }
}

// ==================================================
// 弾 → 壁
// 通常弾：壁に当たったら消える
// 跳弾弾：laserBullet()で処理
// ==================================================

function checkBulletWallCollision(bullet) {
  for (const wall of walls) {
    if (
      bullet.x < wall.x + wall.width &&
      bullet.x + bullet.width > wall.x &&
      bullet.y < wall.y + wall.height &&
      bullet.y + bullet.height > wall.y
    ) {
      return true;
    }
  }

  return false;
}

// ==================================================
// 描画
// ==================================================

function drawStartScreen() {
  const w = canvas.width;
  const h = canvas.height;
  const time = performance.now() / 1000;

  ctx.save();

  // 夜空
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, "#080b18");
  sky.addColorStop(0.55, "#151426");
  sky.addColorStop(1, "#050609");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // 月と雲
  const moonGlow = ctx.createRadialGradient(610, 105, 8, 610, 105, 92);
  moonGlow.addColorStop(0, "rgba(226,220,183,.7)");
  moonGlow.addColorStop(0.35, "rgba(180,181,159,.18)");
  moonGlow.addColorStop(1, "rgba(120,130,150,0)");
  ctx.fillStyle = moonGlow;
  ctx.fillRect(510, 5, 200, 200);
  ctx.fillStyle = "#d9d5b8";
  ctx.beginPath();
  ctx.arc(610, 105, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(95,99,105,.22)";
  ctx.beginPath();
  ctx.arc(596, 91, 9, 0, Math.PI * 2);
  ctx.arc(624, 117, 12, 0, Math.PI * 2);
  ctx.fill();

  // 遠景の塔
  ctx.fillStyle = "#090a0e";
  ctx.beginPath();
  ctx.moveTo(515, 500);
  ctx.lineTo(515, 190);
  ctx.lineTo(536, 190);
  ctx.lineTo(536, 157);
  ctx.lineTo(551, 157);
  ctx.lineTo(551, 122);
  ctx.lineTo(574, 92);
  ctx.lineTo(597, 122);
  ctx.lineTo(597, 157);
  ctx.lineTo(612, 157);
  ctx.lineTo(612, 190);
  ctx.lineTo(633, 190);
  ctx.lineTo(633, 500);
  ctx.closePath();
  ctx.fill();
  // 塔の窓
  for (let y = 180; y < 430; y += 58) {
    const flicker = 0.55 + Math.sin(time * 2 + y) * 0.15;
    ctx.fillStyle = `rgba(185,68,38,${flicker})`;
    ctx.beginPath();
    ctx.moveTo(566, y + 14);
    ctx.lineTo(566, y + 5);
    ctx.arc(574, y + 5, 8, Math.PI, 0);
    ctx.lineTo(582, y + 14);
    ctx.closePath();
    ctx.fill();
  }

  // 地面と前景の岩
  ctx.fillStyle = "#08090d";
  ctx.beginPath();
  ctx.moveTo(0, 475);
  for (let x = 0; x <= w; x += 40) {
    ctx.lineTo(x, 470 + Math.sin(x * 0.047) * 17);
  }
  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.fill();

  // 流れる霧
  for (let i = 0; i < 4; i++) {
    const fogX = ((time * (12 + i * 4) + i * 230) % 1100) - 180;
    const fog = ctx.createRadialGradient(
      fogX,
      440 + i * 25,
      5,
      fogX,
      440 + i * 25,
      160,
    );
    fog.addColorStop(0, "rgba(155,160,173,.12)");
    fog.addColorStop(1, "rgba(100,110,125,0)");
    ctx.fillStyle = fog;
    ctx.fillRect(fogX - 170, 390, 340, 150);
  }

  // 石造の外枠
  ctx.strokeStyle = "#4a4650";
  ctx.lineWidth = 10;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  ctx.strokeStyle = "#777066";
  ctx.lineWidth = 2;
  ctx.strokeRect(17, 17, w - 34, h - 34);
  ctx.fillStyle = "#84775e";
  [
    [20, 20],
    [w - 20, 20],
    [20, h - 20],
    [w - 20, h - 20],
  ].forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  // タイトル面
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(175,42,28,.8)";
  ctx.shadowBlur = 16;
  ctx.fillStyle = "#d5c7a1";
  ctx.font = "bold 54px Georgia, serif";
  ctx.fillText("Splatoon 4", w / 2, 105);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#8f3327";
  ctx.fillRect(w / 2 - 160, 118, 320, 2);
  ctx.fillStyle = "#aaa18d";
  ctx.font = "13px Georgia, serif";
  ctx.fillText("— THE ANCIENT TOWER —", w / 2, 140);

  // 情報パネル
  const panel = ctx.createLinearGradient(0, 175, 0, 430);
  panel.addColorStop(0, "rgba(8,8,12,.78)");
  panel.addColorStop(1, "rgba(19,15,17,.9)");
  ctx.fillStyle = panel;
  ctx.fillRect(205, 170, 390, 262);
  ctx.strokeStyle = "rgba(151,130,91,.65)";
  ctx.lineWidth = 1;
  ctx.strokeRect(211, 176, 378, 250);
  ctx.fillStyle = "#d3c8ae";
  ctx.font = "18px serif";
  ctx.fillText("古塔の最上階へ向かえ。", w / 2, 213);

  ctx.fillStyle = "#8e8676";
  ctx.fillRect(270, 232, 260, 1);
  ctx.font = "15px sans-serif";
  ctx.fillStyle = "#aaa69d";
  ctx.fillText("W A S D　移動　　SHIFT　ダッシュ", w / 2, 268);
  ctx.fillText("右クリック　射撃　　R　リスタート", w / 2, 296);

  const pulse = 0.72 + Math.sin(time * 3) * 0.28;
  ctx.shadowColor = "#d16841";
  ctx.shadowBlur = 12 * pulse;
  ctx.fillStyle = `rgba(240,218,166,${pulse})`;
  ctx.font = "bold 22px serif";
  ctx.fillText("◆　[SPACEで冒険を始める]　◆", w / 2, 360);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#756d62";
  ctx.font = "12px serif";
  ctx.fillText("Made by yuno", w / 2, 397);

  // 冒険記録
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(8,8,10,.75)";
  ctx.fillRect(35, 510, 205, 55);
  ctx.strokeStyle = "#514a3d";
  ctx.strokeRect(35, 510, 205, 55);
  ctx.fillStyle = "#a99e86";
  ctx.font = "14px serif";
  ctx.fillText("冒険の記録", 49, 531);
  ctx.fillStyle = "#d1c5aa";
  ctx.fillText(`最高記録 ${highScore} | 到達階層 ${bestWave}F`, 49, 553);

  ctx.textAlign = "right";
  ctx.fillStyle = "#5f5a52";
  ctx.font = "11px serif";
  ctx.fillText("2026 / 8 / 11", w - 32, h - 24);
  ctx.restore();
}

function drawVillage() {
  const w = canvas.width;
  const h = canvas.height;
  const time = performance.now() / 1000;
  ctx.save();

  // 草地と土の濃淡
  const grass = ctx.createLinearGradient(0, 0, 0, h);
  grass.addColorStop(0, "#263727");
  grass.addColorStop(1, "#17251b");
  ctx.fillStyle = grass;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = "#91a46b";
  for (let y = 28; y < h; y += 46) {
    for (let x = 25 + (y % 3) * 9; x < w; x += 58) {
      ctx.fillRect(x, y, 2, 7);
      ctx.fillRect(x - 3, y + 3, 2, 5);
    }
  }

  // 塔へ続く石畳
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#4b4940";
  ctx.beginPath();
  ctx.moveTo(0, 245);
  ctx.lineTo(w, 205);
  ctx.lineTo(w, 395);
  ctx.lineTo(0, 350);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(28,27,25,.5)";
  ctx.lineWidth = 1;
  for (let x = 0; x < w; x += 55) {
    ctx.beginPath();
    ctx.moveTo(x, 238);
    ctx.lineTo(x + 12, 365);
    ctx.stroke();
  }
  for (let y = 255; y < 370; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y + (y - 300) * 0.18);
    ctx.stroke();
  }

  // 家屋（屋根を上から見た形）
  function house(x, y, width, height, roof, sign) {
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.fillRect(x + 8, y + 10, width, height);
    ctx.fillStyle = roof;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = "#281d18";
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, width, height);
    ctx.strokeStyle = "rgba(238,192,113,.25)";
    for (let sx = x + 12; sx < x + width; sx += 22) {
      ctx.beginPath();
      ctx.moveTo(sx, y + 5);
      ctx.lineTo(sx - 8, y + height - 5);
      ctx.stroke();
    }
    ctx.fillStyle = "#d1b36d";
    ctx.font = "bold 13px serif";
    ctx.textAlign = "center";
    ctx.fillText(sign, x + width / 2, y + height + 20);
  }
  house(65, 72, 175, 95, "#70452e", "魔具屋  『星読みの梟』");
  house(330, 66, 165, 100, "#63352e", "鍛冶屋  『鉄と炉火』");

  // 井戸とランタン
  ctx.fillStyle = "#24272a";
  ctx.beginPath();
  ctx.arc(292, 258, 31, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#77766d";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(292, 258, 27, 0, Math.PI * 2);
  ctx.stroke();
  [
    [35, 225],
    [545, 205],
    [550, 385],
  ].forEach(([x, y], i) => {
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 27);
    glow.addColorStop(
      0,
      `rgba(255,190,83,${0.38 + Math.sin(time * 4 + i) * 0.07})`,
    );
    glow.addColorStop(1, "rgba(255,150,40,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(x - 30, y - 30, 60, 60);
    ctx.fillStyle = "#d99a43";
    ctx.fillRect(x - 3, y - 5, 6, 10);
  });

  // 右端の塔門
  ctx.fillStyle = "#0a0b0e";
  ctx.fillRect(705, 170, 95, 260);
  ctx.fillStyle = "#55565b";
  ctx.fillRect(705, 170, 24, 260);
  ctx.fillStyle = "#77736b";
  ctx.fillRect(699, 165, 31, 270);
  ctx.fillStyle = "#16131a";
  ctx.fillRect(730, 220, 70, 160);
  const gateGlow = ctx.createLinearGradient(730, 0, 800, 0);
  gateGlow.addColorStop(0, "rgba(193,154,91,.12)");
  gateGlow.addColorStop(1, "rgba(230,195,126,.55)");
  ctx.fillStyle = gateGlow;
  ctx.fillRect(730, 220, 70, 160);
  ctx.fillStyle = "#d5bd86";
  ctx.font = "bold 15px serif";
  ctx.textAlign = "right";
  ctx.fillText("古塔入口  →", 690, 292);
  ctx.fillStyle = "#9e927a";
  ctx.font = "12px serif";
  ctx.fillText("歩いて塔へ挑む", 690, 313);

  // 準備パネル
  const autoBox = { x: 40, y: 438, w: 225, h: 125 };
  const hpBox = { x: 285, y: 438, w: 225, h: 125 };
  const autoHover =
    mouseX >= autoBox.x &&
    mouseX <= autoBox.x + autoBox.w &&
    mouseY >= autoBox.y &&
    mouseY <= autoBox.y + autoBox.h;
  const hpHover =
    mouseX >= hpBox.x &&
    mouseX <= hpBox.x + hpBox.w &&
    mouseY >= hpBox.y &&
    mouseY <= hpBox.y + hpBox.h;
  [autoBox, hpBox].forEach((box, i) => {
    const hover = i === 0 ? autoHover : hpHover;
    ctx.save();
    if (hover) {
      ctx.shadowColor = "#e1b45e";
      ctx.shadowBlur = 14;
    }
    ctx.fillStyle = hover ? "#2b281f" : "rgba(20,19,17,.92)";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.strokeStyle = hover ? "#d9b263" : "#75654a";
    ctx.lineWidth = hover ? 2 : 1;
    ctx.strokeRect(box.x, box.y, box.w, box.h);
    ctx.restore();
  });

  ctx.textAlign = "left";
  ctx.fillStyle = "#e1d1a9";
  ctx.font = "bold 16px serif";
  ctx.fillText("追尾の護符", 56, 465);
  ctx.fillStyle = "#9d9788";
  ctx.font = "12px sans-serif";
  ctx.fillText("最も近い敵へ自動で射撃する", 56, 487);
  ctx.fillStyle = permanentUpgrades.autoAimEnabled ? "#8ee0b0" : "#d5b66e";
  ctx.font = "bold 13px serif";
  const autoLabel = !permanentUpgrades.autoAimUnlocked
    ? `購入  ◆ ${autoAimUnlockCost}`
    : permanentUpgrades.autoAimEnabled
      ? "◆ ON（クリックでOFF）"
      : "◇ OFF（クリックでON）";
  if (!permanentUpgrades.autoAimUnlocked && bank < autoAimUnlockCost) {
    ctx.fillStyle = "#8a7770";
  }
  ctx.fillText(autoLabel, 56, 535);

  const hpCost = 20 + permanentUpgrades.hpLevel * 10;
  ctx.fillStyle = "#e1d1a9";
  ctx.font = "bold 16px serif";
  ctx.fillText("生命の鍛錬  +1 HP", 301, 465);
  ctx.fillStyle = "#9d9788";
  ctx.font = "12px sans-serif";
  ctx.fillText(`現在の最大HP  ${10 + permanentUpgrades.hpLevel}`, 301, 487);
  ctx.fillStyle = bank >= hpCost ? "#e2c06d" : "#8a7770";
  ctx.font = "bold 13px serif";
  ctx.fillText(`購入  ◆ ${hpCost}`, 301, 535);

  // 上部HUD
  ctx.fillStyle = "rgba(8,10,9,.78)";
  ctx.fillRect(18, 14, 764, 40);
  ctx.strokeStyle = "#655b43";
  ctx.strokeRect(18, 14, 764, 40);
  ctx.fillStyle = "#d7c59e";
  ctx.font = "bold 18px serif";
  ctx.textAlign = "left";
  ctx.fillText("塔の麓  —  灯火の村", 34, 40);
  ctx.textAlign = "right";
  ctx.fillStyle = "#e1c46f";
  ctx.fillText("所持金  ◆ " + bank, 762, 40);

  // 村でのプレイヤー（塔内と同じ赤い非人間型機体）
  const px = player.x + player.width / 2,
    py = player.y + player.height / 2;
  const villageMoveX = (rightPressed ? 1 : 0) - (leftPressed ? 1 : 0);
  const villageMoveY = (downPressed ? 1 : 0) - (upPressed ? 1 : 0);
  const villageAngle =
    villageMoveX !== 0 || villageMoveY !== 0
      ? Math.atan2(villageMoveY, villageMoveX)
      : 0;
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(villageAngle);
  ctx.shadowColor = "rgba(0,0,0,.6)";
  ctx.shadowBlur = 6;
  ctx.fillStyle = "#d93636";
  ctx.beginPath();
  ctx.moveTo(18, 0);
  ctx.lineTo(5, -6);
  ctx.lineTo(-5, -12);
  ctx.lineTo(-12, -6);
  ctx.lineTo(-9, 0);
  ctx.lineTo(-12, 6);
  ctx.lineTo(-5, 12);
  ctx.lineTo(5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#ff7777";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#8f2020";
  ctx.beginPath();
  ctx.moveTo(11, 0);
  ctx.lineTo(1, -4);
  ctx.lineTo(-6, 0);
  ctx.lineTo(1, 4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#ffaaaa";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(16, 0);
  ctx.lineTo(6, 0);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

const towerInteriorThemes = [
  {
    name: "古塔・下層回廊",
    floor: "#17191d",
    tile: "#22252a",
    line: "#30343a",
    accent: "#66543b",
    wall: "#555960",
    wallTop: "#777b80",
    motif: "stone",
  },
  {
    name: "ゴブリンの占拠区画",
    floor: "#151b16",
    tile: "#20291f",
    line: "#2c372a",
    accent: "#76602c",
    wall: "#4c5846",
    wallTop: "#6e765e",
    motif: "goblin",
  },
  {
    name: "蒼き魔導書庫",
    floor: "#121824",
    tile: "#1c2635",
    line: "#29374b",
    accent: "#426e8d",
    wall: "#46546a",
    wallTop: "#667a91",
    motif: "library",
  },
  {
    name: "深紅の錬金工房",
    floor: "#211514",
    tile: "#2d1d1a",
    line: "#402724",
    accent: "#8e4932",
    wall: "#654a43",
    wallTop: "#886257",
    motif: "alchemy",
  },
  {
    name: "星喰らいの祭壇",
    floor: "#181225",
    tile: "#241a35",
    line: "#37284c",
    accent: "#76529b",
    wall: "#584769",
    wallTop: "#7d6590",
    motif: "arcane",
  },
];

function getTowerInteriorTheme() {
  const clearedBosses = Math.floor((wave - 1) / 5);
  return towerInteriorThemes[clearedBosses % towerInteriorThemes.length];
}

function drawTowerInterior() {
  const theme = getTowerInteriorTheme();
  const w = canvas.width;
  const h = canvas.height;
  const tileSize = 50;

  ctx.save();
  ctx.fillStyle = theme.floor;
  ctx.fillRect(0, 0, w, h);

  // 真上から見た石床。戦闘対象より十分暗くする。
  for (let row = 0; row < Math.ceil(h / tileSize); row++) {
    for (let col = 0; col < Math.ceil(w / tileSize); col++) {
      if ((row + col) % 2 === 0) {
        ctx.fillStyle = theme.tile;
        ctx.fillRect(col * tileSize, row * tileSize, tileSize, tileSize);
      }
    }
  }
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.7;
  for (let x = 0; x <= w; x += tileSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += tileSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // 塔の外周壁と柱。プレイ領域の端だけに置く。
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#090b0d";
  ctx.fillRect(0, 0, w, 18);
  ctx.fillRect(0, h - 18, w, 18);
  ctx.fillRect(0, 0, 18, h);
  ctx.fillRect(w - 18, 0, 18, h);
  ctx.fillStyle = theme.wall;
  for (let x = 18; x < w - 18; x += 80) {
    ctx.fillRect(x, 4, 62, 10);
    ctx.fillRect(x, h - 14, 62, 10);
  }
  for (let y = 18; y < h - 18; y += 80) {
    ctx.fillRect(4, y, 10, 62);
    ctx.fillRect(w - 14, y, 10, 62);
  }

  // 階層ごとの床モチーフ（当たり判定なし・半透明）。
  ctx.strokeStyle = theme.accent;
  ctx.fillStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.22;
  if (theme.motif === "stone") {
    [
      [110, 110],
      [690, 110],
      [110, 490],
      [690, 490],
    ].forEach(([x, y]) => {
      ctx.strokeRect(x - 24, y - 24, 48, 48);
      ctx.strokeRect(x - 17, y - 17, 34, 34);
    });
  } else if (theme.motif === "goblin") {
    // 粗雑に塗られたゴブリンの戦旗と爪痕
    [
      [90, 150],
      [710, 450],
    ].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.moveTo(x - 20, y - 25);
      ctx.lineTo(x + 22, y - 18);
      ctx.lineTo(x + 14, y + 25);
      ctx.lineTo(x, y + 14);
      ctx.lineTo(x - 15, y + 25);
      ctx.closePath();
      ctx.fill();
    });
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(325 + i * 12, 75);
      ctx.lineTo(345 + i * 12, 115);
      ctx.stroke();
    }
  } else if (theme.motif === "library") {
    // 壁際の書架。中央の射線は空ける。
    [
      [70, 85],
      [730, 85],
      [70, 515],
      [730, 515],
    ].forEach(([x, y]) => {
      ctx.strokeRect(x - 32, y - 14, 64, 28);
      for (let i = -24; i <= 24; i += 12) ctx.fillRect(x + i, y - 10, 5, 20);
    });
  } else if (theme.motif === "alchemy") {
    [
      [105, 105],
      [695, 495],
    ].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, 38, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        const px = x + Math.cos(a) * 30,
          py = y + Math.sin(a) * 30;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    });
  } else {
    // 魔法陣は画面中央だが極めて薄く、敵や弾を隠さない。
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 105, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, 76, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 4;
      const px = w / 2 + Math.cos(a) * 96,
        py = h / 2 + Math.sin(a) * 96;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function drawDungeonWall(wall) {
  const theme = getTowerInteriorTheme();
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fillRect(wall.x + 5, wall.y + 7, wall.width, wall.height);
  ctx.fillStyle = theme.wall;
  ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
  ctx.fillStyle = theme.wallTop;
  ctx.fillRect(wall.x, wall.y, wall.width, 7);
  ctx.strokeStyle = "rgba(20,18,18,.45)";
  ctx.lineWidth = 1;
  for (let x = wall.x + 24; x < wall.x + wall.width; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, wall.y + 7);
    ctx.lineTo(x, wall.y + wall.height);
    ctx.stroke();
  }
  ctx.strokeRect(wall.x, wall.y, wall.width, wall.height);
}

function drawBossExitDoor() {
  if (wave % 5 !== 0) return;

  const theme = getTowerInteriorTheme();
  const time = performance.now() / 1000;
  const doorX = canvas.width - 42;
  const doorY = canvas.height / 2 - 66;
  const doorW = 42;
  const doorH = 132;

  ctx.save();

  // 真上から見た上階へ続く短い階段
  ctx.fillStyle = "rgba(4,5,7,.85)";
  ctx.fillRect(doorX - 45, doorY + 12, doorW + 45, doorH - 24);
  for (let i = 0; i < 5; i++) {
    const sx = doorX - 42 + i * 9;
    ctx.fillStyle = i % 2 === 0 ? theme.wall : theme.wallTop;
    ctx.fillRect(sx, doorY + 17, 8, doorH - 34);
  }

  // 石造りの扉枠
  ctx.fillStyle = "#09090d";
  ctx.fillRect(doorX - 5, doorY - 8, doorW + 5, doorH + 16);
  ctx.fillStyle = theme.wallTop;
  ctx.fillRect(doorX - 5, doorY - 8, 9, doorH + 16);
  ctx.fillStyle = "#17131d";
  ctx.fillRect(doorX + 4, doorY, doorW - 4, doorH);

  if (!bossExitUnlocked) {
    // ボスが生きている間の魔法障壁
    const pulse = 0.58 + Math.sin(time * 4) * 0.16;
    ctx.fillStyle = `rgba(111,54,161,${pulse * 0.42})`;
    ctx.fillRect(doorX - 38, doorY + 14, 39, doorH - 28);
    ctx.strokeStyle = `rgba(203,133,255,${pulse})`;
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const bx = doorX - 32 + i * 13;
      ctx.beginPath();
      ctx.moveTo(bx, doorY + 18);
      ctx.lineTo(bx + Math.sin(time * 3 + i) * 5, doorY + doorH - 18);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(doorX - 17, canvas.height / 2, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#c592e8";
    ctx.font = "16px serif";
    ctx.textAlign = "center";
    ctx.fillText("✦", doorX - 17, canvas.height / 2 + 6);
  } else {
    // 撃破後は奥から光が差し、進行方向を示す
    const glow = 0.68 + Math.sin(time * 2.6) * 0.2;
    const exitGlow = ctx.createLinearGradient(doorX - 48, 0, canvas.width, 0);
    exitGlow.addColorStop(0, "rgba(221,187,112,0)");
    exitGlow.addColorStop(1, `rgba(245,217,146,${glow})`);
    ctx.fillStyle = exitGlow;
    ctx.fillRect(doorX - 48, doorY + 8, 48, doorH - 16);
    ctx.strokeStyle = `rgba(245,216,145,${glow})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(doorX - 42, doorY + 15, 38, doorH - 30);

    ctx.textAlign = "right";
    ctx.fillStyle = `rgba(245,224,178,${glow})`;
    ctx.shadowColor = "#d5a856";
    ctx.shadowBlur = 8;
    ctx.font = "bold 14px serif";
    ctx.fillText("封印解除  →", doorX - 52, canvas.height / 2 - 5);
    ctx.font = "11px serif";
    ctx.fillText(
      "扉へ進み、遺産を継承する",
      doorX - 52,
      canvas.height / 2 + 15,
    );
  }

  ctx.restore();
}

function drawAutoAimMarker() {
  if (!isAutoAimActive()) return;
  const target = getNearestEnemy();
  if (!target) return;
  const time = performance.now() / 1000;
  const px = player.x + player.width / 2;
  const py = player.y + player.height / 2;
  const tx = target.x + target.width / 2;
  const ty = target.y + target.height / 2;
  const radius = Math.max(target.width, target.height) * 0.58 + 7;
  const pulse = 0.68 + Math.sin(time * 7) * 0.18;
  ctx.save();
  ctx.strokeStyle = `rgba(102,225,216,${pulse * 0.42})`;
  ctx.lineWidth = 1;
  ctx.setLineDash([7, 7]);
  ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = `rgba(126,255,226,${pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(tx, ty, radius, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tx - radius - 5, ty); ctx.lineTo(tx - radius + 5, ty);
  ctx.moveTo(tx + radius - 5, ty); ctx.lineTo(tx + radius + 5, ty);
  ctx.moveTo(tx, ty - radius - 5); ctx.lineTo(tx, ty - radius + 5);
  ctx.moveTo(tx, ty + radius - 5); ctx.lineTo(tx, ty + radius + 5);
  ctx.stroke();
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // ==================================================
  // スタート画面
  // ==================================================

  if (gameState === "start") {
    drawStartScreen();
    return;
  }

  if (gameState === "village") {
    drawVillage();
    return;
  }

  drawTowerInterior();
  drawBossExitDoor();

  // ==================================================
  // プレイヤー
  // 戦闘機型
  // ==================================================

  const playerCenterX = player.x + player.width / 2;
  const playerCenterY = player.y + player.height / 2;

  const activelyShooting =
    mousePressed || spacePressed || (isAutoAimActive() && enemies.length > 0);
  const aim = activelyShooting
    ? getAimDirection()
    : { x: playerFacingX, y: playerFacingY };
  const playerAngle = Math.atan2(aim.y, aim.x);

  ctx.save();

  ctx.translate(playerCenterX, playerCenterY);
  ctx.rotate(playerAngle);

  // ==================================================
  // 機体本体
  // ==================================================

  ctx.beginPath();

  ctx.moveTo(22, 0); // 機首
  ctx.lineTo(7, -7);
  ctx.lineTo(-5, -15); // 左上翼
  ctx.lineTo(-10, -9);
  ctx.lineTo(-15, -7);
  ctx.lineTo(-11, 0);

  ctx.lineTo(-15, 7);
  ctx.lineTo(-10, 9);
  ctx.lineTo(-5, 15); // 左下翼
  ctx.lineTo(7, 7);

  ctx.closePath();

  ctx.fillStyle = "#d93636";
  ctx.fill();

  ctx.strokeStyle = "#ff7070";
  ctx.lineWidth = 2;
  ctx.stroke();

  // ==================================================
  // 中央装甲
  // ==================================================

  ctx.beginPath();

  ctx.moveTo(13, 0);
  ctx.lineTo(3, -4);
  ctx.lineTo(-5, -5);
  ctx.lineTo(-8, 0);
  ctx.lineTo(-5, 5);
  ctx.lineTo(3, 4);
  ctx.closePath();

  ctx.fillStyle = "#8f2020";
  ctx.fill();

  // ==================================================
  // 翼の装飾
  // ==================================================

  ctx.strokeStyle = "#ff8888";
  ctx.lineWidth = 2;

  ctx.beginPath();

  ctx.moveTo(-4, -10);
  ctx.lineTo(-11, -5);

  ctx.moveTo(-4, 10);
  ctx.lineTo(-11, 5);

  ctx.stroke();

  // ==================================================
  // 機首のライン
  // ==================================================

  ctx.strokeStyle = "#ffaaaa";
  ctx.lineWidth = 1.5;

  ctx.beginPath();
  ctx.moveTo(20, 0);
  ctx.lineTo(7, 0);
  ctx.stroke();

  ctx.restore();

  // ==================================================
  // 銃
  // ==================================================

  const gunAngle = Math.atan2(aim.y, aim.x);

  ctx.save();

  ctx.translate(playerCenterX, playerCenterY);
  ctx.rotate(gunAngle);

  // 銃の本体
  ctx.fillStyle = "black";
  ctx.fillRect(4, -6, 18, 12);

  // 銃身
  ctx.fillStyle = "gray";
  ctx.fillRect(15, -4, gunLength - 10, 8);

  // 銃口
  ctx.fillStyle = "darkgray";
  ctx.fillRect(gunLength - 2, -5, 5, 10);

  // エネルギー部分
  ctx.fillStyle = "brown";
  ctx.fillRect(18, -2, gunLength - 20, 4);

  ctx.restore();

  // ==================================================
  // 壁
  // ==================================================

  for (const wall of walls) {
    drawDungeonWall(wall);
  }

  // ==================================================
  // 敵
  // ==================================================

  for (const enemy of enemies) {
    drawEnemy(enemy);
  }
  drawAutoAimMarker();
  // ==================================================
  // ゲージ
  // ==================================================

  ctx.font = "20px sans-serif";
  ctx.textAlign = "left";

  // プレイヤーゲージ：最大値にかかわらず固定幅
  const playerGaugeX = 12;
  const playerGaugeW = 176;
  const hpRatio = Math.max(0, Math.min(1, player.hp / player.maxHp));
  const displayedHpRatio = Math.max(0, Math.min(1, displayedHp / player.maxHp));
  const staminaRatio = Math.max(0, Math.min(1, stamina / maxStamina));

  ctx.fillStyle = "rgba(7,8,11,.9)";
  ctx.fillRect(7, 7, 218, 64);
  ctx.strokeStyle = "#655d50";
  ctx.lineWidth = 1;
  ctx.strokeRect(7, 7, 218, 64);

  ctx.textAlign = "left";
  ctx.font = "bold 10px serif";
  ctx.fillStyle = "#c8bca6";
  ctx.fillText("LIFE", playerGaugeX, 21);
  ctx.fillStyle = "#1b1719";
  ctx.fillRect(playerGaugeX, 26, playerGaugeW, 12);
  ctx.fillStyle = "#7d3e31";
  ctx.fillRect(playerGaugeX, 26, playerGaugeW * displayedHpRatio, 12);
  const hpGradient = ctx.createLinearGradient(
    playerGaugeX,
    0,
    playerGaugeX + playerGaugeW,
    0,
  );
  hpGradient.addColorStop(0, "#a62f35");
  hpGradient.addColorStop(1, "#e55b4f");
  ctx.fillStyle = hpGradient;
  ctx.fillRect(playerGaugeX, 26, playerGaugeW * hpRatio, 12);
  ctx.strokeStyle = "#896e61";
  ctx.strokeRect(playerGaugeX, 26, playerGaugeW, 12);
  ctx.textAlign = "right";
  ctx.fillStyle = "#eee3d0";
  ctx.font = "10px sans-serif";
  ctx.fillText(
    `${Math.max(0, Math.ceil(player.hp))} / ${player.maxHp}`,
    218,
    36,
  );

  ctx.textAlign = "left";
  ctx.fillStyle = "#c8bca6";
  ctx.font = "bold 10px serif";
  ctx.fillText("VIGOR", playerGaugeX, 53);
  ctx.fillStyle = "#14191b";
  ctx.fillRect(playerGaugeX, 57, playerGaugeW, 8);
  ctx.fillStyle = staminaExhausted
    ? "#a63b37"
    : staminaRatio <= 0.25
      ? "#d6a63e"
      : "#3ca69a";
  ctx.fillRect(playerGaugeX, 57, playerGaugeW * staminaRatio, 8);
  ctx.strokeStyle = "#59696a";
  ctx.strokeRect(playerGaugeX, 57, playerGaugeW, 8);

  // ==================================================
  // スコア
  // ==================================================

  ctx.fillStyle = "white";
  ctx.font = "20px sans-serif";
  ctx.textAlign = "left";

  ctx.fillText("スコア: " + score, 240, 25);

  // 自動射撃の状態。クリック長押し中は一時的に手動照準へ切り替わる。
  if (permanentUpgrades.autoAimUnlocked) {
    const manualOverride = permanentUpgrades.autoAimEnabled && mousePressed;
    ctx.font = "bold 12px sans-serif";
    ctx.fillStyle = manualOverride
      ? "#ffd27a"
      : permanentUpgrades.autoAimEnabled
        ? "#7fe4b0"
        : "#8f939b";
    ctx.fillText(
      manualOverride
        ? "[Q] AUTO: 手動照準中"
        : `[Q] AUTO: ${permanentUpgrades.autoAimEnabled ? "ON" : "OFF"}`,
      240,
      46,
    );
  }

  // 右上：塔の階層表示
  const marksStartX = canvas.width - 150;
  const markY = 20;
  const gap = 30;

  for (let i = 0; i < 5; i++) {
    const mx = marksStartX + i * gap;
    const floorNum = wave + i;

    if (floorNum % 5 === 0) {
      ctx.fillStyle = "#ff5d5d";
      ctx.beginPath();
      ctx.arc(mx, markY, 8, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = "#d7d7ff";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, markY, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  ctx.fillStyle = "#d7d7ff";
  ctx.beginPath();
  ctx.moveTo(marksStartX - 4, markY + 14);
  ctx.lineTo(marksStartX + 4, markY + 14);
  ctx.lineTo(marksStartX, markY + 8);
  ctx.closePath();
  ctx.fill();

  ctx.textAlign = "right";
  ctx.fillStyle = "#f5f5ff";
  ctx.font = "18px sans-serif";
  ctx.fillText("階層: " + wave, canvas.width - 10, markY + 38);

  ctx.fillStyle = "#ff9a9a";
  ctx.font = "16px sans-serif";
  ctx.fillText("残存敵: " + enemies.length, canvas.width - 10, markY + 68);

  ctx.fillStyle = "rgba(215,215,255,.62)";
  ctx.font = "12px serif";
  ctx.fillText(getTowerInteriorTheme().name, canvas.width - 10, markY + 89);

  // 戻す
  ctx.textAlign = "left";

  // ==================================================
  // プレイヤー弾
  // ==================================================

  ctx.fillStyle = "white";

  for (const bullet of bullets) {
    ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
  }

  // ==================================================
  // 敵弾
  // ==================================================

  ctx.fillStyle = "red";

  for (const bullet of enemyBullets) {
    ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
  }

  // ==================================================
  // エフェクト
  // ==================================================

  drawParticles();

  // ==================================================
  // アイテム
  // ==================================================

  for (const item of items) {
    if (item.type === "heal") {
      ctx.fillStyle = "lime";
    } else if (item.type === "explode") {
      ctx.fillStyle = "darkred";
    } else if (item.type === "burst") {
      ctx.fillStyle = "yellow";
    }

    ctx.fillRect(item.x, item.y, item.width, item.height);
  }

  if (gameState === "paused") {
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "white";
    ctx.font = "bold 60px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("PAUSED", canvas.width / 2, canvas.height / 2);

    ctx.font = "20px sans-serif";
    ctx.fillText("ESCで再開", canvas.width / 2, canvas.height / 2 + 40);
    return;
  }

  // ==================================================
  // ゲームオーバー
  // ==================================================

  if (gameState === "gameover") {
    const time = performance.now() / 1000;
    ctx.fillStyle = "rgba(3, 3, 7, 0.9)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const deathGlow = ctx.createRadialGradient(400, 245, 20, 400, 245, 280);
    deathGlow.addColorStop(0, "rgba(108,22,24,.22)");
    deathGlow.addColorStop(1, "rgba(20,0,5,0)");
    ctx.fillStyle = deathGlow;
    ctx.fillRect(100, 0, 600, 570);

    // 砕けた魔法陣
    ctx.save();
    ctx.translate(canvas.width / 2, 245);
    ctx.rotate(-0.05);
    ctx.strokeStyle = "rgba(129,49,51,.32)";
    ctx.lineWidth = 2;
    ctx.setLineDash([28, 12, 5, 14]);
    ctx.beginPath();
    ctx.arc(0, 0, 168, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 145, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 墓碑を思わせるリザルト枠
    ctx.fillStyle = "rgba(10,9,13,.88)";
    ctx.fillRect(205, 128, 390, 348);
    ctx.strokeStyle = "#514747";
    ctx.lineWidth = 5;
    ctx.strokeRect(205, 128, 390, 348);
    ctx.strokeStyle = "#8a6b5d";
    ctx.lineWidth = 1;
    ctx.strokeRect(214, 137, 372, 330);

    ctx.fillStyle = "#8f2e32";
    ctx.shadowColor = "rgba(180,30,35,.55)";
    ctx.shadowBlur = 10;
    ctx.font = "bold 49px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("You Died", canvas.width / 2, 200);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#958579";
    ctx.font = "12px Georgia, serif";
    ctx.fillText("THE TOWER CLAIMS ANOTHER SOUL", canvas.width / 2, 224);
    ctx.fillStyle = "#7a5a4c";
    ctx.fillRect(280, 241, 240, 1);

    const resultRows = [
      ["SCORE", score],
      ["ENEMIES SLAIN", kills],
      ["FLOOR REACHED", wave + " F"],
      ["TIME", Math.floor(gameTime) + " sec"],
    ];
    ctx.font = "15px Georgia, serif";
    resultRows.forEach(([label, value], i) => {
      const y = 278 + i * 36;
      ctx.textAlign = "left";
      ctx.fillStyle = "#7d756d";
      ctx.fillText(label, 254, y);
      ctx.textAlign = "right";
      ctx.fillStyle = "#d0c3aa";
      ctx.fillText(value, 546, y);
    });
    ctx.textAlign = "center";
    ctx.fillStyle = "#6f655c";
    ctx.font = "12px serif";
    ctx.fillText("最高記録  " + highScore, canvas.width / 2, 432);

    const retryPulse = 0.65 + Math.sin(time * 3) * 0.25;
    ctx.fillStyle = `rgba(226,198,145,${retryPulse})`;
    ctx.shadowColor = "#b77a3e";
    ctx.shadowBlur = 8 * retryPulse;
    ctx.font = "bold 17px serif";
    ctx.fillText("◆  R  灯火の村へ帰還  ◆", canvas.width / 2, 456);
    ctx.shadowBlur = 0;

    // ゲームオーバー時の銀行加算を一度だけ行う
    if (!bankedThisGame) {
      handleGameOverBanking();
      bankedThisGame = true;
    }
  }

  // ボス報酬モーダル
  if (gameState === "bossReward") {
    ctx.fillStyle = "rgba(2,3,8,0.9)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const modalX = canvas.width / 2 - 300;
    const modalY = canvas.height / 2 - 190;
    const modalW = 600;
    const modalH = 380;

    const modalGradient = ctx.createLinearGradient(
      0,
      modalY,
      0,
      modalY + modalH,
    );
    modalGradient.addColorStop(0, "#171521");
    modalGradient.addColorStop(1, "#090a10");
    ctx.fillStyle = modalGradient;
    ctx.fillRect(modalX, modalY, modalW, modalH);
    ctx.strokeStyle = "#66583e";
    ctx.lineWidth = 5;
    ctx.strokeRect(modalX, modalY, modalW, modalH);
    ctx.strokeStyle = "#a68a52";
    ctx.lineWidth = 1;
    ctx.strokeRect(modalX + 9, modalY + 9, modalW - 18, modalH - 18);

    // 四隅のルーン
    ctx.fillStyle = "#b69758";
    ctx.font = "20px serif";
    ctx.textAlign = "center";
    ctx.fillText("✦", modalX + 22, modalY + 29);
    ctx.fillText("✦", modalX + modalW - 22, modalY + 29);
    ctx.fillText("✦", modalX + 22, modalY + modalH - 15);
    ctx.fillText("✦", modalX + modalW - 22, modalY + modalH - 15);

    ctx.fillStyle = "#dfcfaa";
    ctx.font = "bold 25px Georgia, serif";
    ctx.fillText("守護者の遺産", canvas.width / 2, modalY + 45);
    ctx.fillStyle = "#8e8169";
    ctx.font = "12px serif";
    ctx.fillText(
      "力をひとつ継承し、塔の上層へ進め",
      canvas.width / 2,
      modalY + 67,
    );
    ctx.strokeStyle = "#806b42";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(modalX + 72, modalY + 78);
    ctx.lineTo(modalX + modalW - 72, modalY + 78);
    ctx.stroke();

    ctx.textAlign = "right";
    ctx.fillStyle = "#d7bd6a";
    ctx.font = "14px serif";
    ctx.fillText("所持金  ◆ " + bank, modalX + modalW - 30, modalY + 100);

    const cardW = 170;
    const cardH = 165;
    const cardSpacing = 18;

    for (let i = 0; i < bossOptions.length; i++) {
      const opt = bossOptions[i];
      const bx = modalX + 27 + i * (cardW + cardSpacing);
      const by = modalY + 116;
      const bw = cardW;
      const bh = cardH;
      const hovered =
        mouseX >= bx && mouseX <= bx + bw && mouseY >= by && mouseY <= by + bh;

      ctx.save();
      if (hovered) {
        ctx.shadowColor = "#e5b85f";
        ctx.shadowBlur = 20;
      }
      ctx.fillStyle = hovered ? "#292438" : "#15151d";
      ctx.fillRect(bx, by - (hovered ? 4 : 0), bw, bh);
      ctx.strokeStyle = hovered ? "#e2bd6f" : "#665d50";
      ctx.lineWidth = hovered ? 3 : 1;
      ctx.strokeRect(bx, by - (hovered ? 4 : 0), bw, bh);
      ctx.shadowBlur = 0;

      ctx.textAlign = "center";
      ctx.fillStyle = hovered ? "#f1ce7f" : "#907d59";
      ctx.font = "22px Georgia, serif";
      ctx.fillText(
        ["Ⅰ", "Ⅱ", "Ⅲ"][i],
        bx + bw / 2,
        by + 29 - (hovered ? 4 : 0),
      );

      ctx.fillStyle = hovered ? "#fff0c9" : "#ddd2b8";
      ctx.font = "bold 15px serif";
      ctx.fillText(opt.name, bx + bw / 2, by + 57 - (hovered ? 4 : 0));

      ctx.textAlign = "left";
      ctx.fillStyle = "#9d9991";
      ctx.font = "12px sans-serif";
      wrapText(
        ctx,
        opt.desc,
        bx + 13,
        by + 78 - (hovered ? 4 : 0),
        bw - 26,
        17,
      );

      ctx.textAlign = "center";
      ctx.fillStyle = hovered ? "#efca75" : "#746c60";
      ctx.font = "12px serif";
      ctx.fillText(
        hovered ? "◆  継承する  ◆" : "選択",
        bx + bw / 2,
        by + bh - 15,
      );
      ctx.restore();
    }

    const rx = modalX + modalW / 2 - 80;
    const ry = modalY + modalH - 67;
    const rw = 160;
    const rh = 40;
    const rerollHovered =
      mouseX >= rx && mouseX <= rx + rw && mouseY >= ry && mouseY <= ry + rh;
    ctx.save();
    if (rerollHovered) {
      ctx.shadowColor = "#6caed0";
      ctx.shadowBlur = 15;
    }
    ctx.fillStyle = rerollHovered ? "#29465a" : "#1b2936";
    ctx.fillRect(rx, ry, rw, rh);
    ctx.strokeStyle = rerollHovered ? "#9cdbef" : "#547183";
    ctx.lineWidth = rerollHovered ? 2 : 1;
    ctx.strokeRect(rx, ry, rw, rh);
    ctx.shadowBlur = 0;
    ctx.fillStyle = rerollHovered ? "#d5f4ff" : "#a6bcc8";
    ctx.font = "bold 13px serif";
    ctx.textAlign = "center";
    if (bossRerollsLeft > 0) {
      ctx.fillText("↻  運命を再抽選（無料）", rx + rw / 2, ry + 25);
    } else {
      ctx.fillText("↻  再抽選  ◆ " + bossRerollCost, rx + rw / 2, ry + 25);
    }
    ctx.restore();
    ctx.textAlign = "left";
  }
}
// ==================================================
// ゲームループ
// ==================================================

function gameLoop() {
  update();
  draw();

  requestAnimationFrame(gameLoop);
}

function drawEnemy(enemy) {
  const cx = enemy.x + enemy.width / 2;
  const cy = enemy.y + enemy.height / 2;

  ctx.save();

  // ==================================================
  // Normal
  // 小型兵器・ドローン風
  // ==================================================

  if (enemy.type === "normal") {
    const w = enemy.width;
    const h = enemy.height;

    // 本体
    ctx.fillStyle = "#d6b900";

    ctx.beginPath();
    ctx.moveTo(enemy.x + 8, enemy.y);
    ctx.lineTo(enemy.x + w - 8, enemy.y);
    ctx.lineTo(enemy.x + w, enemy.y + 8);
    ctx.lineTo(enemy.x + w, enemy.y + h - 8);
    ctx.lineTo(enemy.x + w - 8, enemy.y + h);
    ctx.lineTo(enemy.x + 8, enemy.y + h);
    ctx.lineTo(enemy.x, enemy.y + h - 8);
    ctx.lineTo(enemy.x, enemy.y + 8);
    ctx.closePath();
    ctx.fill();

    // 外周装甲
    ctx.strokeStyle = "#fff06a";
    ctx.lineWidth = 3;
    ctx.stroke();

    // 中央の砲台
    ctx.fillStyle = "#8f7c00";
    ctx.fillRect(cx - 7, cy - 7, 14, 14);

    // 砲身
    ctx.fillStyle = "#4a4100";
    ctx.fillRect(cx - 3, enemy.y - 7, 6, 10);

    // 小さな装甲ライン
    ctx.strokeStyle = "#6f6100";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(enemy.x + 8, enemy.y + 12);
    ctx.lineTo(enemy.x + 8, enemy.y + h - 12);
    ctx.moveTo(enemy.x + w - 8, enemy.y + 12);
    ctx.lineTo(enemy.x + w - 8, enemy.y + h - 12);
    ctx.stroke();
  }

  // ==================================================
  // Shooter
  // 中型砲台兵器
  // ==================================================
  else if (enemy.type === "shooter") {
    const w = enemy.width;
    const h = enemy.height;

    // 外装
    ctx.fillStyle = "#00a9b5";

    ctx.beginPath();
    ctx.moveTo(enemy.x + 7, enemy.y);
    ctx.lineTo(enemy.x + w - 7, enemy.y);
    ctx.lineTo(enemy.x + w, enemy.y + 7);
    ctx.lineTo(enemy.x + w, enemy.y + h - 7);
    ctx.lineTo(enemy.x + w - 7, enemy.y + h);
    ctx.lineTo(enemy.x + 7, enemy.y + h);
    ctx.lineTo(enemy.x, enemy.y + h - 7);
    ctx.lineTo(enemy.x, enemy.y + 7);
    ctx.closePath();
    ctx.fill();

    // 外周ライン
    ctx.strokeStyle = "#7ffaff";
    ctx.lineWidth = 3;
    ctx.stroke();

    // 左右の装甲
    ctx.fillStyle = "#087783";

    ctx.fillRect(enemy.x + 4, enemy.y + 11, 7, h - 22);
    ctx.fillRect(enemy.x + w - 11, enemy.y + 11, 7, h - 22);

    // 中央砲台
    ctx.fillStyle = "#064d54";
    ctx.fillRect(cx - 8, cy - 8, 16, 16);

    // 砲身
    ctx.fillStyle = "#032f34";
    ctx.fillRect(cx - 3, enemy.y - 9, 6, 15);

    // 後部装甲ライン
    ctx.strokeStyle = "#075963";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.moveTo(enemy.x + 13, enemy.y + h - 9);
    ctx.lineTo(enemy.x + w - 13, enemy.y + h - 9);
    ctx.stroke();

    // 発射予測線
    if (enemy.shootCooldown <= 20) {
      const targetX = player.x + player.width / 2;
      const targetY = player.y + player.height / 2;

      ctx.strokeStyle = "rgba(0, 255, 255, 0.6)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(targetX, targetY);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(targetX, targetY, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ==================================================
  // Giant
  // 大型装甲兵器
  // ==================================================
  else if (enemy.type === "big") {
    const w = enemy.width;
    const h = enemy.height;

    // 本体
    ctx.fillStyle = "#d87800";

    ctx.beginPath();
    ctx.moveTo(enemy.x + 12, enemy.y);
    ctx.lineTo(enemy.x + w - 12, enemy.y);
    ctx.lineTo(enemy.x + w, enemy.y + 12);
    ctx.lineTo(enemy.x + w, enemy.y + h - 12);
    ctx.lineTo(enemy.x + w - 12, enemy.y + h);
    ctx.lineTo(enemy.x + 12, enemy.y + h);
    ctx.lineTo(enemy.x, enemy.y + h - 12);
    ctx.lineTo(enemy.x, enemy.y + 12);
    ctx.closePath();
    ctx.fill();

    // 外周装甲
    ctx.strokeStyle = "#ffbd45";
    ctx.lineWidth = 4;
    ctx.stroke();

    // 左右の大型装甲
    ctx.fillStyle = "#9b4f00";

    ctx.fillRect(enemy.x + 7, enemy.y + 17, 13, h - 34);

    ctx.fillRect(enemy.x + w - 20, enemy.y + 17, 13, h - 34);

    // 中央砲台
    ctx.fillStyle = "#633300";

    ctx.fillRect(cx - 17, cy - 17, 34, 34);

    // 大型砲身
    ctx.fillStyle = "#321a00";

    ctx.fillRect(cx - 7, enemy.y - 17, 14, 25);

    // 砲口
    ctx.fillStyle = "#111";

    ctx.beginPath();
    ctx.arc(cx, enemy.y - 14, 7, 0, Math.PI * 2);
    ctx.fill();

    // 装甲ライン
    ctx.strokeStyle = "#7a3f00";
    ctx.lineWidth = 3;

    ctx.beginPath();

    ctx.moveTo(enemy.x + 25, enemy.y + 10);

    ctx.lineTo(enemy.x + 25, enemy.y + h - 10);

    ctx.moveTo(enemy.x + w - 25, enemy.y + 10);

    ctx.lineTo(enemy.x + w - 25, enemy.y + h - 10);

    ctx.stroke();
  }

  // ==================================================
  // Tullet
  // 双砲型兵器
  // ==================================================
  else if (enemy.type === "tullet") {
    const w = enemy.width;
    const h = enemy.height;

    // 本体
    ctx.fillStyle = "#777";

    ctx.beginPath();

    ctx.moveTo(enemy.x + 10, enemy.y);

    ctx.lineTo(enemy.x + w - 10, enemy.y);

    ctx.lineTo(enemy.x + w, enemy.y + h / 2);

    ctx.lineTo(enemy.x + w - 10, enemy.y + h);

    ctx.lineTo(enemy.x + 10, enemy.y + h);

    ctx.lineTo(enemy.x, enemy.y + h / 2);

    ctx.closePath();
    ctx.fill();

    // 外周装甲
    ctx.strokeStyle = "#bdbdbd";
    ctx.lineWidth = 4;
    ctx.stroke();

    // 中央装甲
    ctx.fillStyle = "#4b4b4b";

    ctx.fillRect(cx - 10, enemy.y + 9, 20, h - 18);

    // 左砲台
    ctx.fillStyle = "#303030";

    ctx.fillRect(enemy.x - 6, cy - 5, 18, 10);

    // 右砲台
    ctx.fillRect(enemy.x + w - 12, cy - 5, 18, 10);

    // 左砲口
    ctx.fillStyle = "#111";

    ctx.beginPath();

    ctx.arc(enemy.x - 5, cy, 5, 0, Math.PI * 2);

    ctx.fill();

    // 右砲口
    ctx.beginPath();

    ctx.arc(enemy.x + w + 5, cy, 5, 0, Math.PI * 2);

    ctx.fill();

    // 上下の装甲ライン
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 2;

    ctx.beginPath();

    ctx.moveTo(enemy.x + 15, enemy.y + 8);

    ctx.lineTo(enemy.x + w - 15, enemy.y + 8);

    ctx.moveTo(enemy.x + 15, enemy.y + h - 8);

    ctx.lineTo(enemy.x + w - 15, enemy.y + h - 8);

    ctx.stroke();
  }

  // ==================================================
  // Laser
  // ==================================================
  else if (enemy.type === "laser") {
    ctx.translate(cx, cy);

    ctx.rotate(enemy.angle);

    ctx.beginPath();
    ctx.moveTo(enemy.width * 0.5, 0);
    ctx.lineTo(0, -enemy.height * 0.4);
    ctx.lineTo(-enemy.width * 0.5, 0);
    ctx.lineTo(0, enemy.height * 0.4);
    ctx.closePath();

    ctx.fillStyle = enemy.color;
    ctx.fill();

    ctx.strokeStyle = "black";
    ctx.lineWidth = 3;
    ctx.stroke();

    // 発射コア
    ctx.beginPath();
    ctx.arc(enemy.width * 0.18, 0, enemy.width * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = "red";
    ctx.fill();

    // 待機中のチャージ感
    if (enemy.shootCooldown > 0) {
      ctx.beginPath();
      ctx.arc(0, 0, enemy.width * 0.28, 0, Math.PI * 2);
      ctx.strokeStyle = "red";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }
  // ==================================================
  // Spawner
  // 生成装置・檻型
  // ==================================================
  else if (enemy.type === "spawner") {
    const w = enemy.width; // 60
    const h = enemy.height; // 60

    // --------------------------------------------------
    // 外側の金属フレーム
    // --------------------------------------------------

    ctx.strokeStyle = "#777";
    ctx.lineWidth = 4;

    ctx.strokeRect(enemy.x + 5, enemy.y + 5, w - 10, h - 10);

    // --------------------------------------------------
    // 内側の暗い空間
    // --------------------------------------------------

    ctx.fillStyle = "#202020";

    ctx.fillRect(enemy.x + 10, enemy.y + 10, w - 20, h - 20);

    // --------------------------------------------------
    // 檻の縦棒
    // --------------------------------------------------

    ctx.strokeStyle = "#aaa";
    ctx.lineWidth = 3;

    for (let i = 0; i < 5; i++) {
      const x = enemy.x + 12 + i * ((w - 24) / 4);

      ctx.beginPath();
      ctx.moveTo(x, enemy.y + 7);
      ctx.lineTo(x, enemy.y + h - 7);
      ctx.stroke();
    }

    // --------------------------------------------------
    // 檻の横棒
    // --------------------------------------------------

    for (let i = 0; i < 5; i++) {
      const y = enemy.y + 12 + i * ((h - 24) / 4);

      ctx.beginPath();
      ctx.moveTo(enemy.x + 7, y);
      ctx.lineTo(enemy.x + w - 7, y);
      ctx.stroke();
    }

    // --------------------------------------------------
    // 四隅の補強パーツ
    // --------------------------------------------------

    ctx.fillStyle = "#555";

    ctx.fillRect(enemy.x + 2, enemy.y + 2, 10, 10);
    ctx.fillRect(enemy.x + w - 12, enemy.y + 2, 10, 10);
    ctx.fillRect(enemy.x + 2, enemy.y + h - 12, 10, 10);
    ctx.fillRect(enemy.x + w - 12, enemy.y + h - 12, 10, 10);

    // --------------------------------------------------
    // 中央の生成エリア
    // --------------------------------------------------

    ctx.strokeStyle = "#888";
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.arc(cx, cy, 11, 0, Math.PI * 2);
    ctx.stroke();

    // 生成装置らしい小さな回路ライン
    ctx.beginPath();

    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx - 3, cy);

    ctx.moveTo(cx + 3, cy);
    ctx.lineTo(cx + 8, cy);

    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx, cy - 3);

    ctx.moveTo(cx, cy + 3);
    ctx.lineTo(cx, cy + 8);

    ctx.stroke();
  }

  // ==================================================
  // Minion
  // 超小型・雑魚兵器
  // ==================================================
  else if (enemy.type === "minion") {
    const w = enemy.width; // 10
    const h = enemy.height; // 10

    // 小さな本体
    ctx.fillStyle = "#6f6f6f";

    ctx.beginPath();

    ctx.moveTo(enemy.x + 2, enemy.y);
    ctx.lineTo(enemy.x + w - 2, enemy.y);
    ctx.lineTo(enemy.x + w, enemy.y + 3);
    ctx.lineTo(enemy.x + w - 2, enemy.y + h);
    ctx.lineTo(enemy.x + 2, enemy.y + h);
    ctx.lineTo(enemy.x, enemy.y + 3);

    ctx.closePath();
    ctx.fill();

    // 外周
    ctx.strokeStyle = "#bdbdbd";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // 小さい推進装置っぽい後部
    ctx.fillStyle = "#333";

    ctx.fillRect(enemy.x - 2, enemy.y + 3, 3, 4);

    // 上下の小さな装甲
    ctx.strokeStyle = "#999";
    ctx.lineWidth = 1;

    ctx.beginPath();

    ctx.moveTo(enemy.x + 3, enemy.y + 2);
    ctx.lineTo(enemy.x + w - 3, enemy.y + 2);

    ctx.moveTo(enemy.x + 3, enemy.y + h - 2);
    ctx.lineTo(enemy.x + w - 3, enemy.y + h - 2);

    ctx.stroke();
  }

  // ==================================================
  // Boss
  // 巨大兵器
  // ==================================================
  else if (enemy.type === "boss") {
    const w = enemy.width;
    const h = enemy.height;

    // 外装
    ctx.fillStyle = "#5b1f75";

    ctx.beginPath();
    ctx.moveTo(enemy.x + 20, enemy.y);
    ctx.lineTo(enemy.x + w - 20, enemy.y);
    ctx.lineTo(enemy.x + w, enemy.y + 20);
    ctx.lineTo(enemy.x + w, enemy.y + h - 20);
    ctx.lineTo(enemy.x + w - 20, enemy.y + h);
    ctx.lineTo(enemy.x + 20, enemy.y + h);
    ctx.lineTo(enemy.x, enemy.y + h - 20);
    ctx.lineTo(enemy.x, enemy.y + 20);
    ctx.closePath();
    ctx.fill();

    // 外周装甲
    ctx.strokeStyle = "#c875ff";
    ctx.lineWidth = 4;
    ctx.stroke();

    // 内側装甲
    ctx.fillStyle = "#351445";

    ctx.beginPath();
    ctx.moveTo(cx, enemy.y + 15);
    ctx.lineTo(enemy.x + w - 15, cy);
    ctx.lineTo(cx, enemy.y + h - 15);
    ctx.lineTo(enemy.x + 15, cy);
    ctx.closePath();
    ctx.fill();

    // 十字装甲
    ctx.strokeStyle = "#7d3fa0";
    ctx.lineWidth = 5;

    ctx.beginPath();

    ctx.moveTo(cx, enemy.y + 15);
    ctx.lineTo(cx, enemy.y + h - 15);

    ctx.moveTo(enemy.x + 15, cy);
    ctx.lineTo(enemy.x + w - 15, cy);

    ctx.stroke();

    // 中央砲台
    ctx.fillStyle = "#171017";

    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#e09cff";
    ctx.lineWidth = 3;
    ctx.stroke();

    if (enemy.integratedLaser) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(enemy.integratedLaserAngle || 0);
      ctx.shadowColor = "#ff456f";
      ctx.shadowBlur = 10;
      ctx.strokeStyle = "#e34d72";
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(-38, 0); ctx.lineTo(-19, 0);
      ctx.moveTo(19, 0); ctx.lineTo(38, 0);
      ctx.moveTo(0, -38); ctx.lineTo(0, -19);
      ctx.moveTo(0, 19); ctx.lineTo(0, 38);
      ctx.stroke();
      ctx.fillStyle = "#ffb0bf";
      [[-40, 0], [40, 0], [0, -40], [0, 40]].forEach(([x, y]) => {
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      });
      ctx.fillStyle = "#ff365f";
      ctx.beginPath(); ctx.arc(0, 0, 10, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // 砲身
    ctx.fillStyle = "#242024";
    ctx.fillRect(cx - 7, enemy.y - 15, 14, 30);

    // 砲口
    ctx.fillStyle = "#080808";

    ctx.beginPath();
    ctx.arc(cx, enemy.y - 14, 7, 0, Math.PI * 2);
    ctx.fill();

    // 四隅の小型装甲
    ctx.fillStyle = "#8e49aa";

    ctx.fillRect(enemy.x + 8, enemy.y + 8, 10, 10);
    ctx.fillRect(enemy.x + w - 18, enemy.y + 8, 10, 10);
    ctx.fillRect(enemy.x + 8, enemy.y + h - 18, 10, 10);
    ctx.fillRect(enemy.x + w - 18, enemy.y + h - 18, 10, 10);
  }

  // ==================================================
  // HPバー
  // ==================================================

  if (enemy.damaged && enemy.type !== "boss") {
    const barWidth = enemy.type === "big" ? 52 : 40;
    const barHeight = 5;

    const barX = cx - barWidth / 2;
    const barY = enemy.y + enemy.height + 7;

    ctx.fillStyle = "rgba(3, 4, 6, 0.88)";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    const enemyMaxHp = Math.max(1, enemy.maxHp || enemy.hp);
    const enemyHpRatio = Math.max(0, Math.min(1, enemy.hp / enemyMaxHp));
    ctx.fillStyle = enemyHpRatio <= 0.25 ? "#d45a48" : "#ddd2bd";
    ctx.fillRect(barX, barY, barWidth * enemyHpRatio, barHeight);
    ctx.strokeStyle = "rgba(120,112,102,.65)";
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
  }

  // ==================================================
  // ボスHP
  // ==================================================

  if (enemy.type === "boss") {
    const boss = enemy;
    const barWidth = 420;
    const barHeight = 14;

    const barX = (canvas.width - barWidth) / 2;
    const barY = 20;

    // 外枠
    ctx.fillStyle = "rgba(4,3,7,.92)";
    ctx.fillRect(barX - 7, barY - 8, barWidth + 14, barHeight + 16);
    ctx.strokeStyle = "#78546f";
    ctx.lineWidth = 2;
    ctx.strokeRect(barX - 7, barY - 8, barWidth + 14, barHeight + 16);

    // 背景
    ctx.fillStyle = "#241d27";
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // HP
    const bossGradient = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
    bossGradient.addColorStop(0, "#641e35");
    bossGradient.addColorStop(1, "#c04462");
    ctx.fillStyle = bossGradient;
    const bossHpRatio = Math.max(0, Math.min(1, boss.hp / boss.maxHp));
    ctx.fillRect(barX, barY, barWidth * bossHpRatio, barHeight);

    // 名前
    ctx.fillStyle = "white";
    ctx.font = "bold 13px Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("塔の守護者", canvas.width / 2, barY - 12);
  }
}
// ==================================================
// キー入力
// ==================================================

// テキスト折り返しユーティリティ
function wrapText(context, text, x, y, maxWidth, lineHeight) {
  const words = text.split(" ");
  let line = "";

  for (let n = 0; n < words.length; n++) {
    const word = words[n];
    const tentative = line ? line + word : word;
    const testWidth = context.measureText(tentative + " ").width;

    if (testWidth > maxWidth) {
      if (line) {
        context.fillText(line.trim(), x, y);
        line = word + " ";
        y += lineHeight;
      } else {
        // 一語が長すぎる場合、文字単位で折り返し
        let sub = "";
        for (const char of word) {
          const next = sub + char;
          if (context.measureText(next).width > maxWidth) {
            context.fillText(sub, x, y);
            sub = char;
            y += lineHeight;
          } else {
            sub = next;
          }
        }
        line = sub + " ";
      }
    } else {
      line = tentative + " ";
    }
  }

  if (line.trim().length > 0) {
    context.fillText(line.trim(), x, y);
  }
}

document.addEventListener("keydown", function (event) {
  if (event.code !== "F5" && event.code !== "F11") {
    event.preventDefault();
  }

  console.log(event.code);

  if (event.code === "KeyD") {
    rightPressed = true;
  } else if (event.code === "KeyA") {
    leftPressed = true;
  } else if (event.code === "KeyW") {
    upPressed = true;
  } else if (event.code === "KeyS") {
    downPressed = true;
  } else if (event.code === "ShiftLeft") {
    shiftPressed = true;
  } else if (event.code === "KeyO") {
    player.hp = player.maxHp + 10000;
  } else if (
    event.code === "KeyQ" &&
    !event.repeat &&
    gameState === "playing" &&
    permanentUpgrades.autoAimUnlocked
  ) {
    permanentUpgrades.autoAimEnabled = !permanentUpgrades.autoAimEnabled;
    savePermanentUpgrades();
  } else if (event.code === "Space") {
    if (gameState === "playing") {
      spacePressed = true;
    }
  } else if (event.code === "KeyZ") {
    zPressed = true;
  } else if (event.code === "Escape") {
    if (gameState === "playing") {
      gameState = "paused";
    } else if (gameState === "paused") {
      gameState = "playing";
    }
  }

  // ==================================================
  // スタート
  // ==================================================

  if (event.code === "Space") {
    if (gameState === "start") {
      enterVillage();
    }
  }

  // ==================================================
  // リスタート
  // ==================================================

  if (event.code === "KeyR" && gameState === "gameover") {
    enterVillage();
  }
});

// ゲームオーバー時に銀行へ通貨を加算
function handleGameOverBanking() {
  const earn = Math.floor(score / 10);
  if (earn > 0) {
    bank += earn;
    localStorage.setItem("bank", bank);
  }
}

//マウス
canvas.addEventListener("mousedown", function (event) {
  if (event.button === 0) {
    mousePressed = true;
  }
});

canvas.addEventListener("mouseup", function (event) {
  if (event.button === 0) {
    mousePressed = false;
  }
});

// クリックでモーダル選択を処理（報酬画面など）
canvas.addEventListener("click", function (event) {
  updatePointerPosition(event);
  const mx = mouseX;
  const my = mouseY;

  if (gameState === "village") {
    // 魔具屋：購入後は自動射撃のON/OFF切り替え
    if (mx >= 40 && mx <= 265 && my >= 438 && my <= 563) {
      if (!permanentUpgrades.autoAimUnlocked) {
        if (bank >= autoAimUnlockCost) {
          bank -= autoAimUnlockCost;
          permanentUpgrades.autoAimUnlocked = true;
          permanentUpgrades.autoAimEnabled = true;
          localStorage.setItem("bank", bank);
        }
      } else {
        permanentUpgrades.autoAimEnabled = !permanentUpgrades.autoAimEnabled;
      }
      savePermanentUpgrades();
      return;
    }

    // 鍛冶屋：最大HPを永久に+1
    if (mx >= 285 && mx <= 510 && my >= 438 && my <= 563) {
      const hpCost = 20 + permanentUpgrades.hpLevel * 10;
      if (bank >= hpCost) {
        bank -= hpCost;
        permanentUpgrades.hpLevel++;
        localStorage.setItem("bank", bank);
        savePermanentUpgrades();
        applyPermanentUpgrades();
        player.hp = player.maxHp;
        displayedHp = player.hp;
      }
      return;
    }
    return;
  }

  if (gameState !== "bossReward") return;

  // ボタン配置に合わせる（draw() 側と整合）
  const modalX = canvas.width / 2 - 300;
  const modalY = canvas.height / 2 - 190;
  const modalW = 600;
  const modalH = 380;
  const cardW = 170;
  const cardH = 165;
  const cardSpacing = 18;

  // 選択肢カード 3つ
  for (let i = 0; i < bossOptions.length; i++) {
    const bx = modalX + 27 + i * (cardW + cardSpacing);
    const by = modalY + 116;
    const bw = cardW;
    const bh = cardH;

    if (mx >= bx && mx <= bx + bw && my >= by && my <= by + bh) {
      // 選択
      bossOptions[i].apply();
      bossOptions = [];
      bossExitUnlocked = false;
      items = [];
      waveClearTimer = 0;
      player.x = 50;
      player.y = canvas.height / 2 - player.height / 2;
      startNextWave();
      gameState = "playing";
      return;
    }
  }

  // リロールボタン
  const rx = modalX + modalW / 2 - 80;
  const ry = modalY + modalH - 67;
  const rw = 160;
  const rh = 40;

  if (mx >= rx && mx <= rx + rw && my >= ry && my <= ry + rh) {
    // リロール
    if (bossRerollsLeft > 0) {
      bossOptions = generateBossOptions();
      bossRerollsLeft--;
    } else if (bank >= bossRerollCost) {
      bank -= bossRerollCost;
      localStorage.setItem("bank", bank);
      bossOptions = generateBossOptions();
    }
  }
});

// ==================================================
// キーを離したとき
// ==================================================

document.addEventListener("keyup", function (event) {
  if (event.code === "KeyD") {
    rightPressed = false;
  } else if (event.code === "KeyA") {
    leftPressed = false;
  } else if (event.code === "KeyW") {
    upPressed = false;
  } else if (event.code === "KeyS") {
    downPressed = false;
  } else if (event.code === "ShiftLeft") {
    shiftPressed = false;
  } else if (event.code === "Space") {
    spacePressed = false;
  } else if (event.code === "KeyZ") {
    zPressed = false;
  }
});

// ==================================================
// スマホ・タブレット用タッチ操作
// ==================================================
const touchControls = document.getElementById("touchControls");
const touchStateSetters = {
  up: (value) => { upPressed = value; },
  down: (value) => { downPressed = value; },
  left: (value) => { leftPressed = value; },
  right: (value) => { rightPressed = value; },
  dash: (value) => { shiftPressed = value; },
  action: (value) => { zPressed = value; },
  fire: (value) => { mousePressed = value; },
};

if (touchControls) {
  touchControls.querySelectorAll("[data-key]").forEach((button) => {
    const key = button.dataset.key;

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      button.classList.add("active");

      if (key === "pause") {
        gameState = gameState === "playing" ? "paused" : gameState === "paused" ? "playing" : gameState;
      } else if (key === "fire" && gameState === "start") {
        enterVillage();
      } else if (key === "fire" && gameState === "gameover") {
        enterVillage();
      } else if (touchStateSetters[key]) {
        touchStateSetters[key](true);
      }
    });

    const release = (event) => {
      event.preventDefault();
      button.classList.remove("active");
      if (touchStateSetters[key]) touchStateSetters[key](false);
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
  });
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.pointerType !== "mouse" && gameState === "playing") {
    event.preventDefault();
    updatePointerPosition(event);
    mousePressed = true;
    canvas.setPointerCapture(event.pointerId);
  }
});
canvas.addEventListener("pointermove", (event) => {
  if (event.pointerType !== "mouse" && event.buttons) updatePointerPosition(event);
});
const releaseCanvasTouch = (event) => {
  if (event.pointerType !== "mouse") mousePressed = false;
};
canvas.addEventListener("pointerup", releaseCanvasTouch);
canvas.addEventListener("pointercancel", releaseCanvasTouch);

gameLoop();
