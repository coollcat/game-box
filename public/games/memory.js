const socket = io();
const CLIENT_ID = localStorage.getItem('gameBoxClientId') || ('c' + Math.random().toString(36).substring(2, 10));
localStorage.setItem('gameBoxClientId', CLIENT_ID);
let mode = null;
let roomId = null;
let mySymbol = 1;
let roomState = { status: 'waiting', cards: [], currentPlayer: 1, scores: [0,0], flipped: [], winner: null };
let players = [];
let localState = { cards: [], currentPlayer: 1, scores: [0,0], flipped: [], locked: false, winner: null, moves: 0, startTime: 0, timerId: null };
const MEMORY_ICONS = ['🍎','🍌','🐱','🐶','🚗','✈️','🎸','🏀'];
const $ = id => document.getElementById(id);
function play(s) { if (Sounds && Sounds.sfxEnabled()) Sounds[s](); }
function enableSound() { if (Sounds) Sounds.enable(); }

function showScreen(el) {
  $('lobby').classList.remove('active');
  $('game').classList.remove('active');
  el.classList.add('active');
}
function getName() { return $('player-name').value.trim() || 'Player'; }
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }

function startMode(m) {
  mode = m; enableSound();
  if (m === 'online') { $('online-panel').classList.remove('hidden'); $('leaderboard-panel').classList.add('hidden'); return; }
  if (m === 'ai') { $('leaderboard-panel').classList.remove('hidden'); loadLeaderboard(); }
  else $('leaderboard-panel').classList.add('hidden');
  resetLocal(); $('room-display').textContent = m === 'ai' ? '单人挑战' : '本地双人'; $('copy-btn').classList.add('hidden');
  showScreen($('game')); drawBoard(); updateTurn();
}
function showJoin() { $('join-form').classList.toggle('hidden'); }
function createRoom() { socket.emit('createRoom', { gameType: 'memory', playerName: getName(), clientId: CLIENT_ID, isPublic: $('room-public-check').checked }); }
function quickMatch() { socket.emit('quickMatch:join', { gameType: 'memory', playerName: getName(), clientId: CLIENT_ID }); }
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
  const { roomId: id, state, you, players: ps } = data;
  const privacyHint = document.getElementById('room-privacy-hint'); if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = id; mySymbol = you ? you.symbol : 2; mode = 'online'; players = ps || []; enterOnline(); applyState(state);
});
socket.on('joinedAsSpectator', ({ roomId: id, state, players: ps }) => { roomId = id; mySymbol = null; mode = 'online'; players = ps || []; enterOnline(); applyState(state); $('turn-text').textContent = '👁️ 观战'; });
socket.on('reconnected', ({ roomId: id, state, player, players: ps }) => { roomId = id; mySymbol = player ? player.symbol : 2; mode = 'online'; players = ps || []; enterOnline(); if (state) applyState(state); });
socket.on('quickMatch:found', ({ roomId: id, you, players: ps }) => { roomId = id; mySymbol = you ? you.symbol : 1; mode = 'online'; players = ps || []; enterOnline(); showError('⚡ 匹配成功！'); });
socket.on('quickMatch:waiting', () => { showError('⏳ 正在匹配对手...'); });
socket.on('memory:state', ({ state, players: ps }) => { if (ps) players = ps; applyState(state); });
socket.on('error', ({ message }) => showError(message));
socket.on('connect', () => { if (roomId) socket.emit('reconnect', { clientId: CLIENT_ID }); });
socket.on('reconnect:failed', () => { roomId = null; });

function enterOnline() { $('online-panel').classList.add('hidden'); $('join-form').classList.add('hidden'); $('copy-btn').classList.remove('hidden'); $('room-display').textContent = roomId; showScreen($('game')); }
function applyState(state) {
  roomState = state;
  $('score-p1').textContent = state.scores[0];
  $('score-p2').textContent = state.scores[1];
  const p1 = players.find(p => p.symbol === 1), p2 = players.find(p => p.symbol === 2);
  $('name-p1').textContent = (p1 ? p1.name : '等待...') + (mode === 'online' && mySymbol === 1 ? ' (你)' : '');
  $('name-p2').textContent = (p2 ? p2.name : '等待...') + (mode === 'online' && mySymbol === 2 ? ' (你)' : '');
  $('badge-p1').classList.toggle('active', state.currentPlayer === 1 && state.status === 'playing');
  $('badge-p2').classList.toggle('active', state.currentPlayer === 2 && state.status === 'playing');
  $('memory-message').textContent = state.message || '';
  drawBoard();
  updateTurn();
  if (state.status === 'finished') {
    const won = state.winner === mySymbol;
    showEnd(state.winner === null ? '平局！' : (won ? '🎉 你赢了！' : (mySymbol === null ? '比赛结束' : '😢 你输了...')));
    play(won ? 'win' : 'lose');
  } else {
    closeModal();
  }
  if (state.rematchVotes && mode === 'online' && mySymbol !== null) {
    const oppSymbol = mySymbol === 1 ? 2 : 1;
    if (state.rematchVotes[mySymbol] && state.rematchVotes[oppSymbol]) {
      $('turn-text').textContent = '双方已准备，即将重新开始...';
    } else if (state.rematchVotes[mySymbol]) {
      $('turn-text').textContent = '你已准备再来一局，等待对手...';
    }
  }
}
function updateTurn() {
  const state = mode === 'online' ? roomState : localState;
  if (state.status === 'finished') return;
  const statsEl = $('memory-stats');
  if (mode === 'ai') {
    statsEl.classList.remove('hidden');
    $('move-count').textContent = state.moves;
    $('time-count').textContent = state.startTime ? Math.floor((Date.now() - state.startTime) / 1000) : 0;
  } else statsEl.classList.add('hidden');
  if (mode === 'online') {
    if (roomState.status === 'waiting') $('turn-text').textContent = '等待对手加入...';
    else if (mySymbol === null) $('turn-text').textContent = '👁️ 观战';
    else if (roomState.currentPlayer === mySymbol) $('turn-text').textContent = '你的回合';
    else $('turn-text').textContent = '对手回合...';
  } else if (mode === 'ai') {
    $('turn-text').textContent = `已翻对 ${state.scores[0]} 对`;
  } else {
    $('turn-text').textContent = `P${state.currentPlayer} 的回合`;
  }
}

function resetLocal() {
  const icons = shuffle([...MEMORY_ICONS, ...MEMORY_ICONS]);
  localState = { cards: icons.map((icon, i) => ({ id: i, icon, flipped: false, matched: false })), currentPlayer: 1, scores: [0,0], flipped: [], locked: false, winner: null, moves: 0, startTime: 0, timerId: null };
}

function drawBoard() {
  const state = mode === 'online' ? roomState : localState;
  const el = $('memory-board'); el.innerHTML = '';
  state.cards.forEach((card, i) => {
    const cell = document.createElement('div');
    cell.className = 'memory-card' + (card.flipped || card.matched ? ' flipped' : '') + (card.matched ? ' matched' : '');
    cell.innerHTML = `<div class="memory-inner"><div class="memory-front">?</div><div class="memory-back">${card.icon}</div></div>`;
    cell.addEventListener('click', () => handleFlip(i));
    el.appendChild(cell);
  });
}
function canFlip(state, i) {
  if (state.locked || state.status === 'finished') return false;
  const card = state.cards[i];
  if (card.flipped || card.matched) return false;
  if (mode === 'ai') return state.flipped.length < 2;
  if (mode === 'local') return state.flipped.length < 2;
  if (mode === 'online') {
    if (roomState.status !== 'playing' || mySymbol === null || mySymbol !== roomState.currentPlayer) return false;
    return roomState.flipped.length < 2;
  }
  return false;
}
function handleFlip(i) {
  if (mode === 'online') {
    if (!canFlip(roomState, i)) return;
    socket.emit('memory:flip', { index: i });
    return;
  }
  const state = localState;
  if (!canFlip(state, i)) return;
  flipLocal(i);
}
function flipLocal(i) {
  const state = localState;
  const card = state.cards[i];
  card.flipped = true; state.flipped.push(i); play('place');
  if (!state.startTime) { state.startTime = Date.now(); state.timerId = setInterval(updateTurn, 1000); }
  drawBoard(); updateTurn();
  if (state.flipped.length === 2) {
    state.locked = true;
    if (mode === 'ai') state.moves++;
    const [i1, i2] = state.flipped;
    if (state.cards[i1].icon === state.cards[i2].icon) {
      setTimeout(() => {
        state.cards[i1].matched = true; state.cards[i2].matched = true;
        state.scores[state.currentPlayer - 1]++;
        state.flipped = []; state.locked = false;
        play('score');
        checkLocalEnd();
        drawBoard(); updateTurn();
      }, 400);
    } else {
      setTimeout(() => {
        state.cards[i1].flipped = false; state.cards[i2].flipped = false;
        state.flipped = []; state.locked = false;
        if (mode === 'local') state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
        drawBoard(); updateTurn();
      }, 1000);
    }
  }
}
function checkLocalEnd() {
  const state = localState;
  if (state.cards.every(c => c.matched)) {
    state.status = 'finished';
    if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
    const s1 = state.scores[0], s2 = state.scores[1];
    state.winner = mode === 'ai' ? 1 : (s1 === s2 ? null : (s1 > s2 ? 1 : 2));
    if (mode === 'ai') {
      const seconds = Math.floor((Date.now() - state.startTime) / 1000);
      const score = Math.max(0, 1000 - state.moves * 10 - seconds * 2);
      if (Auth.isLoggedIn()) Auth.submitScore('memory', score);
      showEnd(`🎉 完成！${state.moves} 步 ${seconds} 秒
得分 ${score}`);
    } else {
      const text = state.winner === null ? '平局！' : `P${state.winner} 获胜！`;
      showEnd(text);
    }
    play('win');
  }
}

function showEnd(text) { $('end-title').textContent = text; $('end-modal').classList.remove('hidden'); }
function closeModal() { $('end-modal').classList.add('hidden'); }
function resetGame() {
  closeModal();
  if (mode === 'online') socket.emit('memory:reset');
  else { resetLocal(); drawBoard(); updateTurn(); }
}
function rematchGame() {
  closeModal();
  if (mode === 'online') socket.emit('rematch');
  else resetGame();
}
function leaveGame() {
  socket.emit('leaveRoom');
  location.href = '/games/memory.html';
}
function copyLink() { if (!roomId) return; copyToClipboard(`${location.origin}/games/memory.html?room=${roomId}`, $('copy-btn'), '✅'); }

async function loadLeaderboard() {
  const el = $('leaderboard-list');
  el.textContent = '加载中...';
  try {
    const data = await Auth.getLeaderboard('memory', 10);
    const list = (data && (data.list || data.leaderboard)) || [];
    if (!list.length) { el.innerHTML = '<div style="color:#aaa;">暂无记录</div>'; return; }
    el.innerHTML = list.map((e, i) => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><span>${i+1}. ${escapeHtml(e.name)}</span><span>${e.score}</span></div>`).join('');
  } catch (e) { el.textContent = '加载失败'; }
}
function escapeHtml(t) { return t.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

window.addEventListener('DOMContentLoaded', () => {
  $('player-name').value = getDefaultName() || '';
  const p = new URLSearchParams(location.search).get('room');
  if (p) { $('room-id').value = p; $('online-panel').classList.remove('hidden'); $('join-form').classList.remove('hidden'); joinRoom(); }
});
