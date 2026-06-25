const socket = io();
const CLIENT_ID = localStorage.getItem('gameBoxClientId') || ('c' + Math.random().toString(36).substring(2, 10));
localStorage.setItem('gameBoxClientId', CLIENT_ID);
const $ = id => document.getElementById(id);
function play(s) { if (Sounds && Sounds.sfxEnabled()) Sounds[s](); }
function enableSound() { if (Sounds) Sounds.enable(); }

let mode = 'single';
let roomId = null;
let mySymbol = 1;
let isHost = false;
let players = [];
let roomState = null;
let canInteract = false;

// Single / local state
let localState = null;
let localTimer = null;
let localRoundStart = 0;
let currentPlayer = 1; // for local turn-based

const PORTAL_DIRS = ['up', 'down', 'left', 'right'];
const PORTAL_COLORS = [
  { key: 'red', name: '红', hex: '#ff4d4d' },
  { key: 'blue', name: '蓝', hex: '#4d96ff' },
  { key: 'green', name: '绿', hex: '#6bcb77' },
  { key: 'yellow', name: '黄', hex: '#ffd93d' }
];
const DIR_NAMES = { up: '上', down: '下', left: '左', right: '右' };

function showScreen(el) {
  $('lobby').classList.remove('active');
  $('game').classList.remove('active');
  el.classList.add('active');
}
function getName() { return $('player-name').value.trim() || 'Player'; }

function startSingle() {
  mode = 'single';
  enableSound();
  $('leaderboard-panel').classList.add('hidden');
  startLocalGame('single');
}

function startMode(m) {
  mode = m;
  enableSound();
  if (m === 'online') { $('online-panel').classList.remove('hidden'); $('leaderboard-panel').classList.add('hidden'); return; }
  $('leaderboard-panel').classList.add('hidden');
  startLocalGame(m);
}

function getCurrentRound(state, sym) {
  if (!state || state.mode !== 'multi' || !state.rounds) return { command: state ? state.command : null, doors: state ? state.doors : null };
  const progress = state.progress || { 1: 0, 2: 0 };
  const idx = progress[sym] || 0;
  if (idx >= state.rounds.length) return { command: state.command, doors: state.doors };
  return state.rounds[idx];
}

function showJoin() { $('join-form').classList.toggle('hidden'); }
function createRoom() { socket.emit('createRoom', { gameType: 'portal', playerName: getName(), clientId: CLIENT_ID, isPublic: $('room-public-check').checked }); }
function quickMatch() { socket.emit('quickMatch:join', { gameType: 'portal', playerName: getName(), clientId: CLIENT_ID }); }
function joinRoom() {
  const id = $('room-id').value.trim().toUpperCase();
  if (!id) return showError('请输入房间号');
  socket.emit('joinRoom', { roomId: id, playerName: getName(), clientId: CLIENT_ID });
}
function showError(msg) { $('error-msg').textContent = msg; $('error-msg').classList.remove('hidden'); setTimeout(() => $('error-msg').classList.add('hidden'), 3000); }

socket.on('roomCreated', (data) => {
  const privacyHint = document.getElementById('room-privacy-hint');
  if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = data.roomId; mySymbol = data.player.symbol; isHost = true; mode = 'online'; players = data.player ? [data.player] : [];
  enterOnline();
});
socket.on('joinedRoom', (data) => {
  const privacyHint = document.getElementById('room-privacy-hint');
  if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = data.roomId; mySymbol = data.you ? data.you.symbol : 2; isHost = data.you ? data.you.isHost : false; mode = 'online'; players = data.players || [];
  enterOnline();
  applyState(data.state);
});
socket.on('joinedAsSpectator', (data) => { roomId = data.roomId; mySymbol = null; mode = 'online'; players = data.players || []; enterOnline(); applyState(data.state); });
socket.on('reconnected', (data) => { roomId = data.roomId; mySymbol = data.player ? data.player.symbol : 2; isHost = data.player ? data.player.isHost : false; mode = 'online'; players = data.players || []; enterOnline(); applyState(data.state); });
socket.on('portal:state', ({ state, players: ps }) => { if (ps) players = ps; applyState(state); });
socket.on('quickMatch:found', ({ roomId: id, you, players: ps, state }) => { roomId = id; mySymbol = you ? you.symbol : 1; isHost = you ? you.isHost : false; mode = 'online'; players = ps || []; enterOnline(); applyState(state); showError('⚡ 匹配成功！'); });
socket.on('quickMatch:waiting', () => { showError('⏳ 正在匹配对手...'); });
socket.on('error', ({ message }) => showError(message));
socket.on('connect', () => { if (roomId) socket.emit('reconnect', { clientId: CLIENT_ID }); });
socket.on('reconnect:failed', () => { roomId = null; });

function enterOnline() {
  $('online-panel').classList.add('hidden');
  $('join-form').classList.add('hidden');
  $('copy-btn').classList.remove('hidden');
  $('room-display').textContent = roomId;
  showScreen($('game'));
}

function startLocalGame(m) {
  mode = m;
  $('copy-btn').classList.add('hidden');
  $('room-display').textContent = '单人';
  localState = createLocalState();
  currentPlayer = 1;
  singleStarted = false;
  showScreen($('game'));
  showSwipeToStart();
}

let singleStarted = false;
function showSwipeToStart() {
  canInteract = true;
  $('command-text').textContent = '滑动开始';
  $('command-text').innerHTML = '滑动开始<span class="hint">向任意方向滑动进入第一扇门</span>';
  $('timer-bar').style.transform = 'scaleX(1)';
  $('stat-lives-wrap').innerHTML = '<span class="life">❤️</span><span class="life">❤️</span><span class="life">❤️</span>';
  $('stat-score').textContent = '0';
  $('stat-level').textContent = '1';
  $('stat-time').textContent = '5.0';
  $('control-hint').textContent = '滑动任意方向开始游戏';
}

function createLocalState() {
  return {
    status: 'playing',
    mode: mode,
    level: 1,
    scores: [0, 0],
    lives: 3,
    timeLeft: 5,
    totalTime: 60,
    command: null,
    doors: {},
    feedback: { 1: null, 2: null },
    message: ''
  };
}

function shuffle(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function generateLocalRound() {
  const colors = shuffle(PORTAL_COLORS);
  const doors = {};
  PORTAL_DIRS.forEach((dir, idx) => { doors[dir] = colors[idx]; });
  localState.doors = doors;

  const level = mode === 'single' ? localState.level : Math.min(12, Math.floor((localState.scores[0] + localState.scores[1]) / 4) + 1);
  const types = [];
  if (level <= 2) types.push('dir');
  if (level >= 3) types.push('dir', 'not-dir');
  if (level >= 5) types.push('color');
  if (level >= 8) types.push('not-color');
  const type = types[Math.floor(Math.random() * types.length)];

  let command = { type, text: '', correct: [] };
  if (type === 'dir') {
    const target = PORTAL_DIRS[Math.floor(Math.random() * PORTAL_DIRS.length)];
    command.text = DIR_NAMES[target];
    command.correct = [target];
  } else if (type === 'not-dir') {
    const forbidden = PORTAL_DIRS[Math.floor(Math.random() * PORTAL_DIRS.length)];
    command.text = '非' + DIR_NAMES[forbidden];
    command.correct = PORTAL_DIRS.filter(d => d !== forbidden);
  } else if (type === 'color') {
    const targetColor = colors[Math.floor(Math.random() * colors.length)];
    command.text = targetColor.name;
    command.correct = PORTAL_DIRS.filter(d => doors[d].key === targetColor.key);
  } else if (type === 'not-color') {
    const pool = shuffle(PORTAL_COLORS).slice(0, 2);
    const forbiddenKeys = pool.map(c => c.key);
    command.text = '非' + pool.map(c => c.name).join('非');
    command.correct = PORTAL_DIRS.filter(d => !forbiddenKeys.includes(doors[d].key));
  }
  localState.command = command;
  localState.feedback = { 1: null, 2: null };
}

function startLocalRound() {
  generateLocalRound();
  localRoundStart = performance.now();
  canInteract = true;
  applyLocalState();
  clearInterval(localTimer);
  localTimer = setInterval(() => {
    if (!localState || localState.status !== 'playing') { clearInterval(localTimer); return; }
    const elapsed = (performance.now() - localRoundStart) / 1000;
    if (mode === 'single') {
      localState.timeLeft = Math.max(0, 5 - elapsed);
      if (localState.timeLeft <= 0) {
        clearInterval(localTimer);
        handleLocalResult(false, 'timeout');
      }
    } else {
      localState.totalTime = Math.max(0, 60 - elapsed);
      localState.timeLeft = Math.max(0, Math.min(5, localState.totalTime));
      if (localState.totalTime <= 0) {
        clearInterval(localTimer);
        endLocalMulti();
        return;
      }
      if (localState.timeLeft <= 0) {
        clearInterval(localTimer);
        handleLocalResult(false, 'timeout');
        return;
      }
    }
    updateStats();
    updateTimerBar();
  }, 100);
}

function checkAnswer(state, direction) {
  if (!state.command || !state.command.correct) return false;
  return state.command.correct.includes(direction);
}

function handleInput(direction) {
  if (mode === 'online') {
    if (!canInteract || !roomState || roomState.status !== 'playing') return;
    socket.emit('portal:move', direction);
    return;
  }
  if (!canInteract || !localState || localState.status !== 'playing') return;
  if (mode === 'single' && !singleStarted) {
    singleStarted = true;
    $('control-hint').textContent = '在上方区域滑动控制方向';
    startLocalRound();
    return;
  }
  const correct = checkAnswer(localState, direction);
  clearInterval(localTimer);
  handleLocalResult(correct, correct ? 'correct' : 'wrong', direction);
}

function resetGame() {
  closeModal();
  if (mode === 'online') socket.emit('portal:reset');
  else startLocalGame(mode);
}

function handleLocalResult(correct, feedbackType, direction) {
  canInteract = false;
  localState.feedback[currentPlayer] = feedbackType;
  showFeedback(feedbackType);
  animateAvatar(direction || (feedbackType === 'timeout' ? null : null));
  if (mode === 'single') {
    if (correct) {
      localState.scores[0]++;
      localState.level++;
      play('score');
    } else {
      localState.lives--;
      play(feedbackType === 'timeout' ? 'wrong' : 'wrong');
      if (localState.lives <= 0) {
        localState.status = 'ended';
        localState.message = `游戏结束！坚持到第 ${localState.level} 关`;
        updateStats();
        submitScore();
        showEnd(`游戏结束`, `坚持到第 ${localState.level} 关，得分 ${localState.scores[0]}`);
        return;
      }
    }
    updateStats();
    setTimeout(() => { if (localState.status === 'playing') startLocalRound(); }, 500);
    return;
  }
  // local multi
  if (correct) {
    localState.scores[currentPlayer - 1]++;
    play('score');
  } else {
    localState.scores[currentPlayer - 1]--;
    play('wrong');
  }
  currentPlayer = currentPlayer === 1 ? 2 : 1;
  updateStats();
  if (localState.totalTime <= 0) { endLocalMulti(); return; }
  setTimeout(() => { if (localState.status === 'playing') startLocalRound(); }, 400);
}

function endLocalMulti() {
  localState.status = 'ended';
  const s1 = localState.scores[0], s2 = localState.scores[1];
  let winnerText;
  if (s1 > s2) winnerText = 'P1 获胜！';
  else if (s2 > s1) winnerText = 'P2 获胜！';
  else winnerText = '平局！';
  localState.message = winnerText;
  updateStats();
  showEnd('时间到！', `P1 ${s1} 分 · P2 ${s2} 分 · ${winnerText}`);
}

function applyState(state) {
  roomState = state;
  if (!state) return;
  const round = mySymbol ? getCurrentRound(state, mySymbol) : { command: state.command, doors: state.doors };
  updateCommand(round.command);
  updateDoors(round.doors);
  updateStats();
  updateTimerBar();
  updateOpponentStats();
  if (state.feedback) {
    const myFeedback = mySymbol ? state.feedback[mySymbol] : state.feedback[1];
    if (myFeedback) showFeedback(myFeedback);
  }
  if (state.status === 'playing') {
    canInteract = true;
    closeModal();
  } else if (state.status === 'ended') {
    canInteract = false;
    let title, subtitle;
    if (state.mode === 'multi') {
      const s1 = state.scores[0], s2 = state.scores[1];
      if (mySymbol === null) {
        title = '比赛结束';
        subtitle = `P1 ${s1} 分 · P2 ${s2} 分`;
      } else {
        const won = state.winner === mySymbol;
        title = won ? '🎉 你赢了！' : (state.winner === null ? '平局！' : '😢 你输了...');
        subtitle = `你 ${state.scores[mySymbol - 1]} 分 · 对手 ${state.scores[mySymbol === 1 ? 1 : 0]} 分`;
      }
    } else {
      title = '游戏结束';
      subtitle = state.message || `坚持到第 ${state.level} 关`;
    }
    showEnd(title, subtitle);
  }
}

function applyLocalState() {
  if (!localState) return;
  updateCommand(localState.command);
  updateDoors(localState.doors);
  updateStats();
  updateTimerBar();
}

function updateCommand(command) {
  const el = $('command-text');
  if (!command) { el.textContent = '准备开始'; return; }
  el.textContent = command.text;
}

function updateDoors(doors) {
  PORTAL_DIRS.forEach(dir => {
    const el = $('door-' + dir);
    const color = doors && doors[dir];
    if (color) {
      el.style.backgroundColor = color.hex;
      el.style.color = 'rgba(0,0,0,0.75)';
      el.style.boxShadow = `0 0 24px ${color.hex}, inset 0 0 16px rgba(255,255,255,0.35)`;
    } else {
      el.style.backgroundColor = 'rgba(255,255,255,0.1)';
      el.style.color = '#fff';
      el.style.boxShadow = 'none';
    }
    el.classList.remove('pulse');
    void el.offsetWidth;
  });
}

function pulseDoor(dir) {
  const el = $('door-' + dir);
  if (!el) return;
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

function animateAvatar(direction) {
  const avatar = $('avatar');
  if (!direction) {
    avatar.style.top = '50%';
    avatar.style.left = '50%';
    avatar.style.transform = 'translate(-50%, -50%)';
    return;
  }
  avatar.classList.add('moving');
  const stage = $('portal-stage');
  const rect = stage.getBoundingClientRect();
  const offset = Math.min(rect.width, rect.height) * 0.32;
  let tx = 0, ty = 0;
  if (direction === 'up') ty = -offset;
  else if (direction === 'down') ty = offset;
  else if (direction === 'left') tx = -offset;
  else if (direction === 'right') tx = offset;
  avatar.style.top = `calc(50% + ${ty}px)`;
  avatar.style.left = `calc(50% + ${tx}px)`;
  pulseDoor(direction);
  setTimeout(() => {
    avatar.style.top = '50%';
    avatar.style.left = '50%';
    avatar.classList.remove('moving');
  }, 220);
}

function showFeedback(type) {
  const el = $('feedback');
  el.className = 'portal-feedback show ' + type;
  if (type === 'correct') el.textContent = '✅';
  else if (type === 'wrong') el.textContent = '❌';
  else el.textContent = '⏰';
  setTimeout(() => el.classList.remove('show'), 350);
}

function updateStats() {
  const state = mode === 'online' ? roomState : localState;
  if (!state) return;
  $('stat-mode').textContent = state.mode === 'multi' ? '在线对战' : '单人挑战';
  $('stat-level').textContent = state.level || 1;
  if (state.mode === 'multi' && mySymbol) {
    const myScore = state.scores[mySymbol - 1] || 0;
    const myLives = state.multiLives ? (state.multiLives[mySymbol] || 0) : 0;
    const myProgress = state.progress ? (state.progress[mySymbol] || 0) : 0;
    $('stat-score').textContent = myScore;
    $('stat-level-wrap').style.display = 'none';
    $('stat-lives-wrap').style.display = 'flex';
    let hearts = '';
    for (let i = 0; i < 3; i++) hearts += `<span class="life ${i < myLives ? '' : 'lost'}">❤️</span>`;
    $('stat-lives-wrap').innerHTML = hearts;
    const t = state.totalTime ? state.totalTime.toFixed(1) : (state.timeLeft ? state.timeLeft.toFixed(1) : '0.0');
    $('stat-time-wrap').innerHTML = `时间:<b id="stat-time">${t}</b>s`;
  } else {
    $('stat-score').textContent = state.scores[0];
    if (state.mode === 'single') {
      $('stat-level-wrap').style.display = 'inline';
      $('stat-lives-wrap').style.display = 'flex';
      let hearts = '';
      for (let i = 0; i < 3; i++) hearts += `<span class="life ${i < state.lives ? '' : 'lost'}">❤️</span>`;
      $('stat-lives-wrap').innerHTML = hearts;
      $('stat-time-wrap').innerHTML = `时间:<b id="stat-time">${state.timeLeft ? state.timeLeft.toFixed(1) : '0.0'}</b>s`;
    } else {
      $('stat-level-wrap').style.display = 'none';
      $('stat-lives-wrap').style.display = 'none';
      const t = state.totalTime ? state.totalTime.toFixed(1) : (state.timeLeft ? state.timeLeft.toFixed(1) : '0.0');
      $('stat-time-wrap').innerHTML = `时间:<b id="stat-time">${t}</b>s`;
    }
  }
}

function updateOpponentStats() {
  const state = roomState;
  if (!state || state.mode !== 'multi' || !mySymbol) {
    $('opponent-stats').style.display = 'none';
    return;
  }
  const oppSym = mySymbol === 1 ? 2 : 1;
  const opp = players.find(p => p.symbol === oppSym);
  const oppScore = state.scores[oppSym - 1] || 0;
  const oppLives = state.multiLives ? (state.multiLives[oppSym] || 0) : 0;
  const oppProgress = state.progress ? (state.progress[oppSym] || 0) : 0;
  $('opp-name').textContent = opp ? opp.name : `P${oppSym}`;
  $('opp-score').textContent = oppScore;
  $('opp-progress').textContent = oppProgress;
  let hearts = '';
  for (let i = 0; i < 3; i++) hearts += `<span class="life ${i < oppLives ? '' : 'lost'}">❤️</span>`;
  $('opp-lives').innerHTML = hearts;
  $('opponent-stats').style.display = 'flex';
}

function updateTimerBar() {
  const state = mode === 'online' ? roomState : localState;
  if (!state) return;
  const bar = $('timer-bar');
  let pct = 100;
  if (state.mode === 'single') {
    pct = state.timeLeft ? (state.timeLeft / 5) * 100 : 0;
  } else {
    pct = state.totalTime ? (state.totalTime / 60) * 100 : 0;
  }
  bar.style.transform = `scaleX(${Math.max(0, Math.min(100, pct)) / 100})`;
}

function resetGame() {
  closeModal();
  if (mode === 'online') socket.emit('portal:reset');
  else startLocalGame(mode);
}
function rematchGame() {
  closeModal();
  if (mode === 'online') socket.emit('rematch');
  else resetGame();
}
function leaveGame() {
  clearInterval(localTimer);
  socket.emit('leaveRoom');
  location.href = '/games/portal.html';
}
function closeModal() { $('end-modal').classList.add('hidden'); }
function showEnd(title, subtitle) {
  $('end-title').textContent = title;
  $('end-subtitle').textContent = subtitle;
  $('end-modal').classList.remove('hidden');
}
function copyLink() { if (!roomId) return; copyToClipboard(`${location.origin}/games/portal.html?room=${roomId}`, $('copy-btn'), '✅'); }

// Keyboard
window.addEventListener('keydown', e => {
  if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') handleInput('up');
  else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') handleInput('down');
  else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') handleInput('left');
  else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') handleInput('right');
});

// Swipe
let touchStartX = 0, touchStartY = 0;
const stage = document.getElementById('portal-stage');
stage.addEventListener('touchstart', e => {
  touchStartX = e.changedTouches[0].clientX;
  touchStartY = e.changedTouches[0].clientY;
}, { passive: true });
stage.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  const dy = e.changedTouches[0].clientY - touchStartY;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
  if (Math.abs(dx) > Math.abs(dy)) handleInput(dx > 0 ? 'right' : 'left');
  else handleInput(dy > 0 ? 'down' : 'up');
}, { passive: true });

function escapeHtml(t) { return String(t).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

async function loadLeaderboard() {
  const el = $('leaderboard-list');
  el.textContent = '加载中...';
  try {
    const data = await Auth.getLeaderboard('portal', 10);
    const list = (data && (data.list || data.leaderboard)) || [];
    $('leaderboard-login-hint').classList.toggle('hidden', Auth.isLoggedIn());
    if (!list.length) { el.innerHTML = '<div style="color:#aaa;">暂无记录</div>'; return; }
    el.innerHTML = list.map((e, i) => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><span>${i+1}. ${escapeHtml(e.name)}</span><span>${e.score}</span></div>`).join('');
  } catch (e) { el.textContent = '加载失败'; }
}

async function submitScore() {
  if (!Auth.isLoggedIn() || !localState || mode !== 'single') return;
  try {
    await Auth.submitScore('portal', localState.scores[0]);
    loadLeaderboard();
  } catch (e) { console.error('submit score failed', e); }
}

window.addEventListener('DOMContentLoaded', () => {
  $('player-name').value = getDefaultName() || '';
  loadLeaderboard();
  const p = new URLSearchParams(location.search).get('room');
  if (p) { $('room-id').value = p; $('online-panel').classList.remove('hidden'); $('join-form').classList.remove('hidden'); $('leaderboard-panel').classList.add('hidden'); joinRoom(); }
});
