const socket = io();
const CLIENT_ID = localStorage.getItem('gameBoxClientId') || ('c' + Math.random().toString(36).substring(2, 10));
localStorage.setItem('gameBoxClientId', CLIENT_ID);
let mode = null;
let roomId = null;
let mySymbol = 1;
let board = [[0,0,0],[0,0,0],[0,0,0]];
let currentPlayer = 1;
let firstPlayer = 1;
let gameOver = false;
let roomState = { status: 'playing' };
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
  resetLocal(); $('room-display').textContent = m === 'ai' ? '人机' : '本地'; $('copy-btn').classList.add('hidden');
  showScreen($('game')); drawBoard(); updateTurn(); updateBadges();
  if (mode === 'ai' && currentPlayer === 2) setTimeout(aiMove, 300);
}
function showJoin() { $('join-form').classList.toggle('hidden'); }
function createRoom() { socket.emit('createRoom', { gameType: 'tictactoe', playerName: getName(), clientId: CLIENT_ID, isPublic: $('room-public-check').checked }); }
function quickMatch() { socket.emit('quickMatch:join', { gameType: 'tictactoe', playerName: getName(), clientId: CLIENT_ID }); }
function joinRoom() {
  const id = $('room-id').value.trim().toUpperCase();
  if (!id) return showError('请输入房间号');
  socket.emit('joinRoom', { roomId: id, playerName: getName(), clientId: CLIENT_ID });
}
function showError(msg) { $('error-msg').textContent = msg; $('error-msg').classList.remove('hidden'); setTimeout(() => $('error-msg').classList.add('hidden'), 3000); }

socket.on('roomCreated', (data) => {
  const { roomId: id, player, players: ps } = data;
  const privacyHint = document.getElementById('room-privacy-hint'); if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = id; mySymbol = player.symbol; mode = 'online'; players = ps || [{ name: player.name, symbol: player.symbol, isHost: true }]; enterOnline(); drawBoard(); updateTurn(); updateBadges();
});
socket.on('joinedRoom', (data) => {
  const { roomId: id, state, you, players: ps } = data;
  const privacyHint = document.getElementById('room-privacy-hint'); if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = id; mySymbol = you ? you.symbol : 2; mode = 'online'; players = ps || []; enterOnline(); applyState(state);
});
socket.on('joinedAsSpectator', ({ roomId: id, state, players: ps }) => { roomId = id; mySymbol = null; mode = 'online'; players = ps || []; enterOnline(); applyState(state); $('turn-text').textContent = '👁️ 观战'; });
socket.on('reconnected', ({ roomId: id, state, player, players: ps }) => { roomId = id; mySymbol = player ? player.symbol : 2; mode = 'online'; players = ps || []; enterOnline(); applyState(state); });
socket.on('quickMatch:found', ({ roomId: id, you, players: ps }) => { roomId = id; mySymbol = you ? you.symbol : 1; mode = 'online'; players = ps || []; enterOnline(); drawBoard(); updateTurn(); updateBadges(); showError('⚡ 匹配成功！'); });
socket.on('quickMatch:waiting', () => { showError('⏳ 正在匹配对手...'); });
socket.on('tictactoe:state', ({ state, players: ps }) => { if (ps) players = ps; applyState(state); });
socket.on('error', ({ message }) => showError(message));
socket.on('connect', () => { if (roomId) socket.emit('reconnect', { clientId: CLIENT_ID }); });
socket.on('reconnect:failed', () => { roomId = null; });

function enterOnline() { $('online-panel').classList.add('hidden'); $('join-form').classList.add('hidden'); $('copy-btn').classList.remove('hidden'); $('room-display').textContent = roomId; showScreen($('game')); }
function applyState(state) {
  roomState = state;
  board = state.board; currentPlayer = state.currentPlayer; firstPlayer = state.firstPlayer || 1; gameOver = state.gameOver;
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
  $('name-p1').textContent = mode === 'ai' ? '你' : (mode === 'local' ? '玩家X' : (p1 ? p1.name : '等待...'));
  $('name-p2').textContent = mode === 'ai' ? 'AI' : (mode === 'local' ? '玩家O' : (p2 ? p2.name : '等待...'));
  if (mode === 'online' && mySymbol !== null) {
    $('name-p1').textContent += mySymbol === 1 ? ' (你)' : '';
    $('name-p2').textContent += mySymbol === 2 ? ' (你)' : '';
  }
  $('badge-p1').classList.toggle('active', currentPlayer === 1 && !gameOver && (mode !== 'online' || roomState.status === 'playing'));
  $('badge-p2').classList.toggle('active', currentPlayer === 2 && !gameOver && (mode !== 'online' || roomState.status === 'playing'));
}
function updateTurn() {
  if (gameOver) return;
  if (mode === 'ai') $('turn-text').textContent = currentPlayer === 1 ? '你的回合 (X)' : 'AI 思考中...';
  else if (mode === 'local') $('turn-text').textContent = currentPlayer === 1 ? 'X 回合' : 'O 回合';
  else if (roomState.status === 'waiting') $('turn-text').textContent = '等待对手加入...';
  else {
    if (mySymbol === null) $('turn-text').textContent = '观战中';
    else if (mySymbol === currentPlayer) $('turn-text').textContent = '你的回合 (X/O)';
    else $('turn-text').textContent = '对手回合...';
  }
}
function resetLocal() { board = [[0,0,0],[0,0,0],[0,0,0]]; firstPlayer = firstPlayer === 1 ? 2 : 1; currentPlayer = firstPlayer; gameOver = false; }

function drawBoard() {
  const el = $('ttt-board'); el.innerHTML = '';
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    const val = board[r][c];
    const cell = document.createElement('div');
    cell.className = 'ttt-cell' + (val === 1 ? ' x' : val === 2 ? ' o' : '');
    if (val === 1) cell.textContent = 'X';
    else if (val === 2) cell.textContent = 'O';
    if (val === 0 && canInteract()) {
      cell.addEventListener('click', () => handleMove(r, c));
      cell.classList.add('empty');
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
function handleMove(r, c) {
  if (!canInteract() || board[r][c] !== 0) return;
  if (mode === 'local') makeMove(r, c, currentPlayer);
  else if (mode === 'ai') makeMove(r, c, 1);
  else if (mode === 'online') socket.emit('tictactoe:move', { row: r, col: c });
}
function makeMove(r, c, player) {
  if (board[r][c] !== 0 || gameOver) return;
  board[r][c] = player; play('place');
  if (checkWin(player)) { gameOver = true; updateTurn(); showEnd(player === 1 ? 'X 胜利!' : 'O 胜利!'); play('win'); }
  else if (board.flat().every(v => v !== 0)) { gameOver = true; updateTurn(); showEnd('平局!'); }
  else { currentPlayer = currentPlayer === 1 ? 2 : 1; updateTurn(); if (mode === 'ai' && currentPlayer === 2) setTimeout(aiMove, 300); }
  drawBoard();
}
function checkWin(p) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  return lines.some(([a,b,c]) => board[Math.floor(a/3)][a%3] === p && board[Math.floor(b/3)][b%3] === p && board[Math.floor(c/3)][c%3] === p);
}
function showEnd(text) { $('end-title').textContent = text; $('end-modal').classList.remove('hidden'); }
function closeModal() { $('end-modal').classList.add('hidden'); }
function resetGame() {
  closeModal();
  if (mode === 'online') socket.emit('tictactoe:reset');
  else { resetLocal(); drawBoard(); updateTurn(); if (mode === 'ai' && currentPlayer === 2) setTimeout(aiMove, 300); }
}
function rematchGame() {
  closeModal();
  if (mode === 'online') socket.emit('rematch');
  else resetGame();
}
function leaveGame() {
  socket.emit('leaveRoom');
  location.href = '/games/tictactoe.html';
}
function copyLink() { if (!roomId) return; copyToClipboard(`${location.origin}/games/tictactoe.html?room=${roomId}`, $('copy-btn'), '✅'); }

// Minimax AI
function aiMove() {
  if (gameOver) return;
  let best = -Infinity, move = null;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (board[r][c] === 0) {
    board[r][c] = 2;
    const score = minimax(board, 0, false);
    board[r][c] = 0;
    if (score > best) { best = score; move = { r, c }; }
  }
  if (move) makeMove(move.r, move.c, 2);
}
function minimax(b, depth, isMax) {
  if (checkWin(2)) return 10 - depth;
  if (checkWin(1)) return depth - 10;
  if (b.flat().every(v => v !== 0)) return 0;
  if (isMax) {
    let best = -Infinity;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (b[r][c] === 0) { b[r][c] = 2; best = Math.max(best, minimax(b, depth + 1, false)); b[r][c] = 0; }
    return best;
  } else {
    let best = Infinity;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (b[r][c] === 0) { b[r][c] = 1; best = Math.min(best, minimax(b, depth + 1, true)); b[r][c] = 0; }
    return best;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  $('player-name').value = getDefaultName() || '';
  const p = new URLSearchParams(location.search).get('room');
  if (p) { $('room-id').value = p; $('online-panel').classList.remove('hidden'); $('join-form').classList.remove('hidden'); joinRoom(); }
});
