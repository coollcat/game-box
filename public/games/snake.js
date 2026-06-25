const socket = typeof io !== 'undefined' ? io() : { emit(){}, on(){}, disconnect(){} };
const CLIENT_ID = localStorage.getItem('gameBoxClientId') || ('c' + Math.random().toString(36).substring(2, 10));
localStorage.setItem('gameBoxClientId', CLIENT_ID);
const canvas = document.getElementById('snake-canvas');
const ctx = canvas.getContext('2d');
const GRID = 24;
const TILE = canvas.width / GRID;

let roomId = null;
let mySymbol = 1;
let isHost = false;
let state = { status: 'waiting', map: 'empty', walls: [], snakes: {}, foods: [], scores: { 1: 0, 2: 0 }, lives: { 1: 3, 2: 3 }, ready: { 1: false, 2: false }, message: '' };
let players = [];
let mode = 'multi';

const $ = id => document.getElementById(id);
function play(s) { if (Sounds && Sounds.sfxEnabled()) Sounds[s](); }
function enableSound() { if (Sounds) Sounds.enable(); }

// Single-player state
let singleLoop = null;
let singleState = null;

const SNAKE_MAPS = {
  empty: [],
  box: [{x:5,y:5},{x:6,y:5},{x:7,y:5},{x:8,y:5},{x:9,y:5},{x:10,y:5},{x:11,y:5},{x:12,y:5},{x:13,y:5},{x:14,y:5},
        {x:5,y:14},{x:6,y:14},{x:7,y:14},{x:8,y:14},{x:9,y:14},{x:10,y:14},{x:11,y:14},{x:12,y:14},{x:13,y:14},{x:14,y:14},
        {x:5,y:6},{x:5,y:7},{x:5,y:8},{x:5,y:9},{x:5,y:10},{x:5,y:11},{x:5,y:12},{x:5,y:13},
        {x:14,y:6},{x:14,y:7},{x:14,y:8},{x:14,y:9},{x:14,y:10},{x:14,y:11},{x:14,y:12},{x:14,y:13}],
  cross: [{x:9,y:0},{x:9,y:1},{x:9,y:2},{x:9,y:3},{x:9,y:4},{x:9,y:15},{x:9,y:16},{x:9,y:17},{x:9,y:18},{x:9,y:19},
          {x:10,y:0},{x:10,y:1},{x:10,y:2},{x:10,y:3},{x:10,y:4},{x:10,y:15},{x:10,y:16},{x:10,y:17},{x:10,y:18},{x:10,y:19},
          {x:0,y:9},{x:1,y:9},{x:2,y:9},{x:3,y:9},{x:4,y:9},{x:15,y:9},{x:16,y:9},{x:17,y:9},{x:18,y:9},{x:19,y:9},
          {x:0,y:10},{x:1,y:10},{x:2,y:10},{x:3,y:10},{x:4,y:10},{x:15,y:10},{x:16,y:10},{x:17,y:10},{x:18,y:10},{x:19,y:10}],
  maze: [{x:2,y:2},{x:3,y:2},{x:4,y:2},{x:5,y:2},{x:6,y:2},{x:7,y:2},{x:8,y:2},
         {x:11,y:2},{x:12,y:2},{x:13,y:2},{x:14,y:2},{x:15,y:2},{x:16,y:2},{x:17,y:2},
         {x:2,y:5},{x:3,y:5},{x:4,y:5},{x:5,y:5},{x:6,y:5},{x:7,y:5},{x:8,y:5},
         {x:11,y:5},{x:12,y:5},{x:13,y:5},{x:14,y:5},{x:15,y:5},{x:16,y:5},{x:17,y:5},
         {x:2,y:8},{x:3,y:8},{x:4,y:8},{x:5,y:8},{x:6,y:8},{x:7,y:8},{x:8,y:8},{x:9,y:8},{x:10,y:8},{x:11,y:8},{x:12,y:8},{x:13,y:8},{x:14,y:8},{x:15,y:8},{x:16,y:8},{x:17,y:8},
         {x:2,y:11},{x:3,y:11},{x:4,y:11},{x:5,y:11},{x:6,y:11},{x:7,y:11},{x:8,y:11},{x:9,y:11},{x:10,y:11},{x:11,y:11},{x:12,y:11},{x:13,y:11},{x:14,y:11},{x:15,y:11},{x:16,y:11},{x:17,y:11},
         {x:2,y:14},{x:3,y:14},{x:4,y:14},{x:5,y:14},{x:6,y:14},{x:7,y:14},{x:8,y:14},
         {x:11,y:14},{x:12,y:14},{x:13,y:14},{x:14,y:14},{x:15,y:14},{x:16,y:14},{x:17,y:14},
         {x:2,y:17},{x:3,y:17},{x:4,y:17},{x:5,y:17},{x:6,y:17},{x:7,y:17},{x:8,y:17},
         {x:11,y:17},{x:12,y:17},{x:13,y:17},{x:14,y:17},{x:15,y:17},{x:16,y:17},{x:17,y:17}]
};

function showScreen(el) {
  ['lobby','room','game'].forEach(id => $(id).classList.remove('active'));
  el.classList.add('active');
}
function getName() { return $('player-name').value.trim() || 'Player'; }

function startSingle() {
  mode = 'single';
  enableSound();
  const mapName = $('single-map').value;
  singleState = {
    map: mapName,
    walls: SNAKE_MAPS[mapName] || [],
    snake: [{x:6,y:12},{x:5,y:12},{x:4,y:12}],
    dir: {x:1,y:0},
    nextDir: {x:1,y:0},
    food: null,
    score: 0,
    gameOver: false,
    status: 'playing'
  };
  spawnSingleFood();
  $('room-display').textContent = '单人';
  $('copy-btn').classList.add('hidden');
  $('single-status').style.display = 'block';
  $('multi-status').style.display = 'none';
  $('single-score').textContent = '0';
  $('single-length').textContent = singleState.snake.length;
  $('game-message').textContent = '使用方向键或 D-pad 控制';
  showScreen($('game'));
  if (singleLoop) clearInterval(singleLoop);
  singleLoop = setInterval(updateSingle, 140);
  draw();
}

function spawnSingleFood() {
  const s = singleState;
  let pos;
  do {
    pos = { x: Math.floor(Math.random()*GRID), y: Math.floor(Math.random()*GRID) };
  } while (s.snake.some(seg => seg.x === pos.x && seg.y === pos.y) || s.walls.some(w => w.x === pos.x && w.y === pos.y));
  s.food = pos;
}

function updateSingle() {
  const s = singleState;
  if (!s || s.gameOver) return;
  s.dir = s.nextDir;
  const head = { x: s.snake[0].x + s.dir.x, y: s.snake[0].y + s.dir.y };

  head.x = (head.x + GRID) % GRID;
  head.y = (head.y + GRID) % GRID;
  if (s.walls.some(w => w.x === head.x && w.y === head.y)) { endSingle(); return; }
  if (s.snake.some(seg => seg.x === head.x && seg.y === head.y)) { endSingle(); return; }

  s.snake.unshift(head);
  if (s.food && s.food.x === head.x && s.food.y === head.y) {
    s.score += 10; play('score'); spawnSingleFood();
  } else {
    s.snake.pop();
  }
  $('single-score').textContent = s.score;
  $('single-length').textContent = s.snake.length;
  draw();
}

function endSingle() {
  const s = singleState;
  s.gameOver = true; s.status = 'ended';
  if (singleLoop) { clearInterval(singleLoop); singleLoop = null; }
  play('lose');
  if (Auth.isLoggedIn()) Auth.submitScore('snake', s.score);
  $('end-title').textContent = `游戏结束！得分 ${s.score}`;
  $('end-modal').classList.remove('hidden');
}

function createRoom() { socket.emit('createRoom', { gameType: 'snake', playerName: getName(), clientId: CLIENT_ID, isPublic: $('room-public-check').checked }); }
function quickMatch() { socket.emit('quickMatch:join', { gameType: 'snake', playerName: getName(), clientId: CLIENT_ID }); }
function joinRoom() {
  const id = $('room-id').value.trim().toUpperCase();
  if (!id) return showError('请输入房间号');
  socket.emit('joinRoom', { roomId: id, playerName: getName(), clientId: CLIENT_ID });
}
function showJoin() { $('join-form').classList.toggle('hidden'); }
function showError(msg) { $('error-msg').textContent = msg; $('error-msg').classList.remove('hidden'); setTimeout(() => $('error-msg').classList.add('hidden'), 3000); }

socket.on('roomCreated', (data) => {
  const { roomId: id, player, players: ps } = data;
  const privacyHint = document.getElementById('room-privacy-hint'); if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = id; mySymbol = player.symbol; isHost = true; mode = 'multi'; players = ps || [{ name: player.name, symbol: player.symbol, isHost: true }]; enterRoom();
});
socket.on('joinedRoom', (data) => {
  const { roomId: id, you, players: ps } = data;
  const privacyHint = document.getElementById('room-privacy-hint'); if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = id; mySymbol = you ? you.symbol : 2; isHost = you ? you.isHost : false; mode = 'multi'; players = ps || []; enterRoom();
});
socket.on('joinedAsSpectator', ({ roomId: id, players: ps }) => { roomId = id; mySymbol = null; mode = 'multi'; players = ps || []; enterRoom(); });
socket.on('reconnected', ({ roomId: id, player, players: ps }) => { roomId = id; mySymbol = player ? player.symbol : 2; isHost = player ? player.isHost : false; mode = 'multi'; players = ps || []; enterRoom(); });
socket.on('quickMatch:found', ({ roomId: id, you, players: ps }) => { roomId = id; mySymbol = you ? you.symbol : 1; isHost = you ? you.isHost : false; mode = 'multi'; players = ps || []; enterRoom(); showError('⚡ 匹配成功！'); });
socket.on('quickMatch:waiting', () => { showError('⏳ 正在匹配对手...'); });
socket.on('snake:state', ({ state: s, players: ps }) => { state = s; if (ps) players = ps; applyState(); });
socket.on('error', ({ message }) => showError(message));
socket.on('connect', () => { if (roomId) socket.emit('reconnect', { clientId: CLIENT_ID }); });
socket.on('reconnect:failed', () => { roomId = null; });

function enterRoom() {
  $('lobby').classList.add('hidden');
  $('join-form').classList.add('hidden');
  $('room-display').textContent = roomId;
  $('single-status').style.display = 'none';
  $('multi-status').style.display = 'block';
  showScreen($('room'));
  $('map-select-group').style.display = isHost ? 'block' : 'none';
  updateMapChips(state.map || 'empty');
  applyState();
}

function applyState() {
  const statusDiv = $('players-status');
  const teamLabel = $('team-label');
  if (players.length === 2) {
    const p1 = players.find(p => p.symbol === 1), p2 = players.find(p => p.symbol === 2);
    statusDiv.innerHTML = `${p1.name} ${state.ready[1] ? '✅' : '⏳'} vs ${p2.name} ${state.ready[2] ? '✅' : '⏳'}`;
  } else {
    statusDiv.textContent = '等待对手加入...';
  }
  if (mySymbol !== null) {
    teamLabel.textContent = `你是 P${mySymbol} (${mySymbol === 1 ? '绿色' : '蓝色'})`;
  } else {
    teamLabel.textContent = '👁️ 观战';
  }

  const readyBtn = $('ready-btn');
  if (state.ready[mySymbol]) { readyBtn.textContent = '✅ 已准备'; readyBtn.classList.add('active'); }
  else { readyBtn.textContent = '👍 准备'; readyBtn.classList.remove('active'); }

  const startBtn = $('start-btn');
  if (isHost) {
    const allReady = players.length === 2 && state.ready[1] && state.ready[2];
    startBtn.disabled = !allReady;
    startBtn.textContent = allReady ? '▶️ 开始游戏' : '等待玩家准备';
  } else {
    startBtn.disabled = true;
    startBtn.textContent = '等待房主开始';
  }

  if (state.status === 'playing' || state.status === 'ended') showScreen($('game'));

  $('score-1').textContent = state.scores[1] || 0;
  $('score-2').textContent = state.scores[2] || 0;
  $('lives-1').textContent = state.lives[1] || 0;
  $('lives-2').textContent = state.lives[2] || 0;
  $('game-message').textContent = state.message || '';
  updateMapChips(state.map || 'empty');

  const wasPlaying = window.__snakeWasPlaying;
  window.__snakeWasPlaying = state.status === 'playing';
  if (!wasPlaying && window.__snakeWasPlaying) lastSentDir = null;

  if (state.rematchVotes && mode === 'multi' && mySymbol !== null) {
    const oppSymbol = mySymbol === 1 ? 2 : 1;
    if (state.rematchVotes[mySymbol] && state.rematchVotes[oppSymbol]) {
      $('game-message').textContent = '双方已准备，即将重新开始...';
    } else if (state.rematchVotes[mySymbol]) {
      $('game-message').textContent = '你已准备再来一局，等待对手...';
    }
  }

  if (state.status !== 'ended') closeEndModal();

  draw();
}

function setMap(map) { if (isHost) socket.emit('snake:map', { map }); }
function updateMapChips(map) {
  document.querySelectorAll('#room-map-chips .map-chip').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.map === map);
  });
}
function selectSingleMap(map) {
  $('single-map').value = map;
  document.querySelectorAll('#single-map-chips .map-chip').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.map === map);
  });
}
function toggleReady() {
  if (mySymbol === null) return;
  socket.emit('snake:ready');
}
function startGame() {
  if (!isHost) return;
  socket.emit('snake:start');
}
function resetGame() {
  if (mode === 'single') {
    closeEndModal();
    startSingle();
    return;
  }
  socket.emit('snake:reset');
}
function rematchGame() {
  closeEndModal();
  if (mode === 'multi') socket.emit('rematch');
  else resetGame();
}
function leaveGame() {
  socket.emit('leaveRoom');
  location.href = '/games/snake.html';
}
function copyLink() {
  if (!roomId) return;
  copyToClipboard(`${location.origin}/games/snake.html?room=${roomId}`, $('copy-btn'), '✅');
}

let lastSentDir = null;
window.setDir = function(dir) {
  const dirs = { up: {x:0,y:-1}, down: {x:0,y:1}, left: {x:-1,y:0}, right: {x:1,y:0} };
  const nd = dirs[dir];
  if (!nd) return;
  if (mode === 'single' && singleState && !singleState.gameOver) {
    if (singleState.dir.x + nd.x === 0 && singleState.dir.y + nd.y === 0) return;
    singleState.nextDir = nd;
    return;
  }
  if (state.status !== 'playing') return;
  if (lastSentDir === dir) return;
  lastSentDir = dir;
  socket.emit('snake:dir', dir);
};
window.addEventListener('keydown', e => {
  if (e.key === 'ArrowUp' || e.key === 'w') setDir('up');
  if (e.key === 'ArrowDown' || e.key === 's') setDir('down');
  if (e.key === 'ArrowLeft' || e.key === 'a') setDir('left');
  if (e.key === 'ArrowRight' || e.key === 'd') setDir('right');
});

function closeEndModal() { $('end-modal').classList.add('hidden'); }

function draw() {
  ctx.fillStyle = '#0a0a1a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  let walls = [];
  if (mode === 'single' && singleState) walls = singleState.walls || [];
  else walls = state.walls || [];

  ctx.fillStyle = '#555';
  walls.forEach(w => ctx.fillRect(w.x * TILE + 1, w.y * TILE + 1, TILE - 2, TILE - 2));

  let foods = [];
  if (mode === 'single' && singleState) foods = singleState.food ? [singleState.food] : [];
  else foods = state.foods || [];

  foods.forEach((food, idx) => {
    if (!food) return;
    const fx = food.x * TILE + TILE / 2, fy = food.y * TILE + TILE / 2;
    const color = mode === 'single' ? '255,107,107' : (idx === 0 ? '255,107,107' : '255,217,61');
    const g = ctx.createRadialGradient(fx, fy, 2, fx, fy, TILE);
    g.addColorStop(0, `rgba(${color},0.6)`); g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fx, fy, TILE, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = `rgb(${color})`;
    ctx.beginPath(); ctx.arc(fx, fy, TILE / 2 - 2, 0, Math.PI * 2); ctx.fill();
  });

  if (mode === 'single' && singleState) {
    drawSnake(singleState.snake, '#6bcb77', '#4aa85a');
  } else {
    [1, 2].forEach(sym => {
      const s = state.snakes[sym];
      if (!s) return;
      const headColor = sym === 1 ? '#6bcb77' : '#4d96ff';
      const bodyColor = sym === 1 ? '#4aa85a' : '#3d8ce0';
      drawSnake(s, headColor, bodyColor);
    });
  }
}

function drawSnake(segs, headColor, bodyColor) {
  segs.forEach((seg, i) => {
    const sx = seg.x * TILE, sy = seg.y * TILE;
    const head = i === 0;
    const grad = ctx.createLinearGradient(sx, sy, sx + TILE, sy + TILE);
    grad.addColorStop(0, head ? headColor : bodyColor);
    grad.addColorStop(1, head ? bodyColor : darken(bodyColor));
    ctx.fillStyle = grad;
    roundRect(sx + 1, sy + 1, TILE - 2, TILE - 2, 5);
    ctx.fill();
    if (head) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(sx + TILE * 0.35, sy + TILE * 0.35, 2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + TILE * 0.65, sy + TILE * 0.35, 2, 0, Math.PI * 2); ctx.fill();
    }
  });
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  for (let i = 0; i <= GRID; i++) {
    ctx.beginPath(); ctx.moveTo(i * TILE, 0); ctx.lineTo(i * TILE, canvas.height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * TILE); ctx.lineTo(canvas.width, i * TILE); ctx.stroke();
  }
}
function darken(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (n >> 16) - 40), g = Math.max(0, ((n >> 8) & 0xff) - 40), b = Math.max(0, (n & 0xff) - 40);
  return `rgb(${r},${g},${b})`;
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

enableSound();

window.addEventListener('DOMContentLoaded', () => {
  $('player-name').value = (typeof getDefaultName === 'function' ? getDefaultName() : '') || '';
  const p = new URLSearchParams(location.search).get('room');
  if (p) { $('room-id').value = p; $('join-form').classList.remove('hidden'); joinRoom(); }
});
