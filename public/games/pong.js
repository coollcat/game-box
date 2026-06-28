const socket = io();
const CLIENT_ID = localStorage.getItem('gameBoxClientId') || ('c' + Math.random().toString(36).substring(2, 10));
localStorage.setItem('gameBoxClientId', CLIENT_ID);
const canvas = document.getElementById('pong-canvas');
const ctx = canvas.getContext('2d');

let mode = null;
let roomId = null;
let mySymbol = null;
let isSpectator = false;
let state = { status: 'waiting', scores: [0,0], paddles: [{x:0.5},{x:0.5}], ball: {x:0.5,y:0.5,vx:0,vy:0}, winner: null, server: null };
let trail = [];
let particles = [];
let players = [];

const PADDLE_W = 0.22, PADDLE_H = 0.025, PADDLE_OFF = 0.04, BALL_R = 0.018;
const MAX_SCORE = 5;
const $ = id => document.getElementById(id);
function play(s) { if (Sounds && Sounds.sfxEnabled()) Sounds[s](); }
function enableSound() { if (Sounds) Sounds.enable(); }

function showScreen(el) {
  $('lobby').classList.remove('active');
  $('game').classList.remove('active');
  el.classList.add('active');
}
function getName() { return $('player-name').value.trim() || 'Player'; }

function startMode(m) {
  mode = m; enableSound();
  if (m === 'online') { $('online-panel').classList.remove('hidden'); }
  else {
    mySymbol = null; isSpectator = false;
    resetLocalState();
    $('room-display').textContent = '本地';
    $('copy-btn').classList.add('hidden');
    updateStatus();
    showScreen($('game'));
    requestAnimationFrame(localLoop);
  }
}
function showJoin() { $('join-form').classList.toggle('hidden'); }
function createRoom() { socket.emit('createRoom', { gameType: 'pong', playerName: getName(), clientId: CLIENT_ID, isPublic: $('room-public-check').checked }); }
function quickMatch() { socket.emit('quickMatch:join', { gameType: 'pong', playerName: getName(), clientId: CLIENT_ID }); }
function joinRoom() {
  const id = $('room-id').value.trim().toUpperCase();
  if (!id) return showError('请输入房间号');
  socket.emit('joinRoom', { roomId: id, playerName: getName(), clientId: CLIENT_ID });
}
function showError(msg) { $('error-msg').textContent = msg; $('error-msg').classList.remove('hidden'); setTimeout(() => $('error-msg').classList.add('hidden'), 3000); }

socket.on('roomCreated', (data) => {
  const { roomId: id, player, players: ps } = data;
  const privacyHint = document.getElementById('room-privacy-hint'); if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = id; mySymbol = player.symbol; mode = 'online'; players = ps || [{ name: player.name, symbol: player.symbol, isHost: true }]; enterOnline();
});
socket.on('joinedRoom', (data) => {
  const { roomId: id, state: s, you, players: ps } = data;
  const privacyHint = document.getElementById('room-privacy-hint'); if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = id; mySymbol = you ? you.symbol : 2; mode = 'online'; players = ps || []; enterOnline(); if (s) applyState(s);
});
socket.on('joinedAsSpectator', ({ roomId: id, state: s, players: ps }) => { roomId = id; mySymbol = null; isSpectator = true; mode = 'online'; players = ps || []; enterOnline(); if (s) applyState(s); });
socket.on('reconnected', ({ roomId: id, state: s, player, players: ps }) => { roomId = id; mySymbol = player ? player.symbol : 2; mode = 'online'; players = ps || []; enterOnline(); if (s) applyState(s); });
socket.on('quickMatch:found', ({ roomId: id, you, players: ps }) => { roomId = id; mySymbol = you ? you.symbol : 1; mode = 'online'; players = ps || []; enterOnline(); showError('⚡ 匹配成功！'); });
socket.on('quickMatch:waiting', () => { showError('⏳ 正在匹配对手...'); });
socket.on('pong:state', ({ state: s, players: ps }) => { if (ps) players = ps; applyState(s); });
socket.on('chat:message', msg => appendChat(msg));
socket.on('chat:history', msgs => { $('chat-messages').innerHTML = ''; msgs.forEach(appendChat); });
socket.on('error', ({ message }) => showError(message));
socket.on('connect', () => { if (roomId) socket.emit('reconnect', { clientId: CLIENT_ID }); });
socket.on('reconnect:failed', () => { roomId = null; });

function enterOnline() {
  $('online-panel').classList.add('hidden');
  $('join-form').classList.add('hidden');
  $('copy-btn').classList.remove('hidden');
  $('room-display').textContent = roomId;
  updateBadges();
  updateStatus();
  showScreen($('game'));
}

function applyState(s) {
  const oldScores = state ? [...state.scores] : [0,0];
  const oldStatus = state ? state.status : null;
  state = s;
  $('score-1').textContent = s.scores[0];
  $('score-2').textContent = s.scores[1];
  updateBadges();
  updateStatus();
  draw();
  if (s.status === 'ended') showEnd();
  else {
    closeEndModal();
    if (s.status === 'playing' && oldStatus !== 'playing') play('score');
    else if (s.scores[0] > oldScores[0] || s.scores[1] > oldScores[1]) play('score');
  }
  if (s.rematchVotes && mode === 'online' && mySymbol !== null) {
    const oppSymbol = mySymbol === 1 ? 2 : 1;
    if (s.rematchVotes[mySymbol] && s.rematchVotes[oppSymbol]) {
      $('status-text').textContent = '双方已准备，即将重新开始...';
    } else if (s.rematchVotes[mySymbol]) {
      $('status-text').textContent = '你已准备再来一局，等待对手...';
    }
  }
}
function updateBadges() {
  const p1 = players.find(p => p.symbol === 1), p2 = players.find(p => p.symbol === 2);
  const myName = mode === 'local' ? '玩家1' : (p1 ? p1.name : '等待...');
  const oppName = mode === 'local' ? '玩家2' : (p2 ? p2.name : '等待...');
  const flip = mode === 'online' && mySymbol === 1;
  $('badge-p1').innerHTML = `${mode === 'local' ? '玩家1' : (flip ? '下方' : '上方')} <b id="name-p1">${myName}</b>`;
  $('badge-p2').innerHTML = `${mode === 'local' ? '玩家2' : (flip ? '上方' : '下方')} <b id="name-p2">${oppName}</b>`;
  if (mode === 'online' && mySymbol !== null) {
    $(mySymbol === 1 ? 'name-p1' : 'name-p2').textContent += ' (你)';
  }
  const waitingServe = state.status === 'waitingServe';
  const myServer = mode === 'online' && mySymbol !== null && state.server === mySymbol;
  const oppServer = mode === 'online' && mySymbol !== null && state.server && state.server !== mySymbol;
  $('badge-p1').classList.toggle('active', waitingServe && (mode === 'local' ? state.server === 1 : mySymbol === 1 ? myServer : oppServer));
  $('badge-p2').classList.toggle('active', waitingServe && (mode === 'local' ? state.server === 2 : mySymbol === 1 ? oppServer : myServer));
}

function updateStatus() {
  const hint = $('hint-text');
  if (mode === 'local') {
    if (state.status === 'waitingServe') $('status-text').textContent = '拖动球拍，松开发球';
    else if (state.status === 'ended') $('status-text').textContent = '游戏结束';
    else $('status-text').textContent = '对战开始！';
    hint.textContent = '上半屏控制上方球拍，下半屏控制下方球拍；释放手指发球';
    return;
  }
  if (state.status === 'waiting') $('status-text').textContent = '等待对手加入...';
  else if (state.status === 'waitingServe') {
    if (isSpectator) $('status-text').textContent = '等待发球...';
    else if (state.server === mySymbol) $('status-text').textContent = '轮到你了！拖动球拍，松开发球';
    else $('status-text').textContent = '等待对手发球...';
  } else if (state.status === 'ended') $('status-text').textContent = '游戏结束';
  else if (isSpectator) $('status-text').textContent = '观战中';
  else $('status-text').textContent = '比赛中！你在下方，左右滑动控制球拍';
  hint.textContent = isSpectator ? '' : '左右滑动控制球拍；释放手指发球';
}

function copyLink() {
  if (!roomId) return;
  copyToClipboard(`${location.origin}/games/pong.html?room=${roomId}`, $('copy-btn'), '✅');
}

// Local loop
function resetLocalState() {
  state = { status: 'waitingServe', scores: [0,0], paddles: [{x:0.5},{x:0.5}], ball: {x:0.5,y:0.5,vx:0,vy:0}, winner: null, server: Math.random() > 0.5 ? 1 : 2 };
  trail = []; particles = [];
  $('score-1').textContent = '0'; $('score-2').textContent = '0';
}
function serveBall(dir) {
  const speed = 0.012 + Math.random() * 0.004;
  const angle = (Math.random() - 0.5) * 0.6;
  state.ball = { x: 0.5, y: 0.5, vx: speed * Math.sin(angle), vy: speed * (dir || 1) };
  state.status = 'playing';
}
let lastTime = 0;
function localLoop(timestamp) {
  if (mode !== 'local') return;
  if (!lastTime) lastTime = timestamp;
  const dt = Math.min((timestamp - lastTime) / 16.667, 3);
  lastTime = timestamp;
  updateLocalPhysics(dt);
  draw();
  requestAnimationFrame(localLoop);
}
function updateLocalPhysics(dt) {
  if (state.status !== 'playing') return;
  let { x, y, vx, vy } = state.ball;
  x += vx * dt; y += vy * dt;
  if (x - BALL_R < 0) { x = BALL_R; vx = Math.abs(vx); play('hit'); }
  if (x + BALL_R > 1) { x = 1 - BALL_R; vx = -Math.abs(vx); play('hit'); }
  const p1 = state.paddles[0].x, p2 = state.paddles[1].x;
  const topY = PADDLE_OFF + PADDLE_H;
  const botY = 1 - PADDLE_OFF - PADDLE_H;
  if (y - BALL_R <= topY && y > PADDLE_OFF && x >= p1 - PADDLE_W/2 && x <= p1 + PADDLE_W/2) {
    const hit = (x - p1) / (PADDLE_W / 2);
    vy = Math.abs(vy) * 1.04; vx += hit * 0.015; y = topY + BALL_R; play('hit'); spawnParticles(x, topY, '#6bcb77');
  }
  if (y + BALL_R >= botY && y < 1 - PADDLE_OFF && x >= p2 - PADDLE_W/2 && x <= p2 + PADDLE_W/2) {
    const hit = (x - p2) / (PADDLE_W / 2);
    vy = -Math.abs(vy) * 1.04; vx += hit * 0.015; y = botY - BALL_R; play('hit'); spawnParticles(x, botY, '#4d96ff');
  }
  const speed = Math.hypot(vx, vy);
  if (speed > 0.04) { const r = 0.04/speed; vx*=r; vy*=r; }
  if (y < 0) {
    state.scores[1]++; play('score');
    if (state.scores[1] >= MAX_SCORE) { state.status='ended'; state.winner=2; showEnd(); play('win'); }
    else { state.status='waitingServe'; state.server=2; state.ball={x:0.5,y:0.5,vx:0,vy:0}; }
  } else if (y > 1) {
    state.scores[0]++; play('score');
    if (state.scores[0] >= MAX_SCORE) { state.status='ended'; state.winner=1; showEnd(); play('win'); }
    else { state.status='waitingServe'; state.server=1; state.ball={x:0.5,y:0.5,vx:0,vy:0}; }
  } else state.ball = { x, y, vx, vy };
  $('score-1').textContent = state.scores[0];
  $('score-2').textContent = state.scores[1];
  trail.push({x,y});
  if (trail.length > 20) trail.shift();
  updateParticles();
}

function tryServe(clientY) {
  if (mode === 'online') {
    if (!isSpectator && state.status === 'waitingServe' && state.server === mySymbol) {
      socket.emit('pong:serve');
    }
    return;
  }
  if (mode === 'local' && state.status === 'waitingServe') {
    serveBall(state.server === 1 ? 1 : -1);
  }
}

function handleInput(clientX, clientY, isTap) {
  const rect = canvas.getBoundingClientRect();
  let x = (clientX - rect.left) / rect.width;
  x = Math.max(PADDLE_W/2, Math.min(1 - PADDLE_W/2, x));
  if (mode === 'local') {
    let y = (clientY - rect.top) / rect.height;
    if (y < 0.5) state.paddles[0].x = x;   // upper half controls top paddle (P1)
    else state.paddles[1].x = x;           // lower half controls bottom paddle (P2)
  } else if (mode === 'online' && mySymbol && !isSpectator) {
    state.paddles[mySymbol - 1].x = x;
    socket.emit('pong:paddle', { x });
  }
}

let pointerActive = false;
let didDrag = false;

function onPointerStart(clientX, clientY) {
  pointerActive = true;
  didDrag = false;
  handleInput(clientX, clientY, true);
}
function onPointerMove(clientX, clientY) {
  didDrag = true;
  handleInput(clientX, clientY, false);
}
function onPointerEnd(clientY) {
  if (!pointerActive) return;
  pointerActive = false;
  tryServe(clientY);
}

canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  for (let t of e.changedTouches) onPointerStart(t.clientX, t.clientY);
}, { passive: false });
canvas.addEventListener('touchmove', e => {
  e.preventDefault();
  for (let t of e.changedTouches) onPointerMove(t.clientX, t.clientY);
}, { passive: false });
canvas.addEventListener('touchend', e => {
  e.preventDefault();
  for (let t of e.changedTouches) onPointerEnd(t.clientY);
}, { passive: false });
canvas.addEventListener('touchcancel', e => {
  pointerActive = false;
}, { passive: false });
canvas.addEventListener('mousedown', e => { onPointerStart(e.clientX, e.clientY); });
canvas.addEventListener('mousemove', e => { if (e.buttons) onPointerMove(e.clientX, e.clientY); });
canvas.addEventListener('mouseup', e => { onPointerEnd(e.clientY); });
canvas.addEventListener('mouseleave', () => { pointerActive = false; });

function spawnParticles(nx, ny, color) {
  const W = canvas.width, H = canvas.height;
  for (let i = 0; i < 10; i++) {
    particles.push({ x: nx * W, y: ny * H, vx: (Math.random() - 0.5) * 4, vy: (Math.random() - 0.5) * 4, life: 1, color });
  }
}
function updateParticles() {
  for (let p of particles) { p.x += p.vx; p.y += p.vy; p.life -= 0.04; }
  particles = particles.filter(p => p.life > 0);
}

function shouldFlipView() { return mode === 'online' && mySymbol === 1 && !isSpectator; }
function viewY(y) { return shouldFlipView() ? 1 - y : y; }

function draw() {
  const W = canvas.width, H = canvas.height;
  const flip = shouldFlipView();
  ctx.fillStyle = '#0a0a1a'; ctx.fillRect(0,0,W,H);

  // Glow net
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.setLineDash([12,12]); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0,H/2); ctx.lineTo(W,H/2); ctx.stroke(); ctx.setLineDash([]);

  // Trail
  if (trail.length > 1) {
    ctx.lineWidth = 3;
    for (let i = 0; i < trail.length - 1; i++) {
      ctx.strokeStyle = `rgba(255,217,61,${i / trail.length * 0.6})`;
      ctx.beginPath();
      ctx.moveTo(trail[i].x * W, viewY(trail[i].y) * H);
      ctx.lineTo(trail[i+1].x * W, viewY(trail[i+1].y) * H);
      ctx.stroke();
    }
  }

  // Paddles with glow: own paddle always at bottom
  let ownIdx = 0, oppIdx = 1;
  if (mode === 'online' && mySymbol === 2) { ownIdx = 1; oppIdx = 0; }
  drawPaddle(state.paddles[oppIdx].x * W, PADDLE_OFF * H, '#6bcb77');
  drawPaddle(state.paddles[ownIdx].x * W, (1 - PADDLE_OFF - PADDLE_H) * H, '#4d96ff');

  // Ball glow
  const bx = state.ball.x * W, by = viewY(state.ball.y) * H;
  const grad = ctx.createRadialGradient(bx, by, BALL_R * W * 0.3, bx, by, BALL_R * W * 2.5);
  grad.addColorStop(0, 'rgba(255,217,61,1)'); grad.addColorStop(1, 'rgba(255,217,61,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(bx, by, BALL_R * W * 2.5, 0, Math.PI*2); ctx.fill();
  ctx.fillStyle = '#ffd93d';
  ctx.beginPath(); ctx.arc(bx, by, BALL_R * W, 0, Math.PI*2); ctx.fill();

  // Particles
  for (let p of particles) {
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, Math.PI*2); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Serve hint
  if (state.status === 'waitingServe') {
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('松开发球', W/2, H/2 + 6);
  }
}

function drawPaddle(cx, cy, color) {
  const W = canvas.width, H = canvas.height;
  const w = PADDLE_W * W, h = PADDLE_H * H;
  ctx.shadowColor = color; ctx.shadowBlur = 15;
  const grad = ctx.createLinearGradient(cx - w/2, cy, cx + w/2, cy);
  grad.addColorStop(0, color); grad.addColorStop(1, '#fff');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.roundRect(cx - w/2, cy, w, h, 6); ctx.fill();
  ctx.shadowBlur = 0;
}

function resetGame() {
  closeEndModal();
  if (mode === 'online') socket.emit('pong:reset');
  else resetLocalState();
}
function rematchGame() {
  closeEndModal();
  if (mode === 'online') socket.emit('rematch');
  else resetGame();
}
function leaveGame() {
  socket.emit('leaveRoom');
  location.href = '/games/pong.html';
}
function showEnd() {
  if (mode === 'local') { $('end-title').textContent = state.winner === 1 ? '上方玩家胜利' : '下方玩家胜利'; $('end-subtitle').textContent = '同屏对战结束'; }
  else {
    if (isSpectator) $('end-title').textContent = '比赛结束';
    else if (state.winner === mySymbol) $('end-title').textContent = '你赢了！';
    else $('end-title').textContent = '你输了...';
    $('end-subtitle').textContent = `比分 ${state.scores[0]} : ${state.scores[1]}`;
  }
  $('end-modal').classList.remove('hidden');
}
function closeEndModal() { $('end-modal').classList.add('hidden'); }

// Chat
function sendChat() {
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;
  socket.emit('chat:send', { text, type: 'text' });
  input.value = '';
}
function sendSticker(emoji) { socket.emit('chat:send', { text: emoji, type: 'sticker' }); }
function appendChat(msg) {
  const box = $('chat-messages');
  const div = document.createElement('div');
  div.className = 'chat-msg' + (msg.name === getName() ? ' me' : '');
  div.innerHTML = `<b>${escapeHtml(msg.name)}</b> ${msg.type === 'sticker' ? `<span class="sticker">${escapeHtml(msg.text)}</span>` : escapeHtml(msg.text)}`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
  play('chat');
}
function escapeHtml(t) { return t.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } });

// Chat FAB expand/collapse
const chatFab = $('chat-fab');
const chatFabBtn = $('chat-fab-btn');
const chatPanel = $('chat-panel');
const chatClose = $('chat-close');

function toggleChat(forceOpen) {
  const isHidden = chatPanel.classList.contains('hidden');
  const expanded = forceOpen === undefined ? isHidden : forceOpen;
  chatPanel.classList.toggle('hidden', !expanded);
  chatFabBtn.textContent = expanded ? '✕' : '💬';
  if (expanded) setTimeout(() => $('chat-messages').scrollTop = $('chat-messages').scrollHeight, 50);
}

// Draggable FAB (button + panel header) for touch and mouse
let suppressFabClick = false;

chatFabBtn.addEventListener('click', () => { if (!suppressFabClick) toggleChat(); });
chatClose.addEventListener('click', () => toggleChat(false));
(function initDraggableFab() {
  let dragging = false;
  let startX = 0, startY = 0;
  let startLeft = 0, startTop = 0;
  let dragMoved = false;

  function getPos() {
    const rect = chatFab.getBoundingClientRect();
    return { left: rect.left, top: rect.top };
  }

  function setPos(left, top) {
    const maxLeft = window.innerWidth - chatFab.offsetWidth;
    const maxTop = window.innerHeight - chatFab.offsetHeight;
    left = Math.max(0, Math.min(maxLeft, left));
    top = Math.max(0, Math.min(maxTop, top));
    chatFab.style.left = left + 'px';
    chatFab.style.top = top + 'px';
    chatFab.style.right = 'auto';
    chatFab.style.bottom = 'auto';
  }

  function onStart(x, y) {
    dragging = true;
    dragMoved = false;
    startX = x;
    startY = y;
    const pos = getPos();
    startLeft = pos.left;
    startTop = pos.top;
    chatFab.classList.add('dragging');
  }

  function onMove(x, y) {
    if (!dragging) return;
    const dx = x - startX;
    const dy = y - startY;
    if (Math.hypot(dx, dy) > 3) dragMoved = true;
    setPos(startLeft + dx, startTop + dy);
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    chatFab.classList.remove('dragging');
    if (dragMoved) suppressFabClick = true;
  }

  function bindDrag(el) {
    el.addEventListener('touchstart', e => {
      onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    el.addEventListener('touchmove', e => {
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });
    el.addEventListener('touchend', e => {
      onEnd();
      if (dragMoved) e.preventDefault();
    }, { passive: false });

    el.addEventListener('mousedown', e => {
      e.preventDefault();
      onStart(e.clientX, e.clientY);
    });
  }

  bindDrag(chatFabBtn);
  bindDrag($('chat-header'));
  window.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', () => onEnd());

  // Clear suppression after the potential synthetic click window.
  window.addEventListener('click', () => {
    setTimeout(() => { suppressFabClick = false; }, 50);
  }, true);
})();

$('chat-input').addEventListener('focus', () => {
  if (chatPanel.classList.contains('hidden')) toggleChat(true);
});

window.addEventListener('DOMContentLoaded', () => {
  $('player-name').value = getDefaultName() || '';
  const p = new URLSearchParams(location.search).get('room');
  if (p) { $('room-id').value = p; $('online-panel').classList.remove('hidden'); $('join-form').classList.remove('hidden'); joinRoom(); }
});
