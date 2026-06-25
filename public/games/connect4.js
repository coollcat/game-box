const socket = io();
const CLIENT_ID = localStorage.getItem('gameBoxClientId') || ('c' + Math.random().toString(36).substring(2, 10));
localStorage.setItem('gameBoxClientId', CLIENT_ID);
let mode = null;
let roomId = null;
let mySymbol = 1;
let board = Array(6).fill(0).map(() => Array(7).fill(0));
let currentPlayer = 1;
let firstPlayer = 1;
let gameOver = false;
let roomState = { status: 'playing' };
let players = [];
const ROWS = 6, COLS = 7;
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
  showScreen($('game')); drawBoard(); updateTurn(); updateBadges();
  if (mode === 'ai' && currentPlayer === 2) setTimeout(aiMove, 400);
}
function showJoin() { $('join-form').classList.toggle('hidden'); }
function createRoom() { socket.emit('createRoom', { gameType: 'connect4', playerName: getName(), clientId: CLIENT_ID, isPublic: $('room-public-check').checked }); }
function quickMatch() { socket.emit('quickMatch:join', { gameType: 'connect4', playerName: getName(), clientId: CLIENT_ID }); }
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
socket.on('connect4:state', ({ state, players: ps }) => { if (ps) players = ps; applyState(state); });
socket.on('error', ({ message }) => showError(message));
socket.on('connect', () => { if (roomId) socket.emit('reconnect', { clientId: CLIENT_ID }); });
socket.on('reconnect:failed', () => { roomId = null; });

function enterOnline() { $('online-panel').classList.add('hidden'); $('join-form').classList.add('hidden'); $('copy-btn').classList.remove('hidden'); $('room-display').textContent = roomId; updateBadges(); showScreen($('game')); }
function applyState(state) {
  roomState = state; board = state.board; currentPlayer = state.currentPlayer; firstPlayer = state.firstPlayer || 1; gameOver = state.gameOver;
  drawBoard(); updateTurn(); updateBadges();
  if (gameOver) {
    if (state.winner) showEnd(state.winner === mySymbol ? '你赢了!' : (mySymbol === null ? '比赛结束' : '你输了...'));
    else showEnd('平局!');
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
function updateBadges() {
  const p1 = players.find(p => p.symbol === 1), p2 = players.find(p => p.symbol === 2);
  $('name-p1').textContent = mode === 'ai' ? '你' : (mode === 'local' ? '玩家 🔴' : (p1 ? p1.name : '等待...'));
  $('name-p2').textContent = mode === 'ai' ? 'AI' : (mode === 'local' ? '玩家 🟡' : (p2 ? p2.name : '等待...'));
  if (mode === 'online' && mySymbol !== null) {
    if (mySymbol === 1) $('name-p1').textContent += ' (你)';
    else $('name-p2').textContent += ' (你)';
  }
  $('badge-p1').classList.toggle('active', currentPlayer === 1 && !gameOver && (mode !== 'online' || roomState.status === 'playing'));
  $('badge-p2').classList.toggle('active', currentPlayer === 2 && !gameOver && (mode !== 'online' || roomState.status === 'playing'));
}
function updateTurn() {
  if (gameOver) return;
  if (mode === 'ai') $('turn-text').textContent = currentPlayer === 1 ? '你的回合（🔴）' : 'AI 思考中...';
  else if (mode === 'local') $('turn-text').textContent = currentPlayer === 1 ? '🔴 回合' : '🟡 回合';
  else if (roomState.status === 'waiting') $('turn-text').textContent = '等待对手加入...';
  else {
    if (mySymbol === null) $('turn-text').textContent = '观战中';
    else if (mySymbol === currentPlayer) $('turn-text').textContent = `你的回合（${mySymbol === 1 ? '🔴' : '🟡'}）`;
    else $('turn-text').textContent = '对手回合...';
  }
}
function resetLocal() { board = Array(ROWS).fill(0).map(() => Array(COLS).fill(0)); firstPlayer = firstPlayer === 1 ? 2 : 1; currentPlayer = firstPlayer; gameOver = false; }

function drawBoard() {
  const el = $('connect-board'); el.innerHTML = '';
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const cell = document.createElement('div');
    cell.className = 'connect-cell' + (board[r][c] === 1 ? ' p1' : board[r][c] === 2 ? ' p2' : '');
    if (board[0][c] === 0 && canInteract()) {
      cell.classList.add('empty');
      cell.addEventListener('click', () => handleDrop(c));
    }
    el.appendChild(cell);
  }
}
function canInteract() {
  if (gameOver) return false;
  if (mode === 'online') {
    if (roomState.status !== 'playing') return false;
    if (mySymbol === null) return false;
    if (mySymbol !== currentPlayer) return false;
  }
  if (mode === 'ai' && currentPlayer !== 1) return false;
  return true;
}
function handleDrop(col) {
  if (!canInteract()) return;
  const row = getNextOpenRow(board, col);
  if (row < 0) return;
  if (mode === 'local') dropPiece(row, col, currentPlayer);
  else if (mode === 'ai') dropPiece(row, col, 1);
  else if (mode === 'online') socket.emit('connect4:drop', { col });
}
function dropPiece(row, col, player) {
  if (board[row][col] !== 0 || gameOver) return;
  board[row][col] = player; play('place');
  if (checkWin(player)) { gameOver = true; updateTurn(); showEnd(player === 1 ? '🔴 胜利!' : '🟡 胜利!'); play('win'); }
  else if (board[0].every((_, c) => board[0][c] !== 0)) { gameOver = true; updateTurn(); showEnd('平局!'); }
  else { currentPlayer = currentPlayer === 1 ? 2 : 1; updateTurn(); if (mode === 'ai' && currentPlayer === 2) setTimeout(aiMove, 400); }
  drawBoard();
}
function getNextOpenRow(b, col) { for (let r = ROWS - 1; r >= 0; r--) if (b[r][col] === 0) return r; return -1; }
function checkWin(player) {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS - 3; c++) if (b(r,c)===player && b(r,c+1)===player && b(r,c+2)===player && b(r,c+3)===player) return true;
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS - 3; r++) if (b(r,c)===player && b(r+1,c)===player && b(r+2,c)===player && b(r+3,c)===player) return true;
  for (let r = 0; r < ROWS - 3; r++) for (let c = 0; c < COLS - 3; c++) if (b(r,c)===player && b(r+1,c+1)===player && b(r+2,c+2)===player && b(r+3,c+3)===player) return true;
  for (let r = 3; r < ROWS; r++) for (let c = 0; c < COLS - 3; c++) if (b(r,c)===player && b(r-1,c+1)===player && b(r-2,c+2)===player && b(r-3,c+3)===player) return true;
  return false;
}
function b(r,c) { return board[r][c]; }
function showEnd(text) { $('end-title').textContent = text; $('end-modal').classList.remove('hidden'); }
function closeModal() { $('end-modal').classList.add('hidden'); }
function resetGame() {
  closeModal();
  if (mode === 'online') socket.emit('connect4:reset');
  else { resetLocal(); drawBoard(); updateTurn(); if (mode === 'ai' && currentPlayer === 2) setTimeout(aiMove, 400); }
}
function rematchGame() {
  closeModal();
  if (mode === 'online') socket.emit('rematch');
  else resetGame();
}
function leaveGame() {
  socket.emit('leaveRoom');
  location.href = '/games/connect4.html';
}
function copyLink() { if (!roomId) return; copyToClipboard(`${location.origin}/games/connect4.html?room=${roomId}`, $('copy-btn'), '✅'); }

// Heuristic AI
function aiMove() {
  if (gameOver) return;
  const col = pickBestMove(board, 2);
  if (col !== null) dropPiece(getNextOpenRow(board, col), col, 2);
}
function pickBestMove(b, player) {
  const opp = player === 1 ? 2 : 1;
  for (let c = 0; c < COLS; c++) {
    const r = getNextOpenRow(b, c);
    if (r < 0) continue;
    b[r][c] = player; if (checkWin(player)) { b[r][c] = 0; return c; } b[r][c] = 0;
    b[r][c] = opp; if (checkWin(opp)) { b[r][c] = 0; return c; } b[r][c] = 0;
  }
  const [col] = minimax(b, 4, -Infinity, Infinity, true);
  return col;
}
function validLocations(b) { const locs = []; for (let c = 0; c < COLS; c++) if (b[0][c] === 0) locs.push(c); return locs; }
function scoreWindow(w, player) {
  const opp = player === 1 ? 2 : 1;
  let score = 0;
  const pc = w.filter(x => x === player).length;
  const oc = w.filter(x => x === opp).length;
  const ec = w.filter(x => x === 0).length;
  if (pc === 4) score += 100; else if (pc === 3 && ec === 1) score += 5; else if (pc === 2 && ec === 2) score += 2;
  if (oc === 3 && ec === 1) score -= 4;
  return score;
}
function scorePosition(b, player) {
  let score = 0;
  const center = b.map(r => r[3]);
  score += center.filter(x => x === player).length * 3;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS - 3; c++) score += scoreWindow([b[r][c], b[r][c+1], b[r][c+2], b[r][c+3]], player);
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS - 3; r++) score += scoreWindow([b[r][c], b[r+1][c], b[r+2][c], b[r+3][c]], player);
  for (let r = 0; r < ROWS - 3; r++) for (let c = 0; c < COLS - 3; c++) score += scoreWindow([b[r][c], b[r+1][c+1], b[r+2][c+2], b[r+3][c+3]], player);
  for (let r = 0; r < ROWS - 3; r++) for (let c = 0; c < COLS - 3; c++) score += scoreWindow([b[r+3][c], b[r+2][c+1], b[r+1][c+2], b[r][c+3]], player);
  return score;
}
function minimax(b, depth, alpha, beta, maximizing) {
  const locs = validLocations(b);
  const isTerminal = checkWin(1) || checkWin(2) || locs.length === 0;
  if (depth === 0 || isTerminal) {
    if (checkWin(2)) return [null, 1000000];
    if (checkWin(1)) return [null, -1000000];
    return [null, scorePosition(b, 2)];
  }
  if (maximizing) {
    let val = -Infinity, col = locs[0];
    for (let c of locs) {
      const r = getNextOpenRow(b, c); b[r][c] = 2;
      const [, newScore] = minimax(b, depth - 1, alpha, beta, false);
      b[r][c] = 0;
      if (newScore > val) { val = newScore; col = c; }
      alpha = Math.max(alpha, val);
      if (alpha >= beta) break;
    }
    return [col, val];
  } else {
    let val = Infinity, col = locs[0];
    for (let c of locs) {
      const r = getNextOpenRow(b, c); b[r][c] = 1;
      const [, newScore] = minimax(b, depth - 1, alpha, beta, true);
      b[r][c] = 0;
      if (newScore < val) { val = newScore; col = c; }
      beta = Math.min(beta, val);
      if (alpha >= beta) break;
    }
    return [col, val];
  }
}

window.addEventListener('DOMContentLoaded', () => {
  $('player-name').value = getDefaultName() || '';
  const p = new URLSearchParams(location.search).get('room');
  if (p) { $('room-id').value = p; $('online-panel').classList.remove('hidden'); $('join-form').classList.remove('hidden'); joinRoom(); }
});
