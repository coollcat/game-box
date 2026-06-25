const socket = io();
const CLIENT_ID = localStorage.getItem('gameBoxClientId') || ('c' + Math.random().toString(36).substring(2, 10));
localStorage.setItem('gameBoxClientId', CLIENT_ID);

let mode = null;
let mySymbol = 1;
let currentPlayer = 1;
let board = Array(15).fill(0).map(() => Array(15).fill(0));
let gameOver = false;
let roomId = null;
let lastMove = null;
let roomState = { status: 'playing' };
let firstPlayer = 1;
let inputMode = 'drag'; // 'click' or 'drag'
let dragging = false;
let dragStone = null;
let dragPos = { r: -1, c: -1 };
let previewCell = null;
const $ = id => document.getElementById(id);
const lobby = $('lobby');
const game = $('game');
const boardEl = $('gomoku-board');
const onlinePanel = $('online-panel');
const joinForm = $('join-form');
const errorMsg = $('error-msg');
const roomDisplay = $('room-display');
const turnText = $('turn-text');
const copyBtn = $('copy-btn');

function play(sound) { if (Sounds && Sounds.sfxEnabled()) Sounds[sound](); }

function showScreen(el) {
  lobby.classList.remove('active');
  game.classList.remove('active');
  el.classList.add('active');
}

function startMode(m) {
  mode = m;
  Sounds.enable();
  if (mode === 'online') {
    onlinePanel.classList.remove('hidden');
    return;
  }
  mySymbol = 1;
  firstPlayer = 1;
  currentPlayer = firstPlayer;
  board = Array(15).fill(0).map(() => Array(15).fill(0));
  gameOver = false;
  lastMove = null;
  roomDisplay.textContent = mode === 'ai' ? '单机 AI' : '本地对战';
  copyBtn.classList.add('hidden');
  updateNames(null);
  showScreen(game);
  drawBoard();
  updateTurn();
  if (mode === 'ai' && currentPlayer === 2) aiMove();
}

function showJoin() { joinForm.classList.toggle('hidden'); }
function getName() { return $('player-name').value.trim() || 'Player'; }

function createRoom() { socket.emit('createRoom', { gameType: 'gomoku', playerName: getName(), clientId: CLIENT_ID, isPublic: $('room-public-check').checked }); }
function quickMatch() { socket.emit('quickMatch:join', { gameType: 'gomoku', playerName: getName(), clientId: CLIENT_ID }); }
function joinRoom() {
  const id = $('room-id').value.trim().toUpperCase();
  if (!id) return showError('请输入房间号');
  socket.emit('joinRoom', { roomId: id, playerName: getName(), clientId: CLIENT_ID });
}
function showError(msg) { errorMsg.textContent = msg; errorMsg.classList.remove('hidden'); setTimeout(() => errorMsg.classList.add('hidden'), 3000); }

socket.on('roomCreated', (data) => {
  const { roomId: id, player, players: ps } = data;
  const privacyHint = document.getElementById('room-privacy-hint'); if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = id;
  mySymbol = player.symbol;
  mode = 'online';
  onlinePlayers = ps || [{ name: player.name, symbol: player.symbol, isHost: true }];
  enterOnlineRoom();
  drawBoard();
  updateTurn();
  play('place');
});

socket.on('joinedRoom', (data) => {
  const { roomId: id, state, you, players: ps } = data;
  const privacyHint = document.getElementById('room-privacy-hint'); if (privacyHint) privacyHint.textContent = (data.isPublic !== false) ? '本房间为公开房间，会显示在房间列表' : '本房间为私有房间，仅可通过房间号加入';
  roomId = id;
  mySymbol = you ? you.symbol : 2;
  mode = 'online';
  onlinePlayers = ps || [];
  enterOnlineRoom();
  applyServerState(state);
});

socket.on('joinedAsSpectator', ({ roomId: id, state, players: ps }) => {
  roomId = id;
  mySymbol = null;
  mode = 'online';
  onlinePlayers = ps || [];
  enterOnlineRoom();
  applyServerState(state);
  turnText.textContent = '👁️ 观战模式';
});

socket.on('reconnected', ({ roomId: id, state, player, players: ps }) => {
  roomId = id;
  mySymbol = player ? player.symbol : 2;
  mode = 'online';
  onlinePlayers = ps || [];
  enterOnlineRoom();
  applyServerState(state);
});

socket.on('quickMatch:found', ({ roomId: id, you, players: ps }) => {
  roomId = id;
  mySymbol = you ? you.symbol : 1;
  mode = 'online';
  onlinePlayers = ps || [];
  enterOnlineRoom();
  drawBoard();
  updateTurn();
  showError('⚡ 匹配成功！');
});
socket.on('quickMatch:waiting', () => { showError('⏳ 正在匹配对手...'); });

socket.on('reconnect:failed', () => {
  showError('重连失败，请重新加入房间');
});

socket.on('gomoku:state', ({ state, players }) => {
  applyServerState(state);
  if (players) updateNames(players);
});
let onlinePlayers = [];

socket.on('chat:message', msg => appendChat(msg));
socket.on('chat:history', msgs => {
  const box = $('chat-messages');
  box.innerHTML = '';
  msgs.forEach(appendChat);
});
socket.on('error', ({ message }) => showError(message));

function enterOnlineRoom() {
  onlinePanel.classList.add('hidden');
  joinForm.classList.add('hidden');
  copyBtn.classList.remove('hidden');
  roomDisplay.textContent = roomId;
  updateNames(onlinePlayers);
  showScreen(game);
}

function applyServerState(state) {
  roomState = state;
  board = state.board;
  currentPlayer = state.currentPlayer;
  firstPlayer = state.firstPlayer || 1;
  gameOver = state.gameOver;
  lastMove = state.lastMove || null;
  drawBoard();
  updateTurn();
  if (gameOver) showWin(state.winner);
  else $('win-modal').classList.add('hidden');
  if (state.rematchVotes && mode === 'online' && mySymbol !== null) {
    const oppSymbol = mySymbol === 1 ? 2 : 1;
    if (state.rematchVotes[mySymbol]) {
      $('turn-text').textContent = '你已准备再来一局，等待对手...';
    }
    if (state.rematchVotes[mySymbol] && state.rematchVotes[oppSymbol]) {
      $('turn-text').textContent = '双方已准备，即将重新开始...';
    }
  }
}

function updateNames(players) {
  onlinePlayers = players || [];
  const p1 = players?.find(p => p.symbol === 1) || { name: mode === 'ai' ? '你' : (mode === 'local' ? '黑棋' : '等待...') };
  const p2 = players?.find(p => p.symbol === 2) || { name: mode === 'ai' ? 'AI' : (mode === 'local' ? '白棋' : '等待...') };
  $('name-1').textContent = p1.name + (mode === 'online' && mySymbol === 1 ? ' (你)' : '');
  $('name-2').textContent = p2.name + (mode === 'online' && mySymbol === 2 ? ' (你)' : '');
}

function updateTurn() {
  $('badge-1').classList.toggle('active', currentPlayer === 1);
  $('badge-2').classList.toggle('active', currentPlayer === 2);
  if (gameOver) return;
  if (mode === 'ai') turnText.textContent = currentPlayer === 1 ? '你的回合（黑棋）' : 'AI 思考中...';
  else if (mode === 'local') turnText.textContent = currentPlayer === 1 ? '黑棋回合' : '白棋回合';
  else if (roomState.status === 'waiting') turnText.textContent = '等待对手加入...';
  else {
    if (mySymbol === currentPlayer) turnText.textContent = '你的回合';
    else if (mySymbol === null) turnText.textContent = '观战中';
    else turnText.textContent = '对手回合...';
  }
}

function cellCenter(r, c) {
  const rect = boardEl.getBoundingClientRect();
  const size = Math.min(rect.width, rect.height) / 15;
  return { x: rect.left + c * size + size / 2, y: rect.top + r * size + size / 2, size };
}

function drawBoard() {
  boardEl.innerHTML = '';
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      const cell = document.createElement('div');
      cell.className = 'gcell';
      cell.dataset.r = r; cell.dataset.c = c;
      if (board[r][c] !== 0) {
        const stone = document.createElement('div');
        stone.className = 'stone ' + (board[r][c] === 1 ? 'black' : 'white');
        if (lastMove && lastMove.row === r && lastMove.col === c) stone.classList.add('last');
        cell.appendChild(stone);
      }
      cell.addEventListener('click', () => handleClick(r, c));
      boardEl.appendChild(cell);
    }
  }
  clearPreview();
}

function createDragStone(player, x, y) {
  removeDragStone();
  const stone = document.createElement('div');
  stone.className = 'stone drag ' + (player === 1 ? 'black' : 'white');
  stone.style.position = 'fixed';
  stone.style.left = (x - 15) + 'px';
  stone.style.top = (y - 15) + 'px';
  stone.style.width = '30px';
  stone.style.height = '30px';
  stone.style.zIndex = 100;
  stone.style.pointerEvents = 'none';
  document.body.appendChild(stone);
  dragStone = stone;
}

function moveDragStone(x, y) {
  if (!dragStone) return;
  dragStone.style.left = (x - 15) + 'px';
  dragStone.style.top = (y - 15) + 'px';
}

function removeDragStone() {
  if (dragStone) { dragStone.remove(); dragStone = null; }
}

function setInputMode(m) {
  inputMode = m;
  $('mode-click').classList.toggle('active', m === 'click');
  $('mode-drag').classList.toggle('active', m === 'drag');
  const hint = $('gomoku-hint');
  if (hint) hint.textContent = m === 'click' ? '点击落子模式：直接点击棋盘交点落子' : '拖动预览模式：点击格子预览位置，按住棋盘任意处拖动微调，再点击预览落子';
  clearPreview();
  removeDragStone();
  dragging = false;
  dragPos = { r: -1, c: -1 };
}

function setPreview(r, c) {
  clearPreview();
  const cell = boardEl.querySelector(`.gcell[data-r="${r}"][data-c="${c}"]`);
  if (cell) { cell.classList.add('preview'); previewCell = cell; }
  if (inputMode === 'drag' && previewCell) $('place-btn').classList.remove('hidden');
}
function clearPreview() {
  if (previewCell) { previewCell.classList.remove('preview'); previewCell = null; }
  $('place-btn').classList.add('hidden');
}
function confirmPlace() {
  if (inputMode === 'drag' && dragPos.r >= 0 && dragPos.c >= 0) tryPlace(dragPos.r, dragPos.c);
}

function nearestCell(clientX, clientY) {
  const rect = boardEl.getBoundingClientRect();
  const size = rect.width / 15;
  const c = Math.round((clientX - rect.left) / size);
  const r = Math.round((clientY - rect.top) / size);
  if (r < 0 || r >= 15 || c < 0 || c >= 15) return null;
  return { r, c };
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

function handleBoardTouch(e) {
  if (inputMode !== 'drag' || !canInteract()) return;
  if (e.cancelable) e.preventDefault();
  const t = e.touches ? e.touches[0] : e;
  dragging = true;
  const cell = nearestCell(t.clientX, t.clientY);
  if (cell) {
    dragPos = cell;
    setPreview(cell.r, cell.c);
  }
}

function handleBoardMove(e) {
  if (!dragging) return;
  if (e.cancelable) e.preventDefault();
  const t = e.touches ? e.touches[0] : e;
  const cell = nearestCell(t.clientX, t.clientY);
  if (cell) { dragPos = cell; setPreview(cell.r, cell.c); }
}

function handleBoardEnd(e) {
  if (!dragging) return;
  dragging = false;
}

boardEl.addEventListener('touchstart', handleBoardTouch, { passive: false });
boardEl.addEventListener('touchmove', handleBoardMove, { passive: false });
boardEl.addEventListener('touchend', handleBoardEnd);
boardEl.addEventListener('mousedown', handleBoardTouch);
window.addEventListener('mousemove', handleBoardMove);
window.addEventListener('mouseup', handleBoardEnd);

function handleClick(r, c) {
  if (!canInteract()) return;
  if (inputMode === 'click') {
    tryPlace(r, c);
  } else {
    // drag mode: only commit when clicking the previewed cell
    if (dragPos.r === r && dragPos.c === c) tryPlace(r, c);
  }
}

function tryPlace(r, c) {
  if (gameOver || board[r][c] !== 0) return;
  if (!canInteract()) return;
  clearPreview();
  removeDragStone();
  dragPos = { r: -1, c: -1 };
  if (mode === 'local') placeStone(r, c, currentPlayer);
  else if (mode === 'ai') { if (currentPlayer !== 1) return; placeStone(r, c, 1); }
  else if (mode === 'online') {
    socket.emit('gomoku:move', { row: r, col: c });
  }
}

function placeStone(r, c, player) {
  board[r][c] = player;
  lastMove = { row: r, col: c, symbol: player };
  drawBoard();
  play('place');
  if (checkWinLocal(r, c, player)) {
    gameOver = true; updateTurn(); showWin(player); play('win');
  } else if (isDraw()) {
    gameOver = true; updateTurn(); showWin(null);
  } else {
    currentPlayer = currentPlayer === 1 ? 2 : 1;
    updateTurn();
    if (mode === 'ai' && currentPlayer === 2 && !gameOver) setTimeout(aiMove, 250);
  }
}

function checkWinLocal(row, col, player) {
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (const [dr,dc] of dirs) {
    let count=1;
    for(let i=1;i<5;i++){const r=row+dr*i,c=col+dc*i;if(r>=0&&r<15&&c>=0&&c<15&&board[r][c]===player)count++;else break;}
    for(let i=1;i<5;i++){const r=row-dr*i,c=col-dc*i;if(r>=0&&r<15&&c>=0&&c<15&&board[r][c]===player)count++;else break;}
    if(count>=5)return true;
  }
  return false;
}
function isDraw() { for(let r=0;r<15;r++)for(let c=0;c<15;c++)if(board[r][c]===0)return false; return true; }

function showWin(winner) {
  const title = $('win-title'); const sub = $('win-subtitle');
  if (winner === null) { title.textContent = '平局!'; sub.textContent = '势均力敌'; }
  else if (mode === 'ai') { title.textContent = winner === 1 ? '你赢了!' : 'AI 赢了!'; sub.textContent = winner === 1 ? '恭喜你击败 AI' : '再接再厉'; }
  else { title.textContent = winner === 1 ? '黑棋胜利!' : '白棋胜利!'; sub.textContent = '太棒了!'; }
  $('win-modal').classList.remove('hidden');
}
function closeModal() { $('win-modal').classList.add('hidden'); }

function resetGame() {
  $('win-modal').classList.add('hidden');
  if (mode === 'online') socket.emit('gomoku:reset');
  else {
    firstPlayer = firstPlayer === 1 ? 2 : 1;
    board = Array(15).fill(0).map(() => Array(15).fill(0));
    currentPlayer = firstPlayer; gameOver = false; lastMove = null;
    drawBoard(); updateTurn();
    if (mode === 'ai' && currentPlayer === 2) setTimeout(aiMove, 250);
  }
}
function rematchGame() {
  closeModal();
  if (mode === 'online') socket.emit('rematch');
  else resetGame();
}
function leaveGame() {
  socket.emit('leaveRoom');
  location.href = '/games/gomoku.html';
}
function copyLink() {
  if (!roomId) return;
  copyToClipboard(`${location.origin}/games/gomoku.html?room=${roomId}`, copyBtn, '✅ 已复制');
}

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
$('chat-input').addEventListener('focus', () => {
  const chatBox = $('chat-box');
  const input = $('chat-input');
  if (!chatBox.classList.contains('expanded')) toggleChat(true);
  setTimeout(() => {
    input.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }, 250);
});

// Keep chat input visible above the mobile virtual keyboard
(function initKeyboardHandling() {
  const vv = window.visualViewport;
  if (!vv) return;
  function updateKeyboardOffset() {
    const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.body.classList.toggle('keyboard-open', keyboardHeight > 80);
    document.body.style.setProperty('--keyboard-height', keyboardHeight + 'px');
    const chatBox = $('chat-box');
    if (chatBox && chatBox.classList.contains('expanded')) {
      const input = $('chat-input');
      if (document.activeElement === input) {
        setTimeout(() => input.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
      }
    }
  }
  vv.addEventListener('resize', updateKeyboardOffset);
  vv.addEventListener('scroll', updateKeyboardOffset);
  window.addEventListener('resize', updateKeyboardOffset);
  updateKeyboardOffset();
})();

function toggleChat(forceOpen) {
  const box = $('chat-box');
  const btn = $('chat-toggle');
  const expanded = forceOpen === true || !box.classList.contains('expanded');
  box.classList.toggle('expanded', expanded);
  btn.textContent = expanded ? '收起' : '展开';
  if (expanded) setTimeout(() => $('chat-messages').scrollTop = $('chat-messages').scrollHeight, 50);
}

// Controls
setInputMode('drag');

// AI
const SCORES = { '5': 1000000, '4o': 100000, '4c': 5000, '3o': 8000, '3c': 800, '2o': 500, '2c': 50 };
function aiMove() {
  if (gameOver) return;
  const move = findBestMove();
  if (move) placeStone(move.r, move.c, 2);
}
function findBestMove() {
  let best = null, bestScore = -Infinity;
  for (let r = 0; r < 15; r++) {
    for (let c = 0; c < 15; c++) {
      if (board[r][c] !== 0) continue;
      if (!hasNeighbor(r, c, 2)) continue;
      const score = evaluate(r, c, 2) + evaluate(r, c, 1) * 1.05 + Math.random() * 5;
      if (score > bestScore) { bestScore = score; best = { r, c }; }
    }
  }
  return best || { r: 7, c: 7 };
}
function hasNeighbor(r, c, dist) { for(let i=-dist;i<=dist;i++)for(let j=-dist;j<=dist;j++){if(i===0&&j===0)continue;const nr=r+i,nc=c+j;if(nr>=0&&nr<15&&nc>=0&&nc<15&&board[nr][nc]!==0)return true;} return false; }
function evaluate(r, c, player) {
  board[r][c] = player; let total = 0;
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (const [dr,dc] of dirs) {
    let count = 1, empty = 0, blocked = 0;
    for (let dir of [1,-1]) {
      let sideBlocked = false;
      for (let i = 1; i < 5; i++) {
        const rr = r + dr*i*dir, cc = c + dc*i*dir;
        if (rr < 0 || rr >= 15 || cc < 0 || cc >= 15) { sideBlocked = true; break; }
        if (board[rr][cc] === player) count++;
        else if (board[rr][cc] === 0) { empty++; break; }
        else { sideBlocked = true; break; }
      }
      if (sideBlocked && empty === 0) blocked++;
    }
    const open = empty >= 2 ? 'o' : 'c';
    const key = count >= 5 ? '5' : `${count}${open}`;
    total += SCORES[key] || 0;
  }
  board[r][c] = 0;
  return total;
}

window.addEventListener('DOMContentLoaded', () => {
  $('player-name').value = getDefaultName() || '';
  const params = new URLSearchParams(location.search);
  const room = params.get('room');
  if (room) { $('room-id').value = room; onlinePanel.classList.remove('hidden'); joinForm.classList.remove('hidden'); joinRoom(); }
});
