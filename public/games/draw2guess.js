const socket = io();
const CLIENT_ID = localStorage.getItem('gameBoxClientId') || ('c' + Math.random().toString(36).substring(2, 10));
localStorage.setItem('gameBoxClientId', CLIENT_ID);
let roomId = null;
let mySymbol = 1;
let mode = 'online';
let isHost = false;
let roomState = { status: 'waiting', drawer: 1, strokes: [], guesses: [], scores: { 1: 0, 2: 0 } };
let secretWord = null;
let players = [];
const $ = id => document.getElementById(id);
const canvas = $('draw-canvas');
const ctx = canvas.getContext('2d');
let drawing = false;
let currentStroke = [];

function play(s) { if (Sounds && Sounds.sfxEnabled()) Sounds[s](); }
function enableSound() { if (Sounds) Sounds.enable(); }

function showScreen(el) {
  $('lobby').classList.remove('active');
  $('game').classList.remove('active');
  el.classList.add('active');
}
function getName() { return $('player-name').value.trim() || 'Player'; }

function createRoom() { socket.emit('createRoom', { gameType: 'draw2guess', playerName: getName(), clientId: CLIENT_ID, isPublic: $('room-public-check').checked }); }
function quickMatch() { socket.emit('quickMatch:join', { gameType: 'draw2guess', playerName: getName(), clientId: CLIENT_ID }); }
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
  roomId = id; mySymbol = player.symbol; isHost = true; mode = 'online'; players = ps || [{ name: player.name, symbol: player.symbol, isHost: true }]; enterGame();
});
socket.on('joinedRoom', (data) => {
  const { roomId: id, you, players: ps } = data;
  const privacyHint = document.getElementById('room-privacy-hint'); if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = id; mySymbol = you ? you.symbol : 2; isHost = you ? you.isHost : false; mode = 'online'; players = ps || []; enterGame();
});
socket.on('joinedAsSpectator', ({ roomId: id, players: ps }) => { roomId = id; mySymbol = null; isHost = false; mode = 'online'; players = ps || []; enterGame(); });
socket.on('reconnected', ({ roomId: id, player, players: ps }) => { roomId = id; mySymbol = player ? player.symbol : 2; isHost = player ? player.isHost : false; mode = 'online'; players = ps || []; enterGame(); });
socket.on('quickMatch:found', ({ roomId: id, you, players: ps }) => { roomId = id; mySymbol = you ? you.symbol : 1; isHost = you ? you.isHost : false; mode = 'online'; players = ps || []; enterGame(); showError('⚡ 匹配成功！'); });
socket.on('quickMatch:waiting', () => { showError('⏳ 正在匹配对手...'); });
socket.on('draw2guess:state', ({ state, players: ps }) => { if (ps) players = ps; applyState(state); });
socket.on('draw2guess:word', ({ word }) => { secretWord = word; $('draw-word').textContent = '你要画：' + word; });
socket.on('error', ({ message }) => showError(message));
socket.on('connect', () => { if (roomId) socket.emit('reconnect', { clientId: CLIENT_ID }); });
socket.on('reconnect:failed', () => { roomId = null; });

function enterGame() {
  $('lobby').classList.add('hidden');
  $('join-form').classList.add('hidden');
  $('room-display').textContent = roomId;
  showScreen($('game'));
}

function applyState(state) {
  roomState = state;
  $('score-1').textContent = state.scores[1] || 0;
  $('score-2').textContent = state.scores[2] || 0;
  $('round-text').textContent = `第 ${state.round || 1} / ${state.maxRounds || 6} 轮`;
  $('message-text').textContent = state.message || '等待房主开始游戏...';

  const p1 = players.find(p => p.symbol === 1), p2 = players.find(p => p.symbol === 2);
  $('name-p1').textContent = p1 ? p1.name : '等待...';
  $('name-p2').textContent = p2 ? p2.name : '等待...';
  if (mySymbol !== null) {
    if (mySymbol === 1) $('name-p1').textContent += ' (你)';
    else $('name-p2').textContent += ' (你)';
  }
  const isDrawer = mySymbol === state.drawer;
  const drawerName = players.find(p => p.symbol === state.drawer)?.name || `P${state.drawer}`;
  $('role-text').textContent = isDrawer ? `✏️ 轮到你画（${drawerName}）` : (mySymbol === null ? '👁️ 观战' : `💡 轮到你猜（画师：${drawerName}）`);
  $('badge-p1').classList.toggle('active', state.drawer === 1 && state.status !== 'waiting');
  $('badge-p2').classList.toggle('active', state.drawer === 2 && state.status !== 'waiting');
  $('drawer-tools').classList.toggle('hidden', !isDrawer);
  $('guesser-tools').classList.toggle('hidden', isDrawer || mySymbol === null);
  $('guess-input').disabled = state.status !== 'drawing' || isDrawer || mySymbol === null;

  if (isDrawer && !secretWord) $('draw-word').textContent = '等待发词...';

  // redraw strokes
  drawStrokes(state.strokes || []);

  // guesses
  const list = $('guess-list');
  list.innerHTML = '';
  (state.guesses || []).slice().reverse().forEach(g => {
    const div = document.createElement('div');
    div.textContent = `${g.player}: ${g.guess}`;
    list.appendChild(div);
  });

  // start/next button
  const btn = $('start-btn');
  if (state.status === 'finished') { btn.textContent = '🔁 重新开始'; btn.disabled = !isHost; }
  else if (state.status === 'waiting') { btn.textContent = '▶️ 开始游戏'; btn.disabled = !isHost; }
  else { btn.textContent = isHost ? '▶️ 下一轮' : '等待房主...'; btn.disabled = !isHost; }

  if (state.status === 'judging') $('message-text').textContent = 'AI 裁判评分中...';
  if (state.message && state.message.includes('猜中')) play('correct');

  if (state.rematchVotes && mode === 'online' && mySymbol !== null) {
    const oppSymbol = mySymbol === 1 ? 2 : 1;
    if (state.rematchVotes[mySymbol] && state.rematchVotes[oppSymbol]) {
      $('message-text').textContent = '双方已准备，即将重新开始...';
    } else if (state.rematchVotes[mySymbol]) {
      $('message-text').textContent = '你已准备再来一局，等待对手...';
    }
  }
}

function startOrNext() {
  if (roomState.status === 'finished' || roomState.status === 'ended') {
    socket.emit('rematch');
    return;
  }
  if (!isHost) return;
  if (roomState.status === 'waiting') socket.emit('draw2guess:start');
  else socket.emit('draw2guess:next');
}
function submitGuess() {
  const input = $('guess-input');
  const guess = input.value.trim();
  if (!guess) return;
  socket.emit('draw2guess:guess', { guess });
  input.value = '';
}
$('guess-input').addEventListener('keypress', e => { if (e.key === 'Enter') submitGuess(); });

function copyLink() {
  if (!roomId) return;
  copyToClipboard(`${location.origin}/games/draw2guess.html?room=${roomId}`, $('copy-btn'), '✅');
}
function leaveGame() {
  socket.emit('leaveRoom');
  location.href = '/games/draw2guess.html';
}

// Drawing
function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const t = e.touches ? e.touches[0] : e;
  return { x: (t.clientX - rect.left) / rect.width, y: (t.clientY - rect.top) / rect.height };
}
function startDraw(e) {
  if (roomState.status !== 'drawing' || mySymbol !== roomState.drawer) return;
  e.preventDefault();
  drawing = true;
  currentStroke = [getPos(e)];
}
function moveDraw(e) {
  if (!drawing) return;
  e.preventDefault();
  const pos = getPos(e);
  currentStroke.push(pos);
  drawStrokes([...(roomState.strokes || []), currentStroke]);
}
function endDraw(e) {
  if (!drawing) return;
  e.preventDefault();
  drawing = false;
  if (currentStroke.length > 0) socket.emit('draw2guess:stroke', { stroke: currentStroke });
  currentStroke = [];
}

canvas.addEventListener('mousedown', startDraw);
canvas.addEventListener('mousemove', moveDraw);
window.addEventListener('mouseup', endDraw);
canvas.addEventListener('touchstart', startDraw, { passive: false });
canvas.addEventListener('touchmove', moveDraw, { passive: false });
canvas.addEventListener('touchend', endDraw, { passive: false });

function clearCanvas() {
  if (roomState.status !== 'drawing' || mySymbol !== roomState.drawer) return;
  // Send empty stroke as clear? Simpler: emit a special clear event. Server resets strokes.
  socket.emit('draw2guess:stroke', { stroke: [] });
}

function drawStrokes(strokes) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#222';
  strokes.forEach(stroke => {
    if (stroke.length === 0) return;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x * canvas.width, stroke[0].y * canvas.height);
    for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x * canvas.width, stroke[i].y * canvas.height);
    ctx.stroke();
  });
}

window.addEventListener('DOMContentLoaded', () => {
  $('player-name').value = getDefaultName() || '';
  const p = new URLSearchParams(location.search).get('room');
  if (p) { $('room-id').value = p; $('join-form').classList.remove('hidden'); joinRoom(); }
});
