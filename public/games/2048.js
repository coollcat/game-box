let board = Array(4).fill(0).map(() => Array(4).fill(0));
let score = 0;
let best = parseInt(localStorage.getItem('best2048') || '0');
let touchStart = null;
const $ = id => document.getElementById(id);
function play(s) { if (Sounds && Sounds.sfxEnabled()) Sounds[s](); }
function enableSound() { if (Sounds) Sounds.enable(); }

function draw() {
  const el = $('board'); el.innerHTML = '';
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const tile = document.createElement('div');
    tile.className = 'tile' + (board[r][c] ? ` tile-${board[r][c]}` : '');
    tile.textContent = board[r][c] || '';
    el.appendChild(tile);
  }
  $('score').textContent = score;
  $('best').textContent = best;
}

function addRandom() {
  const empties = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!board[r][c]) empties.push({ r, c });
  if (!empties.length) return false;
  const { r, c } = empties[Math.floor(Math.random() * empties.length)];
  board[r][c] = Math.random() < 0.9 ? 2 : 4;
  return true;
}

function newGame() {
  board = Array(4).fill(0).map(() => Array(4).fill(0));
  score = 0;
  addRandom(); addRandom();
  draw();
  $('end-modal').classList.add('hidden');
}

function slideRowLeft(row) {
  let arr = row.filter(v => v);
  for (let i = 0; i < arr.length - 1; i++) {
    if (arr[i] === arr[i+1]) { arr[i] *= 2; score += arr[i]; arr[i+1] = 0; }
  }
  arr = arr.filter(v => v);
  while (arr.length < 4) arr.push(0);
  return arr;
}
function moveLeft() { let moved = false; for (let r = 0; r < 4; r++) { const old = [...board[r]]; board[r] = slideRowLeft(board[r]); if (old.join(',') !== board[r].join(',')) moved = true; } return moved; }
function moveRight() { let moved = false; for (let r = 0; r < 4; r++) { const old = [...board[r]]; board[r] = slideRowLeft(board[r].reverse()).reverse(); if (old.join(',') !== board[r].join(',')) moved = true; } return moved; }
function moveUp() { let moved = false; for (let c = 0; c < 4; c++) { const col = [board[0][c], board[1][c], board[2][c], board[3][c]]; const old = [...col]; const n = slideRowLeft(col); for (let r = 0; r < 4; r++) board[r][c] = n[r]; if (old.join(',') !== n.join(',')) moved = true; } return moved; }
function moveDown() { let moved = false; for (let c = 0; c < 4; c++) { const col = [board[0][c], board[1][c], board[2][c], board[3][c]]; const old = [...col]; const n = slideRowLeft(col.reverse()).reverse(); for (let r = 0; r < 4; r++) board[r][c] = n[r]; if (old.join(',') !== n.join(',')) moved = true; } return moved; }

function canMove() {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!board[r][c]) return true;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) if (board[r][c] === board[r][c+1]) return true;
  for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) if (board[r][c] === board[r+1][c]) return true;
  return false;
}

function checkEnd() {
  if (score > best) { best = score; localStorage.setItem('best2048', String(best)); }
  if (!canMove()) {
    $('end-title').textContent = '游戏结束';
    $('end-subtitle').textContent = `最终得分 ${score}`;
    $('end-modal').classList.remove('hidden');
    play('lose');
  }
}

function doMove(dir) {
  const moved = dir === 'left' ? moveLeft() : dir === 'right' ? moveRight() : dir === 'up' ? moveUp() : moveDown();
  if (moved) { addRandom(); draw(); play('place'); checkEnd(); }
}

window.addEventListener('keydown', e => {
  if (['ArrowLeft','a'].includes(e.key)) doMove('left');
  if (['ArrowRight','d'].includes(e.key)) doMove('right');
  if (['ArrowUp','w'].includes(e.key)) doMove('up');
  if (['ArrowDown','s'].includes(e.key)) doMove('down');
});

const boardEl = $('board');
boardEl.addEventListener('touchstart', e => { touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
boardEl.addEventListener('touchend', e => {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
  if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? 'right' : 'left');
  else doMove(dy > 0 ? 'down' : 'up');
  touchStart = null;
}, { passive: true });

enableSound();
newGame();
