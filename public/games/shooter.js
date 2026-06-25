const socket = io();
const CLIENT_ID = localStorage.getItem('gameBoxClientId') || ('c' + Math.random().toString(36).substring(2, 10));
localStorage.setItem('gameBoxClientId', CLIENT_ID);
const canvas = document.getElementById('shooter-canvas');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const $ = id => document.getElementById(id);

let mode = 'local'; // 'local' | 'online'
let roomId = null;
let mySymbol = 1;
let isHost = true;
let playersList = [];
let gameState = 'idle'; // idle, playing, paused, dead

let players = {}; // symbol -> player object
let bullets = [], enemyBullets = [], enemies = [], particles = [], powerups = [], coins = [];
let score = 0, lives = 0, wave = 1, timer = 0, bossActive = false;
let best = +localStorage.getItem('shooterBest') || 0;
let totalCoins = +localStorage.getItem('shooterCoins') || 0;
let selectedPlaneId = +localStorage.getItem('shooterPlane') || 0;
let unlockedPlanes = new Set(JSON.parse(localStorage.getItem('shooterUnlocked') || '[0]'));

const MAX_LIVES = 5;
const POWERUPS = {
  speed: { color: '#00e5ff', emoji: '⚡', label: '速' },
  shield: { color: '#4dff88', emoji: '🛡️', label: '盾' },
  spread: { color: '#ff9ef0', emoji: '🌸', label: '散' },
  heal: { color: '#ff6b6b', emoji: '❤️', label: '疗' }
};

const PLANES = [
  { id: 0, name: '突击机', emoji: '🚀', cost: 0, fireInterval: 10, speed: 4.5, bulletSpeed: 7.5, spread: false, color: '#4d96ff' },
  { id: 1, name: '重装机', emoji: '🛩️', cost: 200, fireInterval: 12, speed: 4.2, bulletSpeed: 6.5, spread: false, color: '#ff9f43', hpBonus: 1 },
  { id: 2, name: '散弹机', emoji: '✈️', cost: 450, fireInterval: 12, speed: 4, bulletSpeed: 7, spread: true, color: '#ff6b9d' },
  { id: 3, name: '疾风机', emoji: '🛸', cost: 800, fireInterval: 7, speed: 6, bulletSpeed: 8.5, spread: false, color: '#00d2d3' },
  { id: 4, name: '毁灭机', emoji: '🚀', cost: 1500, fireInterval: 9, speed: 4.8, bulletSpeed: 8, spread: true, color: '#a55eea', hpBonus: 1 }
];

function makePlayer(symbol, planeId, x, y) {
  const p = PLANES[planeId] || PLANES[0];
  return { x, y, w: 28, h: 28, effects: { speed: 0, shield: 0, spread: 0 }, plane: p, planeId: p.id, symbol, invuln: 0, netX: null, netY: null };
}

function setPlayerPlane(symbol, planeId) {
  const pl = players[symbol];
  if (!pl) return;
  const p = PLANES[planeId] || PLANES[0];
  pl.plane = p; pl.planeId = p.id;
}

function getName() { return ($('player-name')?.value || '').trim() || (window.getDefaultName ? window.getDefaultName() : 'Player') || 'Player'; }

function showScreen(el) {
  $('lobby').classList.remove('active');
  $('game').classList.remove('active');
  el.classList.add('active');
}
function showError(msg) { $('error-msg').textContent = msg; $('error-msg').classList.remove('hidden'); setTimeout(() => $('error-msg').classList.add('hidden'), 3000); }
function showJoin() { $('join-form').classList.toggle('hidden'); }

function startMode(m) {
  mode = m;
  if (m === 'online') { $('online-panel').classList.remove('hidden'); }
  else {
    mySymbol = 1; isHost = true; roomId = null; playersList = [];
    $('room-display').textContent = '单机';
    $('copy-btn').classList.add('hidden');
    $('local-controls').classList.remove('hidden');
    $('host-start-btn').style.display = 'none';
    $('overlay-subtitle').textContent = '消灭外星飞船，保卫银河系！';
    $('overlay-hint').textContent = '点击 / 按空格开始';
    renderShop(); updateBadges(); updateStatus();
    showScreen($('game'));
  }
}

function createRoom() {
  socket.emit('createRoom', { gameType: 'shooter', playerName: getName(), clientId: CLIENT_ID, isPublic: $('room-public-check').checked });
}
function quickMatch() {
  socket.emit('quickMatch:join', { gameType: 'shooter', playerName: getName(), clientId: CLIENT_ID });
}
function joinRoom() {
  const id = $('room-id').value.trim().toUpperCase();
  if (!id) return showError('请输入房间号');
  socket.emit('joinRoom', { roomId: id, playerName: getName(), clientId: CLIENT_ID });
}
function copyLink() {
  if (!roomId) return;
  const url = `${location.origin}/games/shooter.html?room=${roomId}`;
  navigator.clipboard.writeText(url).then(() => { const b = $('copy-btn'); const old = b.textContent; b.textContent = '✅'; setTimeout(() => b.textContent = old, 1500); });
}
function leaveGame() { socket.emit('leaveRoom'); location.href = '/games/shooter.html'; }

socket.on('roomCreated', (data) => {
  roomId = data.roomId; mySymbol = data.player.symbol; isHost = true; playersList = data.players || [];
  const hint = $('room-privacy-hint'); if (hint) hint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  enterOnline();
});
socket.on('joinedRoom', (data) => {
  roomId = data.roomId; mySymbol = data.you ? data.you.symbol : 2; isHost = mySymbol === 1; playersList = data.players || [];
  const hint = $('room-privacy-hint'); if (hint) hint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  enterOnline();
});
socket.on('quickMatch:found', (data) => {
  roomId = data.roomId; mySymbol = data.you ? data.you.symbol : 1; isHost = mySymbol === 1; playersList = data.players || [];
  enterOnline(); showError('⚡ 匹配成功！');
});
socket.on('joinedAsSpectator', () => { showError('暂不支持观战模式'); });
socket.on('reconnected', (data) => {
  roomId = data.roomId; mySymbol = data.player ? data.player.symbol : 1; isHost = mySymbol === 1; playersList = data.players || [];
  enterOnline();
});
socket.on('shooter:sync', (data) => { if (mode === 'online' && !isHost) applySnapshot(data); });
socket.on('shooter:start', () => { if (mode === 'online' && !isHost) startGamePeer(); });
socket.on('shooter:restartWave', () => { if (mode === 'online' && !isHost) restartWavePeer(); });
socket.on('shooter:plane', (data) => { if (mode === 'online' && isHost && data.planeId != null && players[2]) setPlayerPlane(2, data.planeId); });
socket.on('shooter:input', (data) => {
  if (mode === 'online' && isHost && players[data.fromSymbol]) {
    players[data.fromSymbol].netX = data.x; players[data.fromSymbol].netY = data.y;
  }
});
socket.on('chat:message', () => {});
socket.on('error', ({ message }) => showError(message));
socket.on('connect', () => { if (roomId) socket.emit('reconnect', { clientId: CLIENT_ID }); });
socket.on('reconnect:failed', () => { roomId = null; showError('重连失败'); });

function enterOnline() {
  $('lobby').classList.remove('active');
  $('online-panel').classList.add('hidden');
  $('join-form').classList.add('hidden');
  $('copy-btn').classList.remove('hidden');
  $('room-display').textContent = roomId;
  $('local-controls').classList.add('hidden');
  $('room-display').textContent = roomId;
  if (isHost) {
    $('host-start-btn').style.display = 'block';
    $('overlay-hint').textContent = '你是房主，选好战机后点击开始';
  } else {
    $('host-start-btn').style.display = 'none';
    $('overlay-hint').textContent = '等待房主开始游戏...';
  }
  renderShop(); updateBadges(); updateStatus(); showScreen($('game'));
}

function updateBadges() {
  const p1 = playersList.find(p => p.symbol === 1), p2 = playersList.find(p => p.symbol === 2);
  const n1 = mode === 'local' ? '玩家1' : (p1 ? p1.name : '等待...');
  const n2 = mode === 'local' ? '未加入' : (p2 ? p2.name : '等待...');
  $('name-p1').textContent = n1 + (mySymbol === 1 ? ' (你)' : '');
  $('name-p2').textContent = n2 + (mySymbol === 2 ? ' (你)' : '');
  $('badge-p1').classList.toggle('active', mySymbol === 1);
  $('badge-p2').classList.toggle('active', mySymbol === 2);
}

function updateStatus() {
  const t = $('status-text');
  if (mode === 'local') {
    if (gameState === 'idle') t.textContent = '点击开始或按空格';
    else if (gameState === 'paused') t.textContent = '已暂停';
    else if (gameState === 'dead') t.textContent = '游戏结束';
    else t.textContent = '战斗中';
    return;
  }
  if (playersList.length < 2) t.textContent = '等待对手加入...';
  else if (gameState === 'dead') t.textContent = '游戏结束';
  else if (gameState === 'playing') t.textContent = '联机战斗中';
  else if (isHost) t.textContent = '你是房主，点击开始游戏';
  else t.textContent = '等待房主开始...';
}

function renderShop() {
  $('shop-coins').textContent = totalCoins;
  $('hud-coins').textContent = totalCoins;
  const box = $('plane-select');
  box.innerHTML = '';
  for (const p of PLANES) {
    const isUnlocked = unlockedPlanes.has(p.id);
    const isSelected = selectedPlaneId === p.id;
    const card = document.createElement('div');
    card.className = 'plane-card' + (isSelected ? ' selected' : '') + (isUnlocked ? '' : ' locked');
    card.innerHTML = '<div class="icon">' + p.emoji + '</div><div class="name">' + p.name + '</div><div class="cost">' + (isUnlocked ? (isSelected ? '已选' : '已解锁') : '🪙' + p.cost) + '</div>';
    card.onclick = () => selectPlane(p.id);
    box.appendChild(card);
  }
}
window.selectPlane = function (id) {
  if (unlockedPlanes.has(id)) {
    selectedPlaneId = id; localStorage.setItem('shooterPlane', id); renderShop();
    if (mode === 'online') socket.emit('shooter:plane', { planeId: id });
    return;
  }
  const p = PLANES[id];
  if (totalCoins >= p.cost) {
    totalCoins -= p.cost; unlockedPlanes.add(id); selectedPlaneId = id;
    localStorage.setItem('shooterCoins', totalCoins);
    localStorage.setItem('shooterUnlocked', JSON.stringify([...unlockedPlanes]));
    localStorage.setItem('shooterPlane', id); renderShop();
    if (mode === 'online') socket.emit('shooter:plane', { planeId: id });
  } else { alert('金币不足，需要 ' + p.cost + ' 🪙'); }
};
renderShop();

async function loadLeaderboard() {
  const el = $('leaderboard-list');
  if (!el) return;
  el.textContent = '加载中...';
  try {
    const data = await Auth.getLeaderboard('shooter', 10);
    const list = (data && (data.list || data.leaderboard)) || [];
    if (!list.length) { el.innerHTML = '<div style="color:#aaa;">暂无记录</div>'; return; }
    el.innerHTML = list.map((e, i) => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><span>${i+1}. ${escapeHtml(e.name)}</span><span>${e.score}</span></div>`).join('');
  } catch (e) { el.textContent = '加载失败'; }
}
function escapeHtml(t) { return String(t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

function getMaxLives() {
  let bonus = 0;
  for (const sym in players) bonus = Math.max(bonus, players[sym].plane.hpBonus || 0);
  return Math.min(MAX_LIVES, 3 + bonus);
}

function reset(full = true) {
  players = {};
  if (mode === 'online') {
    players[1] = makePlayer(1, selectedPlaneId, W * 0.35, H - 80);
    players[2] = makePlayer(2, selectedPlaneId, W * 0.65, H - 80);
  } else {
    players[1] = makePlayer(1, selectedPlaneId, W / 2, H - 80);
  }
  bullets = []; enemyBullets = []; enemies = []; particles = []; powerups = []; coins = [];
  if (full) { score = 0; wave = 1; }
  lives = getMaxLives();
  timer = 0; bossActive = false;
  for (const sym in players) { players[sym].effects = { speed: 0, shield: 0, spread: 0 }; players[sym].invuln = 0; }
  spawnWave();
  updateHud(); renderShop();
}

function resetForWave() {
  bullets = []; enemyBullets = []; enemies = []; particles = []; powerups = []; coins = [];
  lives = getMaxLives(); timer = 0; bossActive = false;
  const positions = mode === 'online' ? { 1: W * 0.35, 2: W * 0.65 } : { 1: W / 2 };
  for (const sym in players) {
    const pl = players[sym]; pl.x = positions[sym]; pl.y = H - 80;
    pl.effects = { speed: 0, shield: 0, spread: 0 }; pl.invuln = 90;
  }
  spawnWave();
  updateHud();
}

function isBossWave() { return wave % 5 === 0; }

function spawnWave() {
  if (isBossWave()) { spawnBoss(); return; }
  const count = 4 + Math.floor(Math.random() * 3) + Math.floor((wave - 1) / 3);
  const pool = ['snake', 'wave', 'dash', 'side'];
  if (wave >= 3) { pool.push('tank', 'zigzag'); }
  if (wave >= 5) pool.push('seeker');
  if (wave >= 7) pool.push('bomber', 'splitter');
  for (let i = 0; i < count; i++) {
    const type = pool[Math.floor(Math.random() * pool.length)];
    enemies.push(makeEnemy(type, wave));
  }
}

function makeEnemy(type, waveNum, opts = {}) {
  const base = { x: 0, y: 0, w: opts.w || 24, h: opts.h || 20, type, timer: 0, phase: 0, invulnHit: 0, color: opts.color || '#ffd93d', splits: !!opts.splits };
  const hpScale = 1 + (waveNum - 1) * 0.12;
  switch (type) {
    case 'snake':
      base.hp = Math.max(1, Math.floor(1.2 * hpScale));
      base.x = W / 2 + (Math.random() - 0.5) * W * 0.6; base.y = -30;
      base.vx = (Math.random() < 0.5 ? 1 : -1) * (1.2 + Math.random() * 0.8); base.vy = 1.2 + waveNum * 0.08;
      base.amp = 40 + Math.random() * 30; base.freq = 0.04 + Math.random() * 0.02; break;
    case 'wave':
      base.hp = Math.max(1, Math.floor(1.0 * hpScale));
      base.x = W / 2 + (Math.random() - 0.5) * W * 0.7; base.y = -30;
      base.vx = 0; base.vy = 1 + waveNum * 0.07; base.amp = 50 + Math.random() * 40; base.freq = 0.05 + Math.random() * 0.03; base.cx = base.x; break;
    case 'dash':
      base.hp = Math.max(1, Math.floor(0.8 * hpScale) + 1);
      base.x = 20 + Math.random() * (W - 40); base.y = -40;
      base.vx = (Math.random() - 0.5); base.vy = 2.8 + waveNum * 0.15; base.color = '#ff4d6a'; break;
    case 'side':
      base.hp = Math.max(1, Math.floor(0.9 * hpScale));
      base.y = 40 + Math.random() * (H * 0.35); base.x = Math.random() < 0.5 ? -30 : W + 30;
      base.vx = (base.x < 0 ? 1 : -1) * (1.5 + waveNum * 0.1); base.vy = 0.6 + Math.random() * 0.6; base.color = '#6bcb77'; break;
    case 'tank':
      base.w = 32; base.h = 28; base.hp = Math.max(2, Math.floor(2.0 * hpScale) + 2);
      base.x = 30 + Math.random() * (W - 60); base.y = -50;
      base.vx = 0; base.vy = 0.8 + waveNum * 0.04; base.color = '#b0b0b0'; break;
    case 'zigzag':
      base.hp = Math.max(1, Math.floor(0.9 * hpScale));
      base.x = 30 + Math.random() * (W - 60); base.y = -35;
      base.vx = (Math.random() < 0.5 ? 1 : -1) * (2 + Math.random() * 0.8); base.vy = 1.6 + waveNum * 0.1;
      base.color = '#a55eea'; break;
    case 'seeker':
      base.hp = Math.max(1, Math.floor(1.0 * hpScale));
      base.x = 20 + Math.random() * (W - 40); base.y = -35;
      base.vx = 0; base.vy = 1 + waveNum * 0.07; base.color = '#ff9f43'; break;
    case 'bomber':
      base.hp = Math.max(1, Math.floor(1.1 * hpScale));
      base.x = 30 + Math.random() * (W - 60); base.y = -40;
      base.vx = (Math.random() - 0.5) * 0.6; base.vy = 1.3 + waveNum * 0.08; base.color = '#2ed573'; break;
    case 'splitter':
      base.w = 28; base.h = 24; base.hp = Math.max(1, Math.floor(1.3 * hpScale));
      base.x = 30 + Math.random() * (W - 60); base.y = -45;
      base.vx = (Math.random() - 0.5); base.vy = 1.5 + waveNum * 0.09; base.color = '#ff6b9d'; base.splits = true; break;
    case 'splitterChild':
      base.w = 16; base.h = 14; base.hp = Math.max(1, Math.floor(0.5 * hpScale));
      base.vy = 3 + waveNum * 0.12; base.color = '#ff6b9d'; base.splits = false; break;
    default:
      base.x = W / 2; base.y = -30; base.vx = 0; base.vy = 1;
  }
  base.maxHp = base.hp;
  return base;
}

const BOSS_TYPES = [
  { type: 'boss', color: '#ff0055', w: 110, h: 85, hpMul: 1, speed: 1.4, attackCooldown: 90 },
  { type: 'bossRapid', color: '#ff9100', w: 95, h: 75, hpMul: 0.85, speed: 2.2, attackCooldown: 55 },
  { type: 'bossSpread', color: '#9b59b6', w: 125, h: 95, hpMul: 1.15, speed: 1.0, attackCooldown: 110 },
  { type: 'bossSummoner', color: '#00d2d3', w: 105, h: 80, hpMul: 0.95, speed: 1.3, attackCooldown: 85 }
];

function spawnBoss() {
  bossActive = true;
  const tier = Math.floor(wave / 5);
  const template = BOSS_TYPES[tier % BOSS_TYPES.length];
  const hp = Math.floor((100 + tier * 55) * template.hpMul);
  enemies.push({
    x: W / 2, y: -90, w: template.w, h: template.h, hp, maxHp: hp, type: template.type, timer: 0, phase: 0,
    color: template.color, vx: template.speed + tier * 0.12, vy: 0.9,
    attackCooldown: template.attackCooldown, attackPattern: 0, entered: false, minionCooldown: 260
  });
}

function updateHud() {
  $('hud-score').textContent = score;
  $('hud-lives').textContent = lives;
  $('hud-wave').textContent = wave;
  $('hud-coins').textContent = totalCoins;
  $('hud-best').textContent = best;
}

window.startGame = function () {
  if (mode === 'online' && !isHost) return;
  $('end-modal').classList.add('hidden'); $('start-overlay').classList.add('hidden');
  reset(true); gameState = 'playing'; updateStatus();
};
window.hostStartGame = function () {
  if (mode !== 'online' || !isHost) return;
  reset(true); gameState = 'playing'; $('start-overlay').classList.add('hidden'); updateStatus();
  socket.emit('shooter:start', {});
};
function startGamePeer() {
  if (mode !== 'online' || isHost) return;
  reset(true); gameState = 'playing'; $('start-overlay').classList.add('hidden'); updateStatus();
  socket.emit('shooter:plane', { planeId: selectedPlaneId });
}
window.pauseGame = function () {
  if (mode === 'online') return;
  if (gameState === 'playing') gameState = 'paused'; else if (gameState === 'paused') gameState = 'playing'; updateStatus();
};

$('start-overlay').addEventListener('click', e => {
  if (e.target.closest('.plane-select') || e.target.closest('.plane-card') || e.target.closest('#host-start-btn')) return;
  if (mode === 'local' && gameState === 'idle') window.startGame();
});

let keys = {};
document.addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Space' && mode === 'local' && gameState === 'idle') window.startGame(); });
document.addEventListener('keyup', e => { keys[e.code] = false; });

let touchDir = { x: 0, y: 0 };
const bL = $('btn-left'), bR = $('btn-right'), bU = $('btn-up'), bD = $('btn-down');
function setTouchBtn(btn, dx, dy, on) {
  if (!btn) return;
  if (on) { touchDir.x += dx; touchDir.y += dy; } else { touchDir.x -= dx; touchDir.y -= dy; }
}
if (bL) { bL.addEventListener('touchstart', e => { e.preventDefault(); setTouchBtn(bL, -1, 0, true); }, { passive: false }); bL.addEventListener('touchend', () => setTouchBtn(bL, -1, 0, false)); }
if (bR) { bR.addEventListener('touchstart', e => { e.preventDefault(); setTouchBtn(bR, 1, 0, true); }, { passive: false }); bR.addEventListener('touchend', () => setTouchBtn(bR, 1, 0, false)); }
if (bU) { bU.addEventListener('touchstart', e => { e.preventDefault(); setTouchBtn(bU, 0, -1, true); }, { passive: false }); bU.addEventListener('touchend', () => setTouchBtn(bU, 0, -1, false)); }
if (bD) { bD.addEventListener('touchstart', e => { e.preventDefault(); setTouchBtn(bD, 0, 1, true); }, { passive: false }); bD.addEventListener('touchend', () => setTouchBtn(bD, 0, 1, false)); }

let isDragging = false;
let pointerTarget = null;
let pointerActive = false;
function pointerToCanvas(evt) {
  const rect = canvas.getBoundingClientRect();
  const clientX = evt.touches && evt.touches.length ? evt.touches[0].clientX : evt.clientX;
  const clientY = evt.touches && evt.touches.length ? evt.touches[0].clientY : evt.clientY;
  return { x: (clientX - rect.left) * (W / rect.width), y: (clientY - rect.top) * (H / rect.height) };
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function startPointer(e) {
  const p = pointerToCanvas(e);
  pointerActive = true;
  pointerTarget = { x: p.x, y: p.y };
}
function movePointer(e) {
  if (!pointerActive) return;
  const p = pointerToCanvas(e);
  pointerTarget = { x: p.x, y: p.y };
}
function endPointer() { pointerActive = false; }
canvas.addEventListener('mousedown', e => { isDragging = true; startPointer(e); });
canvas.addEventListener('mousemove', e => { if (isDragging) movePointer(e); });
window.addEventListener('mouseup', () => { isDragging = false; endPointer(); });
canvas.addEventListener('touchstart', e => { e.preventDefault(); isDragging = true; startPointer(e); }, { passive: false });
canvas.addEventListener('touchmove', e => { e.preventDefault(); if (isDragging) movePointer(e); }, { passive: false });
canvas.addEventListener('touchend', () => { isDragging = false; endPointer(); });

function moveOwnPlayer() {
  const pl = players[mySymbol]; if (!pl) return;
  const speed = pl.plane.speed * (pl.effects.speed > 0 ? 1.35 : 1);
  if (pointerTarget) {
    const dx = pointerTarget.x - pl.x;
    const dy = pointerTarget.y - pl.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= speed) {
      pl.x = pointerTarget.x; pl.y = pointerTarget.y;
      if (!pointerActive) pointerTarget = null;
    } else {
      pl.x += (dx / dist) * speed;
      pl.y += (dy / dist) * speed;
    }
  } else {
    let dx = 0, dy = 0;
    if (keys.ArrowLeft || keys.KeyA || touchDir.x < 0) dx = -1;
    if (keys.ArrowRight || keys.KeyD || touchDir.x > 0) dx = 1;
    if (keys.ArrowUp || keys.KeyW || touchDir.y < 0) dy = -1;
    if (keys.ArrowDown || keys.KeyS || touchDir.y > 0) dy = 1;
    if (dx || dy) { const len = Math.hypot(dx, dy) || 1; pl.x += (dx / len) * speed; pl.y += (dy / len) * speed; }
  }
  pl.x = clamp(pl.x, pl.w / 2, W - pl.w / 2); pl.y = clamp(pl.y, pl.h / 2, H - pl.h / 2);
}

function moveRemotePlayer() {
  const pl = players[2]; if (!pl || pl.netX == null) return;
  pl.x += (pl.netX - pl.x) * 0.4; pl.y += (pl.netY - pl.y) * 0.4;
}

function firePlayers() {
  for (const sym in players) {
    const pl = players[sym];
    const interval = pl.effects.speed > 0 ? Math.max(3, Math.floor(pl.plane.fireInterval * 0.65)) : pl.plane.fireInterval;
    if (timer % interval === 0) {
      const spread = pl.effects.spread > 0 || pl.plane.spread;
      const bs = pl.plane.bulletSpeed * (pl.effects.speed > 0 ? 1.15 : 1);
      bullets.push({ x: pl.x, y: pl.y - pl.h / 2, vy: -bs, vx: 0, fromSymbol: pl.symbol });
      if (spread) {
        bullets.push({ x: pl.x, y: pl.y - pl.h / 2, vy: -bs * 0.92, vx: -1.6, fromSymbol: pl.symbol });
        bullets.push({ x: pl.x, y: pl.y - pl.h / 2, vy: -bs * 0.92, vx: 1.6, fromSymbol: pl.symbol });
      }
    }
  }
}

function updateBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]; b.y += b.vy; b.x += b.vx || 0;
    if (b.y < -10 || b.x < -10 || b.x > W + 10) bullets.splice(i, 1);
  }
}

function nearestPlayer(x, y) {
  let best = null, bestD = Infinity;
  for (const sym in players) {
    const pl = players[sym]; const d = Math.hypot(pl.x - x, pl.y - y);
    if (d < bestD) { bestD = d; best = pl; }
  }
  return best;
}

function moveEnemy(e) {
  switch (e.type) {
    case 'snake': e.x += e.vx; if (e.x < e.w / 2 + 10 || e.x > W - e.w / 2 - 10) e.vx *= -1; e.y += e.vy; break;
    case 'wave': e.x = e.cx + Math.sin(e.timer * e.freq) * e.amp; e.y += e.vy; break;
    case 'dash': e.y += e.vy; e.x += Math.sin(e.timer * 0.03) * 0.8; break;
    case 'side': e.x += e.vx; e.y += e.vy + Math.sin(e.timer * 0.04) * 0.5; break;
    case 'tank': e.y += e.vy; break;
    case 'zigzag':
      e.x += e.vx; if (e.x < e.w / 2 + 8 || e.x > W - e.w / 2 - 8) e.vx *= -1;
      e.y += e.vy; break;
    case 'seeker': {
      const target = nearestPlayer(e.x, e.y);
      if (target) { const dir = target.x > e.x ? 1 : -1; e.x += dir * (0.8 + wave * 0.03); }
      e.y += e.vy; break;
    }
    case 'bomber': e.x += e.vx; e.y += e.vy; break;
    case 'splitter': e.y += e.vy; e.x += Math.sin(e.timer * 0.04) * 0.6; break;
    case 'splitterChild': e.y += e.vy; break;
    case 'boss':
    case 'bossRapid':
    case 'bossSpread':
    case 'bossSummoner':
      if (!e.entered) { e.y += e.vy; if (e.y >= 130) { e.entered = true; e.y = 130; } }
      else { e.x += e.vx; if (e.x < e.w / 2 + 10 || e.x > W - e.w / 2 - 10) e.vx *= -1; e.y = 130 + Math.sin(timer * 0.015) * 25; }
      break;
  }
}

function killBoss(e, i) {
  score += 100;
  spawnParticles(e.x, e.y, e.color, 50);
  dropCoins(e.x, e.y, 20 + Math.floor(wave / 5) * 10);
  spawnPowerup(e.x, e.y);
  enemies.splice(i, 1);
  bossActive = false;
  updateHud();
}

function updateEnemies() {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (!e) continue;
    e.timer++;
    moveEnemy(e);
    const isBoss = e.type.startsWith('boss');
    if (e.type !== 'side' && !isBoss) e.x = clamp(e.x, e.w / 2, W - e.w / 2);
    if (e.y - e.h / 2 > H + 50 && !isBoss) { enemies.splice(i, 1); continue; }
    if (e.type === 'side' && (e.x < -60 || e.x > W + 60) && e.timer > 60) { enemies.splice(i, 1); continue; }
    for (const sym in players) {
      const pl = players[sym];
      if (pl.invuln <= 0 && rectHit(e, pl)) {
        const died = damagePlayer(pl, e.x, e.y);
        if (isBoss) {
          // BOSS是白名单，碰撞时不被秒杀，只弹开
          e.y = Math.max(e.h / 2 + 10, e.y - 30);
          e.vx *= -1;
        } else {
          enemies.splice(i, 1);
        }
        if (gameState !== 'playing') return;
        if (died) break;
      }
    }
  }
}

function enemyFireLogic() {
  for (const e of enemies) {
    if (e.type.startsWith('boss')) { bossAttack(e); continue; }
    if (e.type === 'bomber' && e.entered !== false && e.y > 20 && e.y < H - 100 && e.timer % 80 === 0) {
      enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vy: 3.2, vx: 0, r: 6 });
    }
    if (e.type === 'tank') continue;
    const chance = 0.004 + wave * 0.0006;
    if (e.y > 20 && e.y < H - 80 && Math.random() < chance) {
      const target = nearestPlayer(e.x, e.y);
      let vx = 0;
      if (target) { const angle = Math.atan2(target.y - e.y, target.x - e.x); vx = Math.cos(angle) * (1 + wave * 0.05); }
      enemyBullets.push({ x: e.x, y: e.y + e.h / 2, vy: 2.4 + wave * 0.12, vx, r: 5 });
    }
  }
}

function updateEnemyBullets() {
  for (let i = enemyBullets.length - 1; i >= 0; i--) {
    if (gameState !== 'playing') return;
    const b = enemyBullets[i];
    if (!b) continue;
    b.y += b.vy; b.x += b.vx || 0;
    if (b.y > H + 20 || b.x < -20 || b.x > W + 20) { enemyBullets.splice(i, 1); continue; }
    for (const sym in players) {
      const pl = players[sym];
      if (pl.invuln <= 0 && circleHitPlayer(b, pl)) {
        enemyBullets.splice(i, 1);
        const died = damagePlayer(pl, b.x, b.y);
        if (gameState !== 'playing') return;
        if (died) break;
      }
    }
  }
}

function updateCollisions() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    if (!b) continue;
    for (let j = enemies.length - 1; j >= 0; j--) {
      const e = enemies[j];
      if (!e) continue;
      if (rectHitBullet(e, b)) {
        bullets.splice(i, 1); e.hp--; e.invulnHit = 5;
        if (e.hp <= 0) {
          const isBoss = e.type.startsWith('boss');
          score += isBoss ? 100 : 10;
          spawnParticles(e.x, e.y, e.color, isBoss ? 50 : 12);
          if (isBoss) { bossActive = false; dropCoins(e.x, e.y, 20 + Math.floor(wave / 5) * 10); spawnPowerup(e.x, e.y); }
          else {
            if (Math.random() < 0.35) dropCoins(e.x, e.y, 1 + Math.floor(Math.random() * 2));
            if (e.splits) spawnSplitterChildren(e.x, e.y);
            if (Math.random() < 0.08) spawnPowerup(e.x, e.y);
          }
          enemies.splice(j, 1); updateHud();
        } else { spawnParticles(b.x, b.y, '#fff', 3); }
        break;
      }
    }
  }
}

function spawnSplitterChildren(x, y) {
  for (let k = -1; k <= 1; k += 2) {
    const child = makeEnemy('splitterChild', wave);
    child.x = x + k * 12; child.y = y;
    child.vx = k * 1.2;
    enemies.push(child);
  }
}

function updateCoins() {
  for (let i = coins.length - 1; i >= 0; i--) {
    const c = coins[i]; c.y += 1.5; c.x += Math.sin(timer * 0.05 + c.offset) * 0.3;
    if (c.y > H + 20) { coins.splice(i, 1); continue; }
    for (const sym in players) {
      const pl = players[sym];
      if (Math.hypot(c.x - pl.x, c.y - pl.y) < pl.w / 2 + 12) {
        totalCoins += c.value; localStorage.setItem('shooterCoins', totalCoins); updateHud(); renderShop(); coins.splice(i, 1); break;
      }
    }
  }
}

function updatePowerups() {
  for (let i = powerups.length - 1; i >= 0; i--) {
    const pwr = powerups[i]; pwr.y += 1.8;
    if (pwr.y > H + 20) { powerups.splice(i, 1); continue; }
    for (const sym in players) {
      const pl = players[sym];
      if (Math.hypot(pwr.x - pl.x, pwr.y - pl.y) < pl.w / 2 + 12) {
        applyPowerup(pl, pwr.type); powerups.splice(i, 1); break;
      }
    }
  }
}

function updateWaveLogic() {
  if (enemies.length === 0) {
    if (bossActive) bossActive = false;
    wave++; spawnWave();
  }
}

function fireBossPattern(boss, pattern, speed, target) {
  if (pattern === 0) {
    const angle = target ? Math.atan2(target.y - boss.y, target.x - boss.x) : Math.PI / 2;
    for (let k = -1; k <= 1; k++) { const a = angle + k * 0.25; enemyBullets.push({ x: boss.x, y: boss.y + boss.h / 2, vy: Math.sin(a) * speed, vx: Math.cos(a) * speed, r: 6, fromBoss: true }); }
  } else if (pattern === 1) {
    for (let k = -4; k <= 4; k++) { const a = Math.PI / 2 + k * 0.16; enemyBullets.push({ x: boss.x, y: boss.y + boss.h / 2, vy: Math.sin(a) * speed, vx: Math.cos(a) * speed, r: 5, fromBoss: true }); }
  } else if (pattern === 2) {
    const dir = boss.vx > 0 ? 1 : -1;
    for (let k = 0; k < 6; k++) enemyBullets.push({ x: boss.x, y: boss.y + boss.h / 2, vy: 1 + k * 0.5, vx: dir * (2 + k * 0.4), r: 5, fromBoss: true });
  } else if (pattern === 3) {
    for (let k = 0; k < 12; k++) { const a = (Math.PI * 2 / 12) * k; enemyBullets.push({ x: boss.x, y: boss.y, vy: Math.sin(a) * speed * 0.85, vx: Math.cos(a) * speed * 0.85, r: 5, fromBoss: true }); }
  } else {
    for (let k = -2; k <= 2; k++) { const a = Math.PI / 2 + k * 0.5; enemyBullets.push({ x: boss.x, y: boss.y + boss.h / 2, vy: Math.sin(a) * speed * 1.1, vx: Math.cos(a) * speed * 1.1, r: 6, fromBoss: true }); }
  }
}

function bossAttack(boss) {
  if (!boss.entered) return;
  const hpRatio = boss.hp / boss.maxHp;
  boss.attackCooldown--;
  if (boss.attackCooldown > 0) return;
  const tier = Math.floor(wave / 5);
  const speed = 3.2 + wave * 0.12;
  const target = nearestPlayer(boss.x, boss.y);
  boss.attackPattern = (boss.attackPattern + 1) % 5;

  const patterns = {
    boss: { cooldown: Math.max(35, 100 - tier * 8 - (1 - hpRatio) * 30), sequence: [0, 1, 2, 3, 4] },
    bossRapid: { cooldown: Math.max(22, 55 - tier * 5 - (1 - hpRatio) * 20), sequence: [0, 4, 0, 4, 2] },
    bossSpread: { cooldown: Math.max(40, 110 - tier * 6 - (1 - hpRatio) * 25), sequence: [3, 1, 3, 1, 4] },
    bossSummoner: { cooldown: Math.max(35, 90 - tier * 5 - (1 - hpRatio) * 20), sequence: [2, 0, 2, 4, 0] }
  };
  const cfg = patterns[boss.type] || patterns.boss;
  boss.attackCooldown = cfg.cooldown;
  fireBossPattern(boss, cfg.sequence[boss.attackPattern], speed, target);

  // summon minions in later phases
  if (hpRatio <= 0.65 && boss.timer % boss.minionCooldown === 0) {
    const type = Math.random() < 0.5 ? 'tank' : 'dash';
    const m = makeEnemy(type, wave); m.x = clamp(boss.x + (Math.random() - 0.5) * 60, m.w / 2, W - m.w / 2); m.y = boss.y + 30;
    enemies.push(m);
  }
}

function dropCoins(x, y, n) { for (let i = 0; i < n; i++) coins.push({ x: x + (Math.random() - 0.5) * 30, y: y + (Math.random() - 0.5) * 20, value: 1, offset: Math.random() * 10 }); }
function spawnPowerup(x, y) { const types = Object.keys(POWERUPS); const type = types[Math.floor(Math.random() * types.length)]; powerups.push({ x, y, type, r: 10 }); }
function applyPowerup(pl, type) {
  if (type === 'heal') { lives = Math.min(MAX_LIVES, lives + 1); updateHud(); return; }
  pl.effects[type] = 8 * 60;
}

function rectHit(a, b) { return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2; }
function rectHitBullet(e, b) { return Math.abs(b.x - e.x) < e.w / 2 + 2 && Math.abs(b.y - e.y) < e.h / 2 + 4; }
function circleHitPlayer(b, pl) { return Math.hypot(b.x - pl.x, b.y - pl.y) < pl.w / 2 + b.r; }

function damagePlayer(pl, hitX, hitY) {
  if (pl.effects.shield > 0) { pl.effects.shield = 0; pl.invuln = 45; spawnParticles(hitX, hitY, '#4dff88', 12); return false; }
  if (pl.invuln > 0) return false;
  pl.invuln = 60; spawnParticles(pl.x, pl.y, '#ff4d6a', 24); die(); return true;
}

function die() {
  lives--; updateHud();
  if (lives <= 0) {
    gameState = 'dead';
    if (score > best) { best = score; localStorage.setItem('shooterBest', best); $('hud-best').textContent = best; }
    $('end-subtitle').textContent = '得分: ' + score + ' · 波次: ' + wave + ' · 金币: ' + totalCoins;
    $('end-modal').classList.remove('hidden'); updateStatus();
    if (mode === 'online' && isHost) socket.emit('shooter:end', {});
    Auth.submitScore('shooter', score).catch(() => {});
    loadLeaderboard();
  } else {
    const positions = mode === 'online' ? { 1: W * 0.35, 2: W * 0.65 } : { 1: W / 2 };
    for (const sym in players) { const pl = players[sym]; pl.x = positions[sym]; pl.y = H - 80; pl.invuln = 90; }
    bullets = []; particles = []; powerups = []; coins = [];
    // BOSS是白名单：保留BOSS，只清除BOSS的子弹和附近的小怪
    enemyBullets = enemyBullets.filter(b => !b.fromBoss);
    const clearR = 140;
    const hasBoss = enemies.some(e => e.type.startsWith('boss'));
    enemies = enemies.filter(e => {
      if (e.type.startsWith('boss')) return true;
      for (const sym in players) {
        const pl = players[sym];
        if (Math.hypot(e.x - pl.x, e.y - pl.y) < clearR) return false;
      }
      return true;
    });
    if (!hasBoss) spawnWave();
    else {
      const boss = enemies.find(e => e.type.startsWith('boss'));
      for (let i = 0; i < 2; i++) {
        const type = Math.random() < 0.5 ? 'dash' : 'tank';
        const m = makeEnemy(type, wave);
        m.x = clamp(boss.x + (Math.random() - 0.5) * 80, m.w / 2, W - m.w / 2);
        m.y = boss.y + 50;
        enemies.push(m);
      }
    }
    spawnParticles(players[mySymbol].x, players[mySymbol].y, '#4d96ff', 10);
  }
}
window.restartWave = function () {
  if (mode === 'online' && !isHost) { socket.emit('shooter:restartWave', {}); return; }
  resetForWave(); gameState = 'playing'; $('end-modal').classList.add('hidden'); updateStatus();
};
function restartWavePeer() { resetForWave(); gameState = 'playing'; $('end-modal').classList.add('hidden'); updateStatus(); }
window.backToPlaneSelect = function () {
  $('end-modal').classList.add('hidden'); $('start-overlay').classList.remove('hidden'); gameState = 'idle'; updateStatus();
};

function spawnParticles(x, y, color, n) { for (let i = 0; i < n; i++) particles.push({ x, y, vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6, life: 20 + Math.random() * 15, color, r: 2 + Math.random() * 3 }); }
function updateParticles() { for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.x += p.vx; p.y += p.vy; p.life--; if (p.life <= 0) particles.splice(i, 1); } }

function drawShip(x, y, w, h, color, angle = 0, label = '') {
  ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.moveTo(0, -h / 2); ctx.lineTo(-w / 2, h / 2); ctx.lineTo(w / 2, h / 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(-3, -h / 4, 6, 6);
  ctx.restore();
  if (label) { ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(label, x, y - h / 2 - 8); }
}

function drawEnemy(e) {
  ctx.save(); ctx.translate(e.x, e.y);
  if (e.invulnHit > 0) { e.invulnHit--; ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(-e.w / 2 - 2, -e.h / 2 - 2, e.w + 4, e.h + 4); }
  ctx.fillStyle = e.color;
  ctx.shadowColor = e.color; ctx.shadowBlur = 8;
  switch (e.type) {
    case 'tank': ctx.fillRect(-e.w / 2, -e.h / 2, e.w, e.h); ctx.fillStyle = '#555'; ctx.fillRect(-e.w / 4, -e.h / 4, e.w / 2, e.h / 2); break;
    case 'bomber': ctx.beginPath(); ctx.moveTo(0, -e.h / 2); ctx.lineTo(e.w / 2, 0); ctx.lineTo(0, e.h / 2); ctx.lineTo(-e.w / 2, 0); ctx.closePath(); ctx.fill(); break;
    case 'splitter': ctx.beginPath(); for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ctx.lineTo(Math.cos(a) * e.w / 2, Math.sin(a) * e.h / 2); } ctx.closePath(); ctx.fill(); break;
    case 'seeker': ctx.beginPath(); ctx.moveTo(0, -e.h / 2); ctx.lineTo(e.w / 2, e.h / 2); ctx.lineTo(0, e.h / 4); ctx.lineTo(-e.w / 2, e.h / 2); ctx.closePath(); ctx.fill(); break;
    case 'zigzag': {
      ctx.beginPath(); ctx.moveTo(-e.w / 2, -e.h / 2); ctx.lineTo(0, -e.h / 4); ctx.lineTo(e.w / 2, -e.h / 2);
      ctx.lineTo(e.w / 4, 0); ctx.lineTo(e.w / 2, e.h / 2); ctx.lineTo(0, e.h / 4); ctx.lineTo(-e.w / 2, e.h / 2); ctx.lineTo(-e.w / 4, 0); ctx.closePath(); ctx.fill(); break;
    }
    default: ctx.beginPath(); ctx.moveTo(0, e.h / 2); ctx.lineTo(-e.w / 2, -e.h / 2); ctx.lineTo(e.w / 2, -e.h / 2); ctx.closePath(); ctx.fill();
  }
  // thruster flicker
  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(255, ${100 + Math.random() * 100}, 0, 0.8)`;
  ctx.beginPath(); ctx.moveTo(-4, e.h / 2); ctx.lineTo(0, e.h / 2 + 8 + Math.random() * 4); ctx.lineTo(4, e.h / 2); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawBoss(boss) {
  ctx.save(); ctx.translate(boss.x, boss.y);
  ctx.shadowColor = boss.color; ctx.shadowBlur = 20;
  ctx.fillStyle = boss.color;
  ctx.beginPath(); ctx.moveTo(0, -boss.h / 2); ctx.lineTo(-boss.w / 2, -boss.h / 4); ctx.lineTo(-boss.w / 2, boss.h / 2); ctx.lineTo(boss.w / 2, boss.h / 2); ctx.lineTo(boss.w / 2, -boss.h / 4); ctx.closePath(); ctx.fill();
  // core
  ctx.fillStyle = '#000'; ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = boss.color; ctx.globalAlpha = 0.5 + Math.sin(timer * 0.1) * 0.3; ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  // turrets
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(-boss.w / 2 + 8, -boss.h / 4, 14, 20); ctx.fillRect(boss.w / 2 - 22, -boss.h / 4, 14, 20);
  ctx.restore();
  // hp bar
  const bw = boss.w * 0.9, bh = 6;
  ctx.fillStyle = '#333'; ctx.fillRect(boss.x - bw / 2, boss.y - boss.h / 2 - 22, bw, bh);
  ctx.fillStyle = boss.color; ctx.fillRect(boss.x - bw / 2, boss.y - boss.h / 2 - 22, bw * (boss.hp / boss.maxHp), bh);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('BOSS Lv.' + Math.floor(wave / 5), boss.x, boss.y - boss.h / 2 - 28);
  const typeLabel = { boss: '毁灭者', bossRapid: '急速', bossSpread: '散射', bossSummoner: '召唤' }[boss.type] || '';
  if (typeLabel) { ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.fillText(typeLabel, boss.x, boss.y - boss.h / 2 - 8); }
}

const stars = Array.from({ length: 90 }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random() * 1.5 + 0.5, sp: Math.random() * 1 + 0.3 }));
function drawStars() {
  for (const s of stars) { s.y += s.sp * (gameState === 'playing' ? 1 : 0.3); if (s.y > H) { s.y = 0; s.x = Math.random() * W; } ctx.fillStyle = `rgba(255,255,255,${0.3 + s.s * 0.2})`; ctx.fillRect(s.x, s.y, s.s, s.s); }
}

function render() {
  ctx.fillStyle = '#05050f'; ctx.fillRect(0, 0, W, H);
  drawStars();
  // bullets
  for (const b of bullets) {
    const owner = players[b.fromSymbol];
    ctx.fillStyle = owner ? owner.plane.color : '#ffd93d';
    ctx.fillRect(b.x - 1.5, b.y - 8, 3, 8);
  }
  // enemy bullets
  for (const b of enemyBullets) {
    ctx.save(); ctx.shadowBlur = 10; ctx.shadowColor = '#ff4d6a'; ctx.fillStyle = '#ffccd5';
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff4d6a'; ctx.beginPath(); ctx.arc(b.x, b.y, b.r * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  // enemies
  for (const e of enemies) { if (e.type.startsWith('boss')) drawBoss(e); else drawEnemy(e); }
  // players
  for (const sym in players) {
    const pl = players[sym];
    if (pl.invuln > 0 && Math.floor(timer / 4) % 2 === 0) continue;
    const isMe = parseInt(sym, 10) === mySymbol;
    if (pl.effects.shield > 0) {
      ctx.save();
      ctx.strokeStyle = isMe ? 'rgba(77,255,136,0.7)' : 'rgba(255,159,67,0.7)';
      ctx.lineWidth = 3;
      ctx.shadowColor = isMe ? '#4dff88' : '#ff9f43'; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.w * 0.9, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    drawShip(pl.x, pl.y, pl.w, pl.h, pl.plane.color, 0, isMe ? '我' : '队友');
  }
  // coins
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const c of coins) { ctx.fillStyle = '#ffd93d'; ctx.beginPath(); ctx.arc(c.x, c.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#6b4c00'; ctx.font = '10px sans-serif'; ctx.fillText('🪙', c.x, c.y + 1); }
  // powerups
  for (const pwr of powerups) { ctx.fillStyle = POWERUPS[pwr.type].color; ctx.beginPath(); ctx.arc(pwr.x, pwr.y, pwr.r, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#fff'; ctx.font = '14px sans-serif'; ctx.fillText(POWERUPS[pwr.type].emoji, pwr.x, pwr.y + 1); }
  // particles
  for (const p of particles) { ctx.globalAlpha = p.life / 35; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); }
  ctx.globalAlpha = 1;
  // boss warning
  const lastBoss = enemies.length ? enemies[enemies.length - 1] : null;
  if (bossActive && lastBoss && lastBoss.type.startsWith('boss') && !lastBoss.entered) {
    ctx.fillStyle = 'rgba(255,0,85,0.15)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ff0055'; ctx.font = 'bold 22px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('⚠ BOSS 来袭 ⚠', W / 2, H / 2);
  }
}

function makeSnapshot() {
  const pState = {};
  for (const sym in players) {
    const pl = players[sym];
    pState[sym] = { x: pl.x, y: pl.y, effects: { ...pl.effects }, planeId: pl.planeId, invuln: pl.invuln, w: pl.w, h: pl.h };
  }
  return {
    gameState, score, lives, wave, timer, bossActive,
    players: pState,
    bullets: bullets.map(b => ({ x: b.x, y: b.y, vx: b.vx || 0, vy: b.vy, fromSymbol: b.fromSymbol })),
    enemyBullets: enemyBullets.map(b => ({ x: b.x, y: b.y, vx: b.vx || 0, vy: b.vy, r: b.r })),
    enemies: enemies.map(e => ({ x: e.x, y: e.y, w: e.w, h: e.h, hp: e.hp, maxHp: e.maxHp, type: e.type, timer: e.timer, phase: e.phase, invulnHit: e.invulnHit, color: e.color, entered: !!e.entered, attackCooldown: e.attackCooldown, attackPattern: e.attackPattern, vx: e.vx, vy: e.vy, cx: e.cx, amp: e.amp, freq: e.freq, splits: !!e.splits })),
    powerups: powerups.map(p => ({ x: p.x, y: p.y, type: p.type, r: p.r })),
    coins: coins.map(c => ({ x: c.x, y: c.y, value: c.value, offset: c.offset })),
    particles: particles.map(p => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, life: p.life, color: p.color, r: p.r }))
  };
}

function applySnapshot(s) {
  if (s.gameState !== undefined) gameState = s.gameState;
  score = s.score; lives = s.lives; wave = s.wave; timer = s.timer; bossActive = s.bossActive;
  let myX, myY, myEffects;
  if (players[mySymbol]) { myX = players[mySymbol].x; myY = players[mySymbol].y; myEffects = { ...players[mySymbol].effects }; }
  players = {};
  for (const sym in s.players) {
    const sp = s.players[sym];
    const pl = makePlayer(parseInt(sym, 10), sp.planeId, sp.x, sp.y);
    pl.effects = sp.effects; pl.invuln = sp.invuln || 0; pl.w = sp.w || 28; pl.h = sp.h || 28;
    players[sym] = pl;
  }
  if (players[mySymbol]) { players[mySymbol].x = myX; players[mySymbol].y = myY; }
  bullets = (s.bullets || []).map(b => ({ ...b, from: 'player' }));
  enemyBullets = (s.enemyBullets || []).map(b => ({ ...b }));
  enemies = (s.enemies || []).map(e => ({ ...e, entered: !!e.entered, splits: !!e.splits }));
  powerups = (s.powerups || []).map(p => ({ ...p }));
  coins = (s.coins || []).map(c => ({ ...c }));
  particles = (s.particles || []).map(p => ({ ...p }));
  updateHud(); updateStatus();
  if (gameState === 'dead') $('end-modal').classList.remove('hidden');
}

function networkTick() {
  if (mode !== 'online') return;
  if (isHost) {
    socket.emit('shooter:sync', makeSnapshot());
  } else {
    const pl = players[mySymbol];
    if (pl && timer % 2 === 0) socket.emit('shooter:input', { x: pl.x, y: pl.y });
  }
}

function update() {
  if (gameState !== 'playing') return;
  timer++;
  moveOwnPlayer();
  if (mode === 'online' && isHost) moveRemotePlayer();
  for (const sym in players) {
    const pl = players[sym];
    for (const k in pl.effects) if (pl.effects[k] > 0) pl.effects[k]--;
    if (pl.invuln > 0) pl.invuln--;
  }
  if (mode !== 'online' || isHost) {
    firePlayers();
    updateBullets();
    updateEnemies();
    enemyFireLogic();
    updateEnemyBullets();
    updateCollisions();
    updateCoins();
    updatePowerups();
    updateWaveLogic();
  }
  updateParticles();
  updateHud();
  networkTick();
}

function loop() { update(); render(); requestAnimationFrame(loop); }

window.addEventListener('DOMContentLoaded', () => {
  $('player-name').value = window.getDefaultName ? window.getDefaultName() : '';
  loadLeaderboard();
  const p = new URLSearchParams(location.search).get('room');
  if (p) { $('online-panel').classList.remove('hidden'); $('join-form').classList.remove('hidden'); $('room-id').value = p; startMode('online'); joinRoom(); }
});

reset(true);
loop();

/* === 8-bit Music === */
(function () {
  let actx, musicOn = true, playing = false, intervalId = null;
  const NOTES = { E3: 165, F3: 175, G3: 196, A3: 220, B3: 247, C4: 262, D4: 294, E4: 330, F4: 349, G4: 392, A4: 440, B4: 494, C5: 523 };
  const { E3, G3, A3, C4, E4, G4, B3, B4 } = NOTES;
  const melody = [
    [E3, .08], [G3, .08], [A3, .08], [C4, .08], [E4, .08], [G4, .08], [E4, .08], [C4, .08],
    [A3, .08], [C4, .08], [E4, .08], [G4, .08], [B4, .08], [G4, .08], [E4, .08], [C4, .08],
    [E3, .08], [B3, .08], [E4, .08], [G4, .08], [B4, .08], [G4, .08], [E4, .08], [B3, .08],
    [C4, .08], [G3, .08], [C4, .08], [E4, .08], [G4, .12], [E4, .12], [C4, .12], [G3, .12]
  ];
  let pos = 0;
  function playNote(freq, dur) {
    if (!actx) return;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'square'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.08, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur * 0.9);
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
  }
  function step() { if (!musicOn || !playing) return; const [n, d] = melody[pos % melody.length]; playNote(n, d * 0.9); pos++; }
  function startMusic() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    if (!playing) { playing = true; pos = 0; intervalId = setInterval(step, 100); }
  }
  ['click', 'keydown', 'touchstart'].forEach(evt => document.addEventListener(evt, startMusic, { once: true }));
})();
