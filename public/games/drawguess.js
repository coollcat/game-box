const socket = io();
const CLIENT_ID = localStorage.getItem('gameBoxClientId') || ('c' + Math.random().toString(36).substring(2, 10));
localStorage.setItem('gameBoxClientId', CLIENT_ID);
let mode = null;
let roomId = null;
let mySymbol = null;
let isHost = false;
let currentAudio = null;
let lastSubmittedRound = 0;
let roomState = {};
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
  if (m === 'online') { $('online-panel').classList.remove('hidden'); $('leaderboard-panel').classList.add('hidden'); }
  else { $('leaderboard-panel').classList.remove('hidden'); loadLeaderboard(); socket.emit('createRoom', { gameType: 'drawguess', playerName: getName(), clientId: CLIENT_ID }); }
}
function showJoin() { $('join-form').classList.toggle('hidden'); }
function createRoom() { socket.emit('createRoom', { gameType: 'drawguess', playerName: getName(), clientId: CLIENT_ID, isPublic: $('room-public-check').checked }); }
function quickMatch() { socket.emit('quickMatch:join', { gameType: 'drawguess', playerName: getName(), clientId: CLIENT_ID }); }
function joinRoom() {
  const id = $('room-id').value.trim().toUpperCase();
  if (!id) return showError('请输入房间号');
  socket.emit('joinRoom', { roomId: id, playerName: getName(), clientId: CLIENT_ID });
}
function showError(msg) { $('error-msg').textContent = msg; $('error-msg').classList.remove('hidden'); setTimeout(() => $('error-msg').classList.add('hidden'), 3000); }

socket.on('roomCreated', (data) => {
  const { roomId: id, player } = data;
  const privacyHint = document.getElementById('room-privacy-hint'); if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = id; mySymbol = player.symbol; isHost = true; mode = mode || 'online';
  enterGame();
});
socket.on('joinedRoom', (data) => {
  const { roomId: id, you } = data;
  const privacyHint = document.getElementById('room-privacy-hint'); if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = id; mySymbol = you ? you.symbol : 2; isHost = you ? you.isHost : false; mode = 'online';
  enterGame();
});
socket.on('joinedAsSpectator', ({ roomId: id }) => {
  roomId = id; mySymbol = null; isHost = false; mode = 'online'; enterGame();
});
socket.on('reconnected', ({ roomId: id, player }) => {
  roomId = id; mySymbol = player ? player.symbol : 2; isHost = player ? player.isHost : false; mode = 'online';
  enterGame();
});
socket.on('quickMatch:found', ({ roomId: id, you }) => { roomId = id; mySymbol = you ? you.symbol : 1; isHost = you ? you.isHost : false; mode = 'online'; enterGame(); showError('⚡ 匹配成功！'); });
socket.on('quickMatch:waiting', () => { showError('⏳ 正在匹配对手...'); });
socket.on('drawguess:state', ({ state }) => applyState(state));
socket.on('drawguess:hint', ({ hint }) => {
  const el = $('hint-text');
  if (el) el.textContent = hint ? `💡 ${hint}` : '';
});
socket.on('error', ({ message }) => showError(message));
socket.on('connect', () => { if (roomId) socket.emit('reconnect', { clientId: CLIENT_ID }); });
socket.on('reconnect:failed', () => { roomId = null; });

function enterGame() {
  $('online-panel').classList.add('hidden');
  $('join-form').classList.add('hidden');
  $('room-display').textContent = roomId;
  if (mode === 'single') { $('room-display').textContent = '单人'; $('copy-btn').classList.add('hidden'); }
  showScreen($('game'));
  if (mode === 'single') startRound();
}

function applyState(state) {
  roomState = state;
  const img = $('draw-image');
  const errorEl = $('image-error');
  if (state.loading) {
    $('loading').classList.remove('hidden');
    img.classList.add('hidden');
    errorEl.classList.add('hidden');
    img.onerror = null;
    img.onload = null;
  } else {
    $('loading').classList.add('hidden');
    if (state.imageUrl) {
      errorEl.classList.add('hidden');
      img.classList.remove('hidden');
      img.onerror = () => {
        img.classList.add('hidden');
        errorEl.classList.remove('hidden');
        errorEl.textContent = '图片加载失败，请重新开始或检查网络。';
      };
      img.onload = () => { errorEl.classList.add('hidden'); };
      if (img.src !== state.imageUrl) img.src = state.imageUrl;
      const preload = new Image();
      preload.crossOrigin = 'anonymous';
      preload.src = state.imageUrl;
    } else {
      img.classList.add('hidden');
      img.onerror = null;
      img.onload = null;
      if (!state.loading) {
        errorEl.classList.remove('hidden');
        errorEl.textContent = '未获取到图片，请重新开始。';
      }
    }
  }
  $('category-text').textContent = state.category ? `类别：${state.category}` : '等待开始...';
  const hintText = $('hint-text');
  if (state.status !== 'playing') {
    hintText.textContent = '';
    hintText.dataset.round = '';
  } else if (state.round && state.round !== (hintText.dataset.round || '')) {
    hintText.textContent = '';
    hintText.dataset.round = state.round;
  }
  $('score-1').textContent = state.scores[1] || 0;
  $('score-2').textContent = state.scores[2] || 0;
  $('round-text').textContent = `第 ${state.round || 1} / ${state.maxRounds || 5} 轮`;
  $('message-text').textContent = state.message || '看 AI 画的图，输入成语！';

  if (state.audio && state.audio !== currentAudio) {
    currentAudio = state.audio;
    setTimeout(playClue, 300);
  }

  const list = $('guess-list');
  list.innerHTML = '';
  (state.guesses || []).slice().reverse().forEach(g => {
    const div = document.createElement('div');
    div.textContent = `${g.player}: ${g.guess}`;
    list.appendChild(div);
  });

  const input = $('guess-input');
  if (state.status !== 'playing' || mySymbol === null) {
    input.disabled = true;
    input.placeholder = state.status === 'ended' ? '本轮已结束' : '等待开始...';
  } else {
    input.disabled = false;
    input.placeholder = '输入成语...';
    input.focus();
  }

  const hintBtn = $('hint-btn');
  if (state.status === 'playing' && mySymbol !== null) {
    hintBtn.disabled = false;
  } else {
    hintBtn.disabled = true;
  }

  if (state.status === 'finished') $('start-btn').textContent = '🔁 重新开始';
  else $('start-btn').textContent = isHost ? '▶️ 开始 / 下一轮' : '等待房主...';
  $('start-btn').disabled = !isHost;

  if (state.message && state.message.includes('猜对了')) {
    play('correct');
    if (Auth.isLoggedIn() && state.round && state.round !== lastSubmittedRound) {
      lastSubmittedRound = state.round;
      const correctGuesses = (state.scores[mySymbol] || 0);
      Auth.submitScore('drawguess', correctGuesses);
    }
  }
  if (state.message && state.message.includes('猜错')) play('wrong');

  if (state.rematchVotes && mode === 'online' && mySymbol !== null) {
    const oppSymbol = mySymbol === 1 ? 2 : 1;
    if (state.rematchVotes[mySymbol] && state.rematchVotes[oppSymbol]) {
      $('message-text').textContent = '双方已准备，即将重新开始...';
    } else if (state.rematchVotes[mySymbol]) {
      $('message-text').textContent = '你已准备再来一局，等待对手...';
    }
  }
}

function startRound() {
  if (mode === 'online' && (roomState.status === 'finished' || roomState.status === 'ended')) {
    socket.emit('drawguess:next');
    return;
  }
  if (mode === 'single' || isHost) socket.emit('drawguess:start');
}
function submitGuess() {
  const input = $('guess-input');
  const guess = input.value.trim();
  if (!guess) return;
  socket.emit('drawguess:guess', { guess });
  input.value = '';
}
$('guess-input').addEventListener('keypress', e => { if (e.key === 'Enter') submitGuess(); });
function playClue() { if (!currentAudio) return; const a = new Audio(currentAudio); a.play().catch(e=>{}); }
function useHint() {
  if (mySymbol === null) return;
  socket.emit('drawguess:hint');
}
function copyLink() {
  if (!roomId) return;
  copyToClipboard(`${location.origin}/games/drawguess.html?room=${roomId}`, $('copy-btn'), '✅');
}
function leaveGame() {
  socket.emit('leaveRoom');
  location.href = '/games/drawguess.html';
}

async function loadLeaderboard() {
  const el = $('leaderboard-list');
  el.textContent = '加载中...';
  try {
    const data = await Auth.getLeaderboard('drawguess', 10);
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
