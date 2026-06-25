const socket = io();
const CLIENT_ID = localStorage.getItem('gameBoxClientId') || ('c' + Math.random().toString(36).substring(2, 10));
localStorage.setItem('gameBoxClientId', CLIENT_ID);

const canvas = document.getElementById('racing-canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;
const $ = id => document.getElementById(id);

const LANE_COUNT = 4;
const LANE_W = W / LANE_COUNT;
const CAR_W = LANE_W * 0.55;
const CAR_H = CAR_W * 1.6;
const PLAYER_COLOR = '#4d96ff';
const TEAMMATE_COLOR = '#ff9f43';
const ENEMY_COLORS = ['#ff4d6a', '#ff9f43', '#ffd93d', '#6bcb77', '#9b59b6', '#e84393'];
const ITEM_TYPES = ['speed', 'shield', 'slow'];

let mode = null; // 'local' | 'online'
let roomId = null;
let mySymbol = null;
let players = [];
let netState = null;

// Local game state
let localState = 'idle'; // idle | playing | paused | dead
let player, enemies, items, particles, roadOffset, score, speed, lives, frameCount, spawnTimer, itemSpawnTimer;
let effects = { speed: 0, shield: 0, slow: 0 };
let keys = {};
let touchDir = 0;
let bestScore = parseInt(localStorage.getItem('racingBest') || '0', 10);

$('hud-best').textContent = bestScore;

function getName() { return $('player-name').value.trim() || 'Player'; }

function showScreen(el) {
  $('lobby').classList.remove('active');
  $('game').classList.remove('active');
  el.classList.add('active');
}

function startMode(m) {
  mode = m;
  if (m === 'online') {
    $('online-panel').classList.remove('hidden');
  } else {
    mySymbol = null;
    netState = null;
    initLocal();
    $('online-status-bar').style.display = 'none';
    $('local-controls').classList.remove('hidden');
    $('online-controls').classList.add('hidden');
    showScreen($('game'));
  }
}

function showJoin() { $('join-form').classList.toggle('hidden'); }
function createRoom() {
  socket.emit('createRoom', { gameType: 'racing', playerName: getName(), clientId: CLIENT_ID, isPublic: $('room-public-check').checked });
}
function quickMatch() {
  socket.emit('quickMatch:join', { gameType: 'racing', playerName: getName(), clientId: CLIENT_ID });
}
function joinRoom() {
  const id = $('room-id').value.trim().toUpperCase();
  if (!id) return showError('请输入房间号');
  socket.emit('joinRoom', { roomId: id, playerName: getName(), clientId: CLIENT_ID });
}
function showError(msg) {
  $('error-msg').textContent = msg;
  $('error-msg').classList.remove('hidden');
  setTimeout(() => $('error-msg').classList.add('hidden'), 3000);
}

socket.on('roomCreated', data => {
  roomId = data.roomId;
  mySymbol = 1;
  mode = 'online';
  players = data.players || (data.player ? [data.player] : []);
  enterOnline();
});
socket.on('joinedRoom', data => {
  roomId = data.roomId;
  mySymbol = data.you ? data.you.symbol : 2;
  mode = 'online';
  players = data.players || [];
  if (data.state) netState = data.state;
  enterOnline();
});
socket.on('reconnected', data => {
  roomId = data.roomId;
  mySymbol = data.player ? data.player.symbol : 2;
  mode = 'online';
  players = data.players || [];
  if (data.state) netState = data.state;
  enterOnline();
});
socket.on('quickMatch:found', data => {
  roomId = data.roomId;
  mySymbol = data.you ? data.you.symbol : 1;
  mode = 'online';
  players = data.players || [];
  if (data.state) netState = data.state;
  enterOnline();
  showError('⚡ 匹配成功！');
});
socket.on('quickMatch:waiting', () => showError('⏳ 正在匹配对手…'));
socket.on('racing:state', ({ state, players: ps }) => {
  if (ps) players = ps;
  netState = state;
  updateOnlineUI();
});
socket.on('error', ({ message }) => showError(message));
socket.on('connect', () => { if (roomId) socket.emit('reconnect', { clientId: CLIENT_ID }); });
socket.on('reconnect:failed', () => { roomId = null; });

function enterOnline() {
  $('online-panel').classList.add('hidden');
  $('join-form').classList.add('hidden');
  $('copy-btn').classList.remove('hidden');
  $('room-display').textContent = roomId;
  $('local-controls').classList.add('hidden');
  $('online-controls').classList.remove('hidden');
  $('online-status-bar').style.display = 'block';
  updateBadges();
  updateOnlineUI();
  showScreen($('game'));
}

function updateBadges() {
  const p1 = players.find(p => p.symbol === 1);
  const p2 = players.find(p => p.symbol === 2);
  $('name-p1').textContent = (p1 ? p1.name : '等待…') + (mySymbol === 1 ? ' (你)' : '');
  $('name-p2').textContent = (p2 ? p2.name : '等待…') + (mySymbol === 2 ? ' (你)' : '');
}

function updateOnlineUI() {
  if (!netState) return;
  updateBadges();
  $('hud-score').textContent = netState.score || 0;
  $('hud-speed').textContent = Math.floor((netState.speed || 0) * 12);
  const mateSymbol = mySymbol === 1 ? 2 : 1;
  $('hud-lives').textContent = `${netState.lives[mySymbol]} | ${netState.lives[mateSymbol]}`;
  updateHudEffectsOnline();

  const statusEl = $('status-text');
  if (netState.status === 'waiting') statusEl.textContent = '等待对手加入或房主开始…';
  else if (netState.status === 'playing') statusEl.textContent = '比赛中！左右移动躲避车辆';
  else if (netState.status === 'ended') statusEl.textContent = '游戏结束';

  const overlay = $('start-overlay');
  if (netState.status === 'playing') overlay.classList.add('hidden');
  else overlay.classList.remove('hidden');

  const endModal = $('end-modal');
  if (netState.status === 'ended') {
    $('end-title').textContent = '💥 全员出局！';
    $('end-subtitle').textContent = `共同距离: ${netState.score}m · 速度: ${Math.floor((netState.speed || 0) * 12)}km/h`;
    endModal.classList.remove('hidden');
  } else {
    endModal.classList.add('hidden');
  }

  const startBtn = $('start-btn');
  if (mySymbol === 1 && netState.status === 'waiting' && players.length === 2) {
    startBtn.disabled = false;
    startBtn.textContent = '▶ 开始';
  } else {
    startBtn.disabled = true;
    if (mySymbol !== 1) startBtn.textContent = '等待房主开始';
    else if (players.length < 2) startBtn.textContent = '等待队友加入';
    else startBtn.textContent = '▶ 开始';
  }
}

function updateHudEffectsOnline() {
  const el = $('hud-effects');
  let html = '';
  const mateSymbol = mySymbol === 1 ? 2 : 1;
  const selfEf = netState.effects[mySymbol];
  const mateEf = netState.effects[mateSymbol];
  if (selfEf.speed > 0) html += '<span class="effect-icon" title="自己加速">⚡</span>';
  if (selfEf.shield > 0) html += '<span class="effect-icon" title="自己护盾">🛡️</span>';
  if (selfEf.slow > 0) html += '<span class="effect-icon" title="自己减速敌人">🐌</span>';
  if (mateEf.speed > 0) html += '<span class="effect-icon" title="队友加速" style="opacity:.7">⚡</span>';
  if (mateEf.shield > 0) html += '<span class="effect-icon" title="队友护盾" style="opacity:.7">🛡️</span>';
  if (mateEf.slow > 0) html += '<span class="effect-icon" title="队友减速敌人" style="opacity:.7">🐌</span>';
  el.innerHTML = html;
}

function copyLink() {
  if (!roomId) return;
  navigator.clipboard.writeText(`${location.origin}/games/racing.html?room=${roomId}`).then(() => {
    const btn = $('copy-btn');
    const old = btn.textContent;
    btn.textContent = '✅';
    setTimeout(() => btn.textContent = old, 1500);
  }).catch(() => showError('复制失败'));
}

function leaveGame() {
  socket.emit('leaveRoom');
  location.href = '/games/racing.html';
}

/* --- local game --- */
function initLocal() {
  resetLocalState();
  localState = 'idle';
}

function resetLocalState() {
  player = { x: W / 2, y: H - 120, w: CAR_W, h: CAR_H, lane: 1, tilt: 0, vx: 0 };
  enemies = [];
  items = [];
  particles = [];
  roadOffset = 0;
  score = 0;
  speed = 5;
  lives = 3;
  frameCount = 0;
  spawnTimer = 0;
  itemSpawnTimer = 0;
  effects = { speed: 0, shield: 0, slow: 0 };
  $('hud-lives').textContent = lives;
  $('hud-score').textContent = 0;
  $('hud-speed').textContent = 60;
  $('hud-effects').innerHTML = '';
}

function startGame() {
  if (mode === 'online') {
    if (mySymbol === 1 && netState && netState.status === 'waiting') {
      socket.emit('racing:start');
    }
    return;
  }
  $('end-modal').classList.add('hidden');
  $('start-overlay').classList.add('hidden');
  resetLocalState();
  localState = 'playing';
}
window.startGame = startGame;

function pauseGame() {
  if (mode !== 'local') return;
  if (localState === 'playing') localState = 'paused';
  else if (localState === 'paused') localState = 'playing';
}
window.pauseGame = pauseGame;

function closeEndModal() { $('end-modal').classList.add('hidden'); }
window.closeEndModal = closeEndModal;

function resetGame() {
  if (mode === 'online') {
    if (mySymbol === 1) socket.emit('racing:reset');
    return;
  }
  startGame();
}
window.resetGame = resetGame;
window.leaveGame = leaveGame;
window.copyLink = copyLink;
window.toggleMusic = function () { showError('音乐开关暂未接入'); };

function die() {
  localState = 'dead';
  enemies = [];
  if (score > bestScore) {
    bestScore = score;
    localStorage.setItem('racingBest', bestScore);
    $('hud-best').textContent = bestScore;
  }
  $('end-title').textContent = '💥 撞车了！';
  $('end-subtitle').textContent = `距离: ${score}m · 速度: ${Math.floor(speed * 12)}km/h`;
  $('end-modal').classList.remove('hidden');
}

/* --- input --- */
document.addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Space' && mode === 'local' && localState === 'idle') startGame();
  if (mode === 'online') sendInput();
});
document.addEventListener('keyup', e => {
  keys[e.code] = false;
  if (mode === 'online') sendInput();
});

$('start-overlay').addEventListener('click', () => {
  if (mode === 'local' && localState === 'idle') startGame();
  else if (mode === 'online' && mySymbol === 1 && netState && netState.status === 'waiting') startGame();
});

const btnL = $('btn-left');
const btnR = $('btn-right');
function touchOn(dir) {
  return e => {
    e.preventDefault();
    touchDir = dir;
    if (mode === 'online') sendInput();
  };
}
function touchOff() {
  touchDir = 0;
  if (mode === 'online') sendInput();
}
btnL.addEventListener('touchstart', touchOn(-1), { passive: false });
btnL.addEventListener('touchend', touchOff);
btnR.addEventListener('touchstart', touchOn(1), { passive: false });
btnR.addEventListener('touchend', touchOff);

let swipeX = null;
canvas.addEventListener('touchstart', e => {
  if (mode === 'local' && localState === 'idle') { startGame(); return; }
  swipeX = e.touches[0].clientX;
}, { passive: true });
canvas.addEventListener('touchmove', e => {
  if (swipeX === null) return;
  const dx = e.touches[0].clientX - swipeX;
  if (Math.abs(dx) > 12) {
    touchDir = dx > 0 ? 1 : -1;
    swipeX = e.touches[0].clientX;
    if (mode === 'online') sendInput();
  }
}, { passive: true });
canvas.addEventListener('touchend', () => {
  swipeX = null;
  touchDir = 0;
  if (mode === 'online') sendInput();
});

function sendInput() {
  if (mode !== 'online' || !netState || netState.status !== 'playing') return;
  let dir = 0;
  if (keys['ArrowLeft'] || keys['KeyA']) dir -= 1;
  if (keys['ArrowRight'] || keys['KeyD']) dir += 1;
  dir += touchDir;
  dir = Math.max(-1, Math.min(1, dir));
  socket.emit('racing:input', { dir });
}

/* --- helpers --- */
function laneCenter(lane) { return LANE_W * lane + LANE_W / 2; }

function rectsOverlap(a, b) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
}

function spawnEnemy() {
  const lane = Math.floor(Math.random() * LANE_COUNT);
  if (enemies.some(e => e.lane === lane && e.y < 80)) return;
  const color = ENEMY_COLORS[Math.floor(Math.random() * ENEMY_COLORS.length)];
  enemies.push({
    x: laneCenter(lane),
    y: -CAR_H,
    w: CAR_W * (0.85 + Math.random() * 0.3),
    h: CAR_H * (0.85 + Math.random() * 0.3),
    lane,
    color,
    vy: speed * (0.4 + Math.random() * 0.4)
  });
}

function spawnItem() {
  const lane = Math.floor(Math.random() * LANE_COUNT);
  const type = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
  items.push({
    x: laneCenter(lane),
    y: -40,
    w: 28, h: 28,
    lane, type,
    vy: speed * 0.25
  });
}

function applyEffect(type) {
  if (type === 'speed') effects.speed = 300;
  else if (type === 'shield') effects.shield = 1;
  else if (type === 'slow') effects.slow = 360;
}

function updateHudEffects() {
  const el = $('hud-effects');
  let html = '';
  if (effects.speed > 0) html += '<span class="effect-icon" title="加速">⚡</span>';
  if (effects.shield > 0) html += '<span class="effect-icon" title="护盾">🛡️</span>';
  if (effects.slow > 0) html += '<span class="effect-icon" title="减速敌人">🐌</span>';
  el.innerHTML = html;
}

function spawnParticles(x, y, color, count) {
  for (let i = 0; i < count; i++) {
    particles.push({
      x, y,
      vx: (Math.random() - 0.5) * 6,
      vy: (Math.random() - 0.5) * 6,
      life: 30 + Math.random() * 20,
      color,
      r: 2 + Math.random() * 3
    });
  }
}

/* --- draw --- */
function drawRoad(roadOffset) {
  ctx.fillStyle = '#2d2d44';
  ctx.fillRect(0, 0, W, H);

  const dashLen = 30, gapLen = 20;
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  for (let i = 1; i < LANE_COUNT; i++) {
    const x = LANE_W * i;
    ctx.setLineDash([dashLen, gapLen]);
    ctx.lineDashOffset = -roadOffset;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.strokeStyle = 'rgba(255,80,80,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(2, 0); ctx.lineTo(2, H);
  ctx.moveTo(W - 2, 0); ctx.lineTo(W - 2, H);
  ctx.stroke();
}

function drawCar(x, y, w, h, color, tilt, label) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt * 0.03);

  ctx.fillStyle = color;
  roundRect(-w / 2, -h / 2, w, h, 6);

  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  roundRect(-w * 0.35, -h * 0.3, w * 0.7, h * 0.25, 3);

  ctx.fillStyle = '#ff3333';
  ctx.fillRect(-w / 2 + 2, h / 2 - 4, 6, 3);
  ctx.fillRect(w / 2 - 8, h / 2 - 4, 6, 3);

  ctx.fillStyle = '#ffffcc';
  ctx.fillRect(-w / 2 + 2, -h / 2 + 1, 5, 3);
  ctx.fillRect(w / 2 - 7, -h / 2 + 1, 5, 3);

  if (label) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(label, 0, -h / 2 - 8);
  }

  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
}

function drawItem(it) {
  ctx.save();
  ctx.translate(it.x, it.y);
  const pulse = 1 + Math.sin(Date.now() * 0.005) * 0.1;
  ctx.scale(pulse, pulse);
  const glowColor = it.type === 'speed' ? '#ffea00' : it.type === 'shield' ? '#00e5ff' : '#00e676';
  const fillColor = it.type === 'speed' ? 'rgba(255,234,0,0.9)' : it.type === 'shield' ? 'rgba(0,229,255,0.9)' : 'rgba(0,230,118,0.9)';

  ctx.shadowColor = glowColor;
  ctx.shadowBlur = 28;
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.arc(0, 0, it.w / 2 + 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.beginPath();
  ctx.arc(-it.w * 0.12, -it.w * 0.12, it.w * 0.18, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(it.type === 'speed' ? '⚡' : it.type === 'shield' ? '🛡️' : '🐌', 0, 1);
  ctx.restore();
}

function drawParticles(particlesList) {
  for (const p of particlesList) {
    ctx.globalAlpha = Math.max(0, p.life / 50);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawSpeedLines(currentSpeed) {
  if (currentSpeed < 7) return;
  const alpha = Math.min((currentSpeed - 7) / 8, 0.25);
  ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const x = Math.random() * W;
    const y = Math.random() * H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + 15 + currentSpeed * 3);
    ctx.stroke();
  }
}

function drawShieldAura(car) {
  ctx.save();
  ctx.strokeStyle = `rgba(79,195,247,${0.5 + Math.sin(Date.now() * 0.005) * 0.2})`;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(car.x, car.y, car.w * 0.75, car.h * 0.6, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/* --- update --- */
function update() {
  if (mode === 'online' || localState !== 'playing') return;

  frameCount++;
  score = Math.floor(frameCount / 6);
  speed = 5 + score * 0.008;
  if (speed > 14) speed = 14;

  if (effects.speed > 0) effects.speed--;
  if (effects.slow > 0) effects.slow--;

  let effectiveSpeed = speed;
  if (effects.speed > 0) effectiveSpeed += 3.5;
  if (effects.slow > 0) effectiveSpeed *= 0.7;
  if (effectiveSpeed > 18) effectiveSpeed = 18;

  let dir = 0;
  if (keys['ArrowLeft'] || keys['KeyA']) dir -= 1;
  if (keys['ArrowRight'] || keys['KeyD']) dir += 1;
  dir += touchDir;
  dir = Math.max(-1, Math.min(1, dir));
  player.tilt = dir * 2;

  let moveSpeed = 6.5;
  if (effects.speed > 0) moveSpeed = 8.5;
  const targetVx = dir * moveSpeed;
  player.vx += (targetVx - player.vx) * 0.35;
  if (Math.abs(player.vx) < 0.05) player.vx = 0;
  player.x += player.vx;
  player.x = Math.max(player.w / 2 + 4, Math.min(W - player.w / 2 - 4, player.x));

  roadOffset = (roadOffset + effectiveSpeed) % 50;

  spawnTimer++;
  const spawnRate = Math.max(18, 50 - score * 0.08);
  if (spawnTimer >= spawnRate) {
    spawnEnemy();
    spawnTimer = 0;
  }

  itemSpawnTimer++;
  if (itemSpawnTimer >= 480 + Math.random() * 120) {
    spawnItem();
    itemSpawnTimer = 0;
  }

  const enemySpeedMul = effects.slow > 0 ? 0.45 : 1;

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.y += effectiveSpeed + e.vy * enemySpeedMul;
    if (e.y > H + 60) {
      enemies.splice(i, 1);
      continue;
    }
    if (rectsOverlap(player, e)) {
      if (effects.shield > 0) {
        effects.shield = 0;
        spawnParticles(e.x, e.y, '#4fc3f7', 15);
        enemies.splice(i, 1);
        continue;
      }
      spawnParticles(e.x, e.y, '#ff4444', 12);
      enemies.splice(i, 1);
      lives--;
      $('hud-lives').textContent = lives;
      if (lives <= 0) { die(); return; }
    }
  }

  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.y += effectiveSpeed * 0.35;
    if (it.y > H + 50) {
      items.splice(i, 1);
      continue;
    }
    if (rectsOverlap(player, it)) {
      applyEffect(it.type);
      const pColor = it.type === 'speed' ? '#ffeb3b' : it.type === 'shield' ? '#4fc3f7' : '#81c784';
      spawnParticles(it.x, it.y, pColor, 10);
      items.splice(i, 1);
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life--;
    if (p.life <= 0) particles.splice(i, 1);
  }

  if (dir !== 0 && frameCount % 4 === 0) {
    spawnParticles(
      player.x + (dir > 0 ? -player.w / 3 : player.w / 3),
      player.y + player.h / 2,
      'rgba(180,180,180,0.6)',
      1
    );
  }

  updateHudEffects();
  $('hud-score').textContent = score;
  $('hud-speed').textContent = Math.floor(effectiveSpeed * 12);
}

/* --- render --- */
function render() {
  ctx.clearRect(0, 0, W, H);
  if (mode === 'online') renderOnline();
  else renderLocal();
}

function renderLocal() {
  drawRoad(roadOffset);
  drawSpeedLines(speed);
  for (const e of enemies) drawCar(e.x, e.y, e.w, e.h, e.color, 0);
  for (const it of items) drawItem(it);

  if (effects.shield > 0) drawShieldAura(player);
  drawCar(player.x, player.y, player.w, player.h, PLAYER_COLOR, player.tilt);
  drawParticles(particles);
}

function renderOnline() {
  if (!netState) {
    drawRoad(0);
    return;
  }
  const s = netState;
  drawRoad(s.roadOffset);
  drawSpeedLines(s.speed);
  for (const e of s.enemies) drawCar(e.x, e.y, e.w, e.h, e.color, 0);
  for (const it of s.items) drawItem(it);

  [1, 2].forEach(sym => {
    const car = s.cars[sym];
    if (!car || car.y > H + 100) return;
    const isOwn = sym === mySymbol;
    if (s.effects[sym].shield > 0) drawShieldAura(car);
    drawCar(car.x, car.y, car.w, car.h, isOwn ? PLAYER_COLOR : TEAMMATE_COLOR, car.tilt, isOwn ? '你' : '队友');
  });

  drawParticles(s.particles);
}

function loop() {
  update();
  render();
  requestAnimationFrame(loop);
}

initLocal();
loop();

window.addEventListener('DOMContentLoaded', () => {
  $('player-name').value = getDefaultName() || '';
  const code = new URLSearchParams(location.search).get('room');
  if (code) {
    $('room-id').value = code;
    $('online-panel').classList.remove('hidden');
    $('join-form').classList.remove('hidden');
    joinRoom();
  }
});


/* === 8-bit Music === */
(function () {
  let audioCtx, musicOn = true, playing = false, intervalId = null;
  const NOTES = { C4: 262, D4: 294, E4: 330, F4: 349, G4: 392, A4: 440, B4: 494, C5: 523, D5: 587, E5: 659, F5: 698, G5: 784 };
  const { C4, D4, E4, F4, G4, A4, B4, C5, D5, E5, F5, G5 } = NOTES;
  const melody = [
    [E4, .12], [G4, .12], [C5, .12], [E5, .12], [D5, .12], [C5, .12], [G4, .12], [E4, .12],
    [F4, .12], [A4, .12], [D5, .12], [F5, .12], [E5, .12], [D5, .12], [A4, .12], [F4, .12],
    [G4, .12], [B4, .12], [E5, .12], [G5, .12], [F5, .12], [E5, .12], [B4, .12], [G4, .12],
    [C5, .12], [E5, .12], [G5, .12], [E5, .12], [C5, .12], [G4, .12], [E4, .12], [C4, .12]
  ];
  let pos = 0;
  function playNote(freq, dur) {
    if (!audioCtx) return;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur * 0.9);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + dur);
  }
  function step() {
    if (!musicOn || !playing) return;
    const [n, d] = melody[pos % melody.length];
    playNote(n, d * 0.95);
    pos++;
  }
  function startMusic() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    if (!playing) { playing = true; pos = 0; intervalId = setInterval(step, 130); }
  }
  window.toggleMusic = function () {
    musicOn = !musicOn;
    if (!musicOn && playing) {
      playing = false;
      clearInterval(intervalId);
      intervalId = null;
      if (audioCtx && audioCtx.state === 'running') audioCtx.suspend();
    } else if (musicOn && !playing) {
      startMusic();
    }
    return musicOn;
  };
  window.addEventListener('gameBoxStart', startMusic);
  ['click', 'keydown', 'touchstart'].forEach(evt => document.addEventListener(evt, startMusic, { once: true }));
})();
