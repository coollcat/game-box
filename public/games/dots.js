const socket = io();
const CLIENT_ID = localStorage.getItem('gameBoxClientId') || ('c' + Math.random().toString(36).substring(2, 10));
localStorage.setItem('gameBoxClientId', CLIENT_ID);
let mode = null;
let roomId = null;
let mySymbol = 1;
let roomState = { status: 'waiting', currentPlayer: 1, scores: [0,0], edges: {0: [[0,0,0],[0,0,0],[0,0,0],[0,0,0]], 1: [[0,0,0,0],[0,0,0,0],[0,0,0,0]]}, boxes: [[0,0,0],[0,0,0],[0,0,0]], winner: null };
let localState = { status: 'playing', currentPlayer: 1, scores: [0,0], edges: {0: [[0,0,0],[0,0,0],[0,0,0],[0,0,0]], 1: [[0,0,0,0],[0,0,0,0],[0,0,0,0]]}, boxes: [[0,0,0],[0,0,0],[0,0,0]], winner: null };
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
  resetLocal(); $('room-display').textContent = m === 'ai' ? '人机' : '本地'; $('copy-btn').classList.add('hidden');
  showScreen($('game')); drawBoard(); updateTurn();
  if (mode === 'ai' && localState.currentPlayer === 2) setTimeout(aiMove, 500);
}
function showJoin() { $('join-form').classList.toggle('hidden'); }
function createRoom() { socket.emit('createRoom', { gameType: 'dots', playerName: getName(), clientId: CLIENT_ID, isPublic: $('room-public-check').checked }); }
function quickMatch() { socket.emit('quickMatch:join', { gameType: 'dots', playerName: getName(), clientId: CLIENT_ID }); }
function joinRoom() {
  const id = $('room-id').value.trim().toUpperCase();
  if (!id) return showError('请输入房间号');
  socket.emit('joinRoom', { roomId: id, playerName: getName(), clientId: CLIENT_ID });
}
function showError(msg) { $('error-msg').textContent = msg; $('error-msg').classList.remove('hidden'); setTimeout(() => $('error-msg').classList.add('hidden'), 3000); }

socket.on('roomCreated', (data) => {
  const { roomId: id, player } = data;
  const privacyHint = document.getElementById('room-privacy-hint'); if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = id; mySymbol = player.symbol; mode = 'online'; roomState.players = [{ name: player.name, symbol: player.symbol, isHost: true }]; enterOnline();
});
socket.on('joinedRoom', (data) => {
  const { roomId: id, state, you, players: ps } = data;
  const privacyHint = document.getElementById('room-privacy-hint'); if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = id; mySymbol = you ? you.symbol : 2; mode = 'online'; roomState.players = ps || []; enterOnline(); applyState(state);
});
socket.on('joinedAsSpectator', ({ roomId: id, state, players: ps }) => { roomId = id; mySymbol = null; mode = 'online'; roomState.players = ps || []; enterOnline(); applyState(state); $('turn-text').textContent = '👁️ 观战'; });
socket.on('reconnected', ({ roomId: id, state, player, players: ps }) => { roomId = id; mySymbol = player ? player.symbol : 2; mode = 'online'; roomState.players = ps || []; enterOnline(); if (state) applyState(state); });
socket.on('dots:state', ({ state, players: ps }) => { if (ps) roomState.players = ps; applyState(state); });
socket.on('quickMatch:found', ({ roomId: id, you, players: ps }) => { roomId = id; mySymbol = you ? you.symbol : 1; mode = 'online'; roomState.players = ps || []; enterOnline(); showError('⚡ 匹配成功！'); });
socket.on('quickMatch:waiting', () => { showError('⏳ 正在匹配对手...'); });
socket.on('error', ({ message }) => showError(message));
socket.on('connect', () => { if (roomId) socket.emit('reconnect', { clientId: CLIENT_ID }); });
socket.on('reconnect:failed', () => { roomId = null; });

function enterOnline() { $('online-panel').classList.add('hidden'); $('join-form').classList.add('hidden'); $('copy-btn').classList.remove('hidden'); $('room-display').textContent = roomId; showScreen($('game')); }
function applyState(state) {
  const oldPlayers = roomState.players;
  roomState = state;
  if (oldPlayers && !roomState.players) roomState.players = oldPlayers;
  $('score-p1').textContent = state.scores[0];
  $('score-p2').textContent = state.scores[1];
  updateBadges();
  drawBoard(); updateTurn();
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
function ownerSymbol(owner) {
  return owner && typeof owner === 'object' ? (owner.symbol || 0) : owner;
}
function updateBadges() {
  const p1 = roomState.players && roomState.players.find(p => p.symbol === 1);
  const p2 = roomState.players && roomState.players.find(p => p.symbol === 2);
  $('name-p1').textContent = mode === 'ai' ? '你' : (mode === 'local' ? 'P1' : (p1 ? p1.name : '等待...'));
  $('name-p2').textContent = mode === 'ai' ? 'AI' : (mode === 'local' ? 'P2' : (p2 ? p2.name : '等待...'));
  if (mode === 'online' && mySymbol !== null) {
    if (mySymbol === 1) $('name-p1').textContent += ' (你)';
    else $('name-p2').textContent += ' (你)';
  }
}
function updateTurn() {
  const state = mode === 'online' ? roomState : localState;
  if (state.status === 'finished') return;
  $('score-p1').textContent = state.scores[0];
  $('score-p2').textContent = state.scores[1];
  updateBadges();
  $('badge-p1').classList.toggle('active', state.currentPlayer === 1 && state.status === 'playing');
  $('badge-p2').classList.toggle('active', state.currentPlayer === 2 && state.status === 'playing');
  if (mode === 'online') {
    if (roomState.status === 'waiting') $('turn-text').textContent = '等待对手加入...';
    else if (mySymbol === null) $('turn-text').textContent = '👁️ 观战';
    else if (roomState.currentPlayer === mySymbol) $('turn-text').textContent = `你的回合（${mySymbol === 1 ? '🔴' : '🔵'}）`;
    else $('turn-text').textContent = `对手回合（${roomState.currentPlayer === 1 ? '🔴' : '🔵'}）...`;
  } else if (mode === 'ai') {
    $('turn-text').textContent = state.currentPlayer === 1 ? '你的回合（🔴）' : 'AI 思考中...';
  } else {
    $('turn-text').textContent = `P${state.currentPlayer} 的回合`;
  }
}

function resetLocal() {
  localState = { status: 'playing', currentPlayer: 1, scores: [0,0], edges: {0: [[0,0,0],[0,0,0],[0,0,0],[0,0,0]], 1: [[0,0,0,0],[0,0,0,0],[0,0,0,0]]}, boxes: [[0,0,0],[0,0,0],[0,0,0]], winner: null };
}

function drawBoard() {
  const state = mode === 'online' ? roomState : localState;
  const wrap = $('dots-wrap'); wrap.innerHTML = '';
  const grid = document.createElement('div'); grid.className = 'dots-grid';
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      const cell = document.createElement('div');
      if (row % 2 === 0 && col % 2 === 0) {
        cell.className = 'dots-dot';
      } else if (row % 2 === 0 && col % 2 === 1) {
        const r = row / 2, c = (col - 1) / 2;
        const owner = ownerSymbol(state.edges[0][r][c]);
        cell.className = 'dots-line h' + (owner ? ` p${owner}` : '') + (canPlayLine(state, 0, r, c) ? ' empty' : '');
        cell.dataset.dir = 0; cell.dataset.r = r; cell.dataset.c = c;
        cell.addEventListener('click', () => handleLine(0, r, c));
      } else if (row % 2 === 1 && col % 2 === 0) {
        const r = (row - 1) / 2, c = col / 2;
        const owner = ownerSymbol(state.edges[1][r][c]);
        cell.className = 'dots-line v' + (owner ? ` p${owner}` : '') + (canPlayLine(state, 1, r, c) ? ' empty' : '');
        cell.dataset.dir = 1; cell.dataset.r = r; cell.dataset.c = c;
        cell.addEventListener('click', () => handleLine(1, r, c));
      } else {
        const r = (row - 1) / 2, c = (col - 1) / 2;
        const owner = ownerSymbol(state.boxes[r][c]);
        cell.className = 'dots-box' + (owner ? ` p${owner}` : '');
        cell.textContent = owner ? (mode === 'ai' && owner === 2 ? 'AI' : `P${owner}`) : '';
      }
      grid.appendChild(cell);
    }
  }
  wrap.appendChild(grid);
}
function canPlayLine(state, dir, r, c) {
  if (state.status !== 'playing' || state.edges[dir][r][c]) return false;
  if (mode === 'local') return state.currentPlayer === localState.currentPlayer;
  if (mode === 'ai') return state.currentPlayer === 1;
  if (mode === 'online') return roomState.currentPlayer === mySymbol && mySymbol !== null;
  return false;
}
function handleLine(dir, r, c) {
  if (mode === 'online') {
    if (!canPlayLine(roomState, dir, r, c)) return;
    socket.emit('dots:line', { dir, r, c });
    return;
  }
  if (!canPlayLine(localState, dir, r, c)) return;
  makeLocalLine(dir, r, c);
}
function makeLocalLine(dir, r, c) {
  const state = localState;
  const player = state.currentPlayer;
  state.edges[dir][r][c] = player;
  const gained = checkBoxes(state, player);
  play(gained > 0 ? 'score' : 'place');
  if (gained === 0) state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
  drawBoard(); updateTurn();
  if (countLines(state) >= 24) endLocal();
  else if (mode === 'ai' && state.currentPlayer === 2 && state.status !== 'finished') setTimeout(aiMove, 600);
}
function checkBoxes(state, player) {
  let gained = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    if (state.boxes[r][c]) continue;
    if (state.edges[0][r][c] && state.edges[0][r + 1][c] && state.edges[1][r][c] && state.edges[1][r][c + 1]) {
      state.boxes[r][c] = player; state.scores[player - 1]++; gained++;
    }
  }
  return gained;
}
function countLines(state) {
  let n = 0;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) if (state.edges[0][r][c]) n++;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) if (state.edges[1][r][c]) n++;
  return n;
}
function endLocal() {
  const state = localState;
  state.status = 'finished';
  const s1 = state.scores[0], s2 = state.scores[1];
  state.winner = s1 === s2 ? null : (s1 > s2 ? 1 : 2);
  const text = state.winner === null ? '平局！' : (mode === 'ai' && state.winner === 2 ? 'AI 获胜...' : `P${state.winner} 获胜！`);
  showEnd(text);
  play(state.winner === 1 ? 'win' : 'lose');
}

function showEnd(text) { $('end-title').textContent = text; $('end-modal').classList.remove('hidden'); }
function closeModal() { $('end-modal').classList.add('hidden'); }
function resetGame() {
  closeModal();
  if (mode === 'online') socket.emit('dots:reset');
  else { resetLocal(); drawBoard(); updateTurn(); if (mode === 'ai' && localState.currentPlayer === 2) setTimeout(aiMove, 500); }
}
function rematchGame() {
  closeModal();
  if (mode === 'online') socket.emit('rematch');
  else resetGame();
}
function leaveGame() {
  socket.emit('leaveRoom');
  location.href = '/games/dots.html';
}
function copyLink() { if (!roomId) return; copyToClipboard(`${location.origin}/games/dots.html?room=${roomId}`, $('copy-btn'), '✅'); }

// ---------- Dots AI ----------
function cloneDots(state) {
  return JSON.parse(JSON.stringify(state));
}
function availableEdges(state) {
  const list = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) if (!state.edges[0][r][c]) list.push({ dir: 0, r, c });
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) if (!state.edges[1][r][c]) list.push({ dir: 1, r, c });
  return list;
}
function adjacentBoxes(dir, r, c) {
  if (dir === 0) return [[r - 1, c], [r, c]];
  return [[r, c - 1], [r, c]];
}
function countBoxSides(state, br, bc) {
  if (br < 0 || br >= 3 || bc < 0 || bc >= 3 || state.boxes[br][bc]) return -1;
  let sides = 0;
  if (state.edges[0][br][bc]) sides++;
  if (state.edges[0][br + 1][bc]) sides++;
  if (state.edges[1][br][bc]) sides++;
  if (state.edges[1][br][bc + 1]) sides++;
  return sides;
}
function boxGainIfLine(state, dir, r, c) {
  let gain = 0;
  for (const [br, bc] of adjacentBoxes(dir, r, c)) {
    if (countBoxSides(state, br, bc) === 3) gain++;
  }
  return gain;
}
function thirdSideCount(state, dir, r, c) {
  let bad = 0;
  for (const [br, bc] of adjacentBoxes(dir, r, c)) {
    if (countBoxSides(state, br, bc) === 3) bad++;
  }
  return bad;
}
function wouldOpenBoxes(state, dir, r, c) {
  // 下完这手后，相邻方格中恰好有 3 条边的数量（即给对手送分的风险）
  let open3 = 0;
  for (const [br, bc] of adjacentBoxes(dir, r, c)) {
    if (countBoxSides(state, br, bc) === 2) open3++;
  }
  return open3;
}
function evalMove(state, mv) {
  const gain = boxGainIfLine(state, mv.dir, mv.r, mv.c);
  if (gain > 0) return 1000 + gain; // 能得分优先，双格>单格
  const bad = wouldOpenBoxes(state, mv.dir, mv.r, mv.c);
  if (bad > 0) return -bad * 50; // 避免给对手创造得分格

  // 安全时优先靠近已有边（中心/连接）
  let centerScore = 0;
  const { dir, r, c } = mv;
  if (dir === 0) {
    if (state.edges[0][r][c - 1]) centerScore += 2;
    if (state.edges[0][r][c + 1]) centerScore += 2;
    if (state.edges[1][r]?.[c]) centerScore += 1;
    if (state.edges[1][r]?.[c + 1]) centerScore += 1;
    if (state.edges[1][r - 1]?.[c]) centerScore += 1;
    if (state.edges[1][r - 1]?.[c + 1]) centerScore += 1;
  } else {
    if (state.edges[1][r][c - 1]) centerScore += 2;
    if (state.edges[1][r][c + 1]) centerScore += 2;
    if (state.edges[0][r]?.[c]) centerScore += 1;
    if (state.edges[0][r + 1]?.[c]) centerScore += 1;
    if (state.edges[0][r]?.[c - 1]) centerScore += 1;
    if (state.edges[0][r + 1]?.[c - 1]) centerScore += 1;
  }
  // 偏好棋盘中心
  centerScore += (2 - Math.abs(r - 1.5)) + (2 - Math.abs(c - 1.5));
  return centerScore;
}
function aiMove() {
  const state = localState;
  if (state.status !== 'playing' || state.currentPlayer !== 2) return;
  const moves = availableEdges(state);
  if (!moves.length) return;

  // 1. 优先走任何能得分的边；若有多个，选能形成连锁得分最多的那一步
  let best = null, bestScore = -Infinity;
  for (const mv of moves) {
    const gain = boxGainIfLine(state, mv.dir, mv.r, mv.c);
    if (gain > 0) {
      let chainScore = gain;
      // 模拟走一步，若还能继续得分，粗略估计后续收益
      const sim = cloneDots(state);
      sim.edges[mv.dir][mv.r][mv.c] = 2;
      checkBoxes(sim, 2);
      const followUps = availableEdges(sim).filter(m => boxGainIfLine(sim, m.dir, m.r, m.c) > 0);
      chainScore += followUps.length * 0.3;
      if (chainScore > bestScore) { bestScore = chainScore; best = mv; }
    }
  }

  // 2. 没有直接得分时，评估安全步
  if (!best) {
    for (const mv of moves) {
      const score = evalMove(state, mv);
      if (score > bestScore) { bestScore = score; best = mv; }
    }
  }

  if (best) {
    makeLocalLine(best.dir, best.r, best.c);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  $('player-name').value = getDefaultName() || '';
  const p = new URLSearchParams(location.search).get('room');
  if (p) { $('room-id').value = p; $('online-panel').classList.remove('hidden'); $('join-form').classList.remove('hidden'); joinRoom(); }
});
