const socket = io();
const CLIENT_ID = localStorage.getItem('gameBoxClientId') || ('c' + Math.random().toString(36).substring(2, 10));
localStorage.setItem('gameBoxClientId', CLIENT_ID);
const RPS_TARGET = 2;
const RPS_MAX_ROUNDS = 3;
let mode = null;
let roomId = null;
let mySymbol = 1;
let roomState = { status: 'waiting', round: 1, scores: [0,0], choices: {1:null,2:null}, result: null, winner: null };
let localState = { status: 'choosing', round: 1, scores: [0,0], choices: {1:null,2:null}, result: null, winner: null };
let players = [];
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
  if (m === 'online') { $('online-panel').classList.remove('hidden'); return; }
  if (m === 'ai') { resetLocal(); $('room-display').textContent = '人机'; $('copy-btn').classList.add('hidden'); showScreen($('game')); applyLocalState(); }
}
function quickMatch() { socket.emit('quickMatch:join', { gameType: 'rps', playerName: getName(), clientId: CLIENT_ID }); }
function resetLocal() {
  localState = { status: 'choosing', round: 1, scores: [0,0], choices: {1:null,2:null}, result: null, winner: null };
}
function applyLocalState() {
  $('name-p1').textContent = '你';
  $('name-p2').textContent = 'AI';
  $('score-p1').textContent = localState.scores[0];
  $('score-p2').textContent = localState.scores[1];
  $('round-num').textContent = localState.round;
  updateHandsLocal();
  updateMessageLocal();
  updateControlsLocal();
  updateBadgesLocal();
}
function updateBadgesLocal() {
  $('badge-p1').classList.toggle('active', localState.status === 'choosing' && !localState.choices[1]);
  $('badge-p2').classList.toggle('active', localState.status === 'choosing' && !localState.choices[2]);
}
function updateHandsLocal() {
  const hideDuringChoosing = localState.status === 'choosing';
  const h1 = hideDuringChoosing ? (localState.choices[1] ? '✅' : '❔') : (localState.choices[1] || '❔');
  const h2 = hideDuringChoosing ? (localState.choices[2] ? '✅' : '❔') : (localState.choices[2] || '❔');
  $('hand-p1').textContent = h1;
  $('hand-p2').textContent = h2;
}
function updateMessageLocal() {
  const el = $('rps-message');
  if (localState.status === 'choosing') {
    el.textContent = localState.choices[1] ? '已出拳，等待 AI...' : '请出拳！（三局两胜）';
  } else if (localState.status === 'result') {
    const res = localState.result;
    let text = res === 0 ? '平局！' : res === 1 ? '你赢了本轮！' : '你输了本轮...';
    el.textContent = `${text} 当前比分 ${localState.scores[0]} : ${localState.scores[1]}，下一轮自动开始...`;
  } else if (localState.status === 'finished') {
    if (localState.winner === 0) el.textContent = `🏆 比赛结束：平局！比分 ${localState.scores[0]} : ${localState.scores[1]}`;
    else el.textContent = `🏆 比赛结束：${localState.winner === 1 ? '你' : 'AI'} 获胜！比分 ${localState.scores[0]} : ${localState.scores[1]}`;
  }
}
function updateControlsLocal() {
  const isChoosing = localState.status === 'choosing';
  const canPick = isChoosing && !localState.choices[1];
  document.querySelectorAll('.rps-btn').forEach(btn => {
    btn.disabled = !canPick;
    btn.classList.toggle('hidden', !isChoosing);
  });
}
function makeLocalChoice(choice) {
  if (mode !== 'ai' || localState.status !== 'choosing' || localState.choices[1]) return;
  localState.choices[1] = choice;
  play('place');
  updateHandsLocal(); updateMessageLocal(); updateControlsLocal(); updateBadgesLocal();
  setTimeout(() => {
    const aiChoice = ['✊','✂️','🖐️'][Math.floor(Math.random()*3)];
    localState.choices[2] = aiChoice;
    updateHandsLocal();
    const res = rpsJudge(choice, aiChoice);
    localState.result = res === 1 ? 1 : res === -1 ? 2 : 0;
    if (localState.result !== 0) localState.scores[localState.result - 1]++;
    localState.status = 'result';
    updateMessageLocal();
    updateControlsLocal();
    updateBadgesLocal();
    play(res === 1 ? 'win' : res === -1 ? 'lose' : 'place');

    const finished = localState.scores[0] >= RPS_TARGET || localState.scores[1] >= RPS_TARGET || localState.round >= RPS_MAX_ROUNDS;
    if (finished) {
      localState.winner = localState.scores[0] > localState.scores[1] ? 1 : localState.scores[0] < localState.scores[1] ? 2 : 0;
      localState.status = 'finished';
      updateMessageLocal();
      updateControlsLocal();
      const title = localState.winner === 0 ? '🤝 平局！' : localState.winner === 1 ? '🎉 你赢了！' : '😢 你输了...';
      setTimeout(() => showEnd(title), 700);
    } else {
      setTimeout(() => {
        localState.round++;
        localState.choices = {1:null,2:null};
        localState.result = null;
        localState.status = 'choosing';
        applyLocalState();
      }, 1400);
    }
  }, 500);
}
function rpsJudge(a, b) { if (a === b) return 0; if ((a === '✊' && b === '✂️') || (a === '✂️' && b === '🖐️') || (a === '🖐️' && b === '✊')) return 1; return -1; }
function showJoin() { $('join-form').classList.toggle('hidden'); }
function createRoom() { socket.emit('createRoom', { gameType: 'rps', playerName: getName(), clientId: CLIENT_ID, isPublic: $('room-public-check').checked }); }
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
socket.on('rps:state', ({ state, players: ps }) => { if (ps) players = ps; applyState(state); });
socket.on('error', ({ message }) => showError(message));
socket.on('connect', () => { if (roomId) socket.emit('reconnect', { clientId: CLIENT_ID }); });
socket.on('reconnect:failed', () => { roomId = null; });

function enterOnline() { $('online-panel').classList.add('hidden'); $('join-form').classList.add('hidden'); $('copy-btn').classList.remove('hidden'); $('room-display').textContent = roomId; showScreen($('game')); }
function applyState(state) {
  roomState = state;
  $('round-num').textContent = state.round;
  $('score-p1').textContent = state.scores[0];
  $('score-p2').textContent = state.scores[1];
  updateBadges();
  updateHands(state);
  updateMessage(state);
  updateControls(state);
  if (state.status === 'finished') {
    let title;
    if (state.winner === 0) title = '🤝 平局！';
    else if (mySymbol === null) title = '比赛结束';
    else title = state.winner === mySymbol ? '🎉 你赢了！' : '😢 你输了...';
    showEnd(title);
    play(state.winner === mySymbol ? 'win' : (state.winner === 0 ? 'place' : 'lose'));
  } else {
    closeModal();
  }
  if (state.rematchVotes && mode === 'online' && mySymbol !== null) {
    const oppSymbol = mySymbol === 1 ? 2 : 1;
    if (state.rematchVotes[mySymbol] && state.rematchVotes[oppSymbol]) {
      $('rps-message').textContent = '双方已准备，即将重新开始...';
    } else if (state.rematchVotes[mySymbol]) {
      $('rps-message').textContent = '你已准备再来一局，等待对手...';
    }
  }
}
function updateBadges() {
  const state = roomState;
  const p1 = players.find(p => p.symbol === 1), p2 = players.find(p => p.symbol === 2);
  $('name-p1').textContent = p1 ? p1.name : '等待...';
  $('name-p2').textContent = p2 ? p2.name : '等待...';
  if (mode !== 'ai' && mySymbol !== null) {
    if (mySymbol === 1) $('name-p1').textContent += ' (你)';
    else $('name-p2').textContent += ' (你)';
  }
  $('badge-p1').classList.toggle('active', state.status !== 'waiting' && (!p2 || state.choices[1]));
  $('badge-p2').classList.toggle('active', state.status !== 'waiting' && (!p1 || state.choices[2]));
}
function updateHands(state) {
  const hideDuringChoosing = state.status === 'choosing';
  const h1 = hideDuringChoosing ? (state.choices[1] ? '✅' : '❔') : (state.choices[1] || '❔');
  const h2 = hideDuringChoosing ? (state.choices[2] ? '✅' : '❔') : (state.choices[2] || '❔');
  $('hand-p1').textContent = h1;
  $('hand-p2').textContent = h2;
}
function updateMessage(state) {
  const el = $('rps-message');
  if (state.status === 'waiting') el.textContent = '等待对手加入...';
  else if (state.status === 'choosing') {
    if (mySymbol === null) el.textContent = '观战中';
    else if (state.choices[mySymbol]) el.textContent = '已出拳，等待对手...';
    else el.textContent = '请出拳！（三局两胜，出拳后不可更改）';
  } else if (state.status === 'result') {
    const res = state.result;
    let text;
    if (res === 0) text = '平局！';
    else if (mySymbol === null) text = `${players.find(p => p.symbol === res)?.name || 'P'+res} 赢得本轮`;
    else text = res === mySymbol ? '你赢了本轮！' : '你输了本轮...';
    el.textContent = `${text} 当前比分 ${state.scores[0]} : ${state.scores[1]}，下一轮自动开始...`;
    if (res !== 0 && mySymbol !== null) play(res === mySymbol ? 'win' : 'lose');
  } else if (state.status === 'finished') {
    if (state.winner === 0) el.textContent = `🏆 比赛结束：平局！比分 ${state.scores[0]} : ${state.scores[1]}`;
    else {
      const winnerName = players.find(p => p.symbol === state.winner)?.name || `P${state.winner}`;
      el.textContent = `🏆 比赛结束：${winnerName} 获胜！比分 ${state.scores[0]} : ${state.scores[1]}`;
    }
  }
}
function updateControls(state) {
  const canPick = state.status === 'choosing' && mySymbol !== null && !state.choices[mySymbol];
  document.querySelectorAll('.rps-btn').forEach(btn => {
    btn.disabled = !canPick;
    btn.classList.toggle('hidden', state.status !== 'choosing');
  });
}

document.querySelectorAll('.rps-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    if (mode === 'ai') makeLocalChoice(btn.dataset.choice);
    else { socket.emit('rps:choice', { choice: btn.dataset.choice }); play('place'); }
  });
});

function showEnd(text) { $('end-title').textContent = text; $('end-modal').classList.remove('hidden'); }
function closeModal() { $('end-modal').classList.add('hidden'); }
function resetGame() {
  closeModal();
  if (mode === 'ai') { resetLocal(); applyLocalState(); }
}
function rematchGame() {
  closeModal();
  if (mode === 'online') socket.emit('rematch');
  else resetGame();
}
function leaveGame() {
  socket.emit('leaveRoom');
  location.href = '/games/rps.html';
}
function copyLink() { if (!roomId) return; copyToClipboard(`${location.origin}/games/rps.html?room=${roomId}`, $('copy-btn'), '✅'); }

window.addEventListener('DOMContentLoaded', () => {
  $('player-name').value = getDefaultName() || '';
  const p = new URLSearchParams(location.search).get('room');
  if (p) { $('room-id').value = p; $('online-panel').classList.remove('hidden'); $('join-form').classList.remove('hidden'); joinRoom(); }
});
