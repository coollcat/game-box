require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason && reason.stack ? reason.stack : reason);
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '5mb' }));

// ---------- Per-user cloud save (used by parking-puzzle and other games) ----------
const SAVES_FILE = path.join(__dirname, 'data', 'saves.json');
function loadSaves() {
  try { return JSON.parse(fs.readFileSync(SAVES_FILE, 'utf8')); }
  catch (e) { return {}; }
}
function saveSaves(data) {
  try {
    fs.mkdirSync(path.dirname(SAVES_FILE), { recursive: true });
    fs.writeFileSync(SAVES_FILE, JSON.stringify(data, null, 2));
  } catch (e) { console.error('saveSaves failed', e); }
}
app.post('/api/save', (req, res) => {
  try {
    const { token, data } = req.body || {};
    if (!token) return res.status(400).json({ error: 'missing token' });
    const saves = loadSaves();
    saves[token] = { data, updatedAt: Date.now() };
    saveSaves(saves);
    res.json({ ok: true });
  } catch (e) { console.error('/api/save error:', e.message); res.status(500).json({ error: e.message }); }
});
app.get('/api/load', (req, res) => {
  try {
    const token = req.query.token;
    if (!token) return res.status(400).json({ error: 'missing token' });
    const saves = loadSaves();
    const rec = saves[token];
    res.json({ data: rec ? rec.data : null });
  } catch (e) { console.error('/api/load error:', e.message); res.status(500).json({ error: e.message }); }
});

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const AGNES_BASE_URL = process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com/v1';
const AGNES_KEY = process.env.AGNES_API_KEY;
const MIMO_BASE_URL = process.env.MIMO_BASE_URL || 'https://api.xiaomimimo.com/v1';
const MIMO_KEY = process.env.MIMO_API_KEY;
const CHAT_MODEL = process.env.CHAT_MODEL || 'agnes-2.0-flash';
const IMAGE_MODEL = process.env.IMAGE_MODEL || 'agnes-image-2.1-flash';
const TTS_MODEL = process.env.TTS_MODEL || 'mimo-v2.5-tts';
const TTS_VOICE = process.env.TTS_VOICE || 'mimo_default';

const ALL_GAMES = ['gomoku', 'pong', 'drawguess', 'tictactoe', 'connect4', 'draw2guess', 'rps', 'memory', 'dots', 'snake', 'shooter', 'racing', 'othello', 'bullsandcows', 'blackjack', 'ulttt', 'minichess'];
const rooms = new Map();
const quickMatchQueue = new Map(); // gameType -> Map(socketId -> { socket, name })

// ---------- Accounts / Leaderboards ----------
const USERS_FILE = path.join(__dirname, 'data', 'users.json');
const LEADERBOARD_GAMES = ['memory', 'drawguess', 'draw2guess', '2048', 'snake', 'shooter', 'racing'];
const users = new Map();
const accountIndex = new Map();
const nameIndex = new Map();

function loadUsers() {
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    for (const u of (data.users || [])) {
      if (!u || !u.id) continue;
      users.set(u.id, u);
      accountIndex.set(u.account, u.id);
      nameIndex.set(u.name, u.id);
    }
  } catch (e) {}
}
function saveUsers() {
  try {
    fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
    const out = [];
    for (const u of users.values()) out.push(u);
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: out }, null, 2));
  } catch (e) { console.error('saveUsers failed', e); }
}
loadUsers();

function generateUserId() { return 'u' + Math.random().toString(36).substring(2, 10); }
function sanitizeName(n) { return String(n || '').trim().slice(0, 16); }
function publicUser(u) { return { id: u.id, account: u.account, name: u.name, createdAt: u.createdAt }; }
function createUser(account, password, name) {
  account = String(account || '').trim().toLowerCase();
  if (!account || !password) return { error: '账号和密码必填' };
  if (accountIndex.has(account)) return { error: '账号已存在' };
  const id = generateUserId();
  const finalName = sanitizeName(name) || `Player#${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  if (nameIndex.has(finalName)) return { error: '名字已被占用' };
  const user = { id, account, password: String(password || ''), name: finalName, createdAt: now(), records: {} };
  users.set(id, user);
  accountIndex.set(account, id);
  nameIndex.set(finalName, id);
  saveUsers();
  return { user: publicUser(user) };
}
function checkLogin(account, password) {
  const id = accountIndex.get(String(account || '').trim().toLowerCase());
  if (!id) return null;
  const u = users.get(id);
  if (!u || u.password !== String(password || '')) return null;
  return u;
}
function renameUser(userId, newName) {
  const u = users.get(userId);
  if (!u) return { error: '用户不存在' };
  const n = sanitizeName(newName);
  if (!n) return { error: '名字不能为空' };
  if (n === u.name) return { user: publicUser(u) };
  if (nameIndex.has(n)) return { error: '名字已被占用' };
  nameIndex.delete(u.name);
  u.name = n;
  nameIndex.set(n, u.id);
  saveUsers();
  return { user: publicUser(u) };
}
function submitRecord(userId, game, score) {
  const u = users.get(userId);
  if (!u) return { error: '用户不存在' };
  if (!LEADERBOARD_GAMES.includes(game)) return { error: '不支持的游戏' };
  const s = Number(score);
  if (!Number.isFinite(s)) return { error: '分数无效' };
  if (!u.records[game]) u.records[game] = [];
  u.records[game].push({ score: s, date: now() });
  u.records[game].sort((a, b) => b.score - a.score);
  u.records[game] = u.records[game].slice(0, 3);
  saveUsers();
  return { success: true };
}
function getLeaderboard(game, limit = 20) {
  if (!LEADERBOARD_GAMES.includes(game)) return [];
  const list = [];
  for (const u of users.values()) {
    const recs = u.records[game] || [];
    if (recs.length) list.push({ name: u.name, score: recs[0].score, date: recs[0].date });
  }
  list.sort((a, b) => b.score - a.score);
  return list.slice(0, limit);
}
function getUserRecords(userId) {
  const u = users.get(userId);
  if (!u) return {};
  const out = {};
  for (const g of LEADERBOARD_GAMES) out[g] = (u.records[g] || []).slice();
  return out;
}
function getUserByToken(token) { return users.get(token) || null; }

// ---------- Utils ----------
function generateRoomId() {
  let id;
  do {
    id = String(Math.floor(100000 + Math.random() * 900000));
  } while (rooms.has(id));
  return id;
}
function now() { return Date.now(); }
function getServerIp() {
  const nets = require('os').networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}
function getShareLink(room) {
  const host = process.env.PUBLIC_HOST || `http://${getServerIp()}:${PORT}`;
  return `${host}/games/${room.gameType}.html?room=${room.id}`;
}

// ---------- State Factories ----------
function createBoard(rows, cols, val = 0) {
  return Array(rows).fill(0).map(() => Array(cols).fill(val));
}
function initialGomokuState() {
  return { board: createBoard(15, 15), currentPlayer: 1, firstPlayer: 1, gameOver: false, winner: null, lastMove: null, status: 'waiting' };
}
function initialPongState() {
  return { status: 'waiting', scores: [0, 0], paddles: [{ x: 0.5 }, { x: 0.5 }], ball: { x: 0.5, y: 0.5, vx: 0, vy: 0 }, winner: null, server: null, targetScore: 5, lastUpdate: now() };
}
function initialShooterState() {
  return { status: 'waiting', gameState: 'idle' };
}
function racingLaneCenter(lane, W, laneCount) {
  return (W / laneCount) * lane + (W / laneCount) / 2;
}
function initialRacingState() {
  const W = 360, H = 600, LANE_COUNT = 4;
  const LANE_W = W / LANE_COUNT;
  const CAR_W = LANE_W * 0.55;
  const CAR_H = CAR_W * 1.6;
  return {
    status: 'waiting',
    W, H, LANE_COUNT, LANE_W, CAR_W, CAR_H,
    cars: {
      1: { x: racingLaneCenter(1, W, LANE_COUNT), y: H - 120, w: CAR_W, h: CAR_H, lane: 1, tilt: 0, vx: 0, color: '#4d96ff' },
      2: { x: racingLaneCenter(2, W, LANE_COUNT), y: H - 120, w: CAR_W, h: CAR_H, lane: 2, tilt: 0, vx: 0, color: '#ff9f43' }
    },
    enemies: [],
    items: [],
    particles: [],
    roadOffset: 0,
    score: 0,
    speed: 5,
    frameCount: 0,
    spawnTimer: 0,
    itemSpawnTimer: 0,
    lives: { 1: 3, 2: 3 },
    effects: { 1: { speed: 0, shield: 0, slow: 0 }, 2: { speed: 0, shield: 0, slow: 0 } },
    inputs: { 1: 0, 2: 0 },
    collisionCooldown: { 1: 0, 2: 0 },
    dead: { 1: false, 2: false },
    gameOver: false,
    winner: null
  };
}
function resetPongBall(s, dir = 1) {
  const speed = 0.012 + Math.random() * 0.004;
  const angle = (Math.random() - 0.5) * 0.6;
  s.ball = { x: 0.5, y: 0.5, vx: speed * Math.sin(angle), vy: speed * (dir || (Math.random() > 0.5 ? 1 : -1)) };
}
function initialTictactoeState() {
  return { board: createBoard(3, 3), currentPlayer: 1, firstPlayer: 1, gameOver: false, winner: null, moves: 0, status: 'waiting' };
}
function initialConnect4State() {
  return { board: createBoard(6, 7), currentPlayer: 1, firstPlayer: 1, gameOver: false, winner: null, lastMove: null, status: 'waiting' };
}

const MEMORY_ICONS = ['🍎','🍌','🐱','🐶','🚗','✈️','🎸','🏀'];
function shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
function initialRpsState() {
  return { status: 'waiting', round: 1, scores: [0, 0], choices: { 1: null, 2: null }, result: null, winner: null, target: 2 };
}
function initialMemoryState() {
  const icons = shuffle([...MEMORY_ICONS, ...MEMORY_ICONS]);
  return { status: 'waiting', cards: icons.map((icon, i) => ({ id: i, icon, flipped: false, matched: false })), currentPlayer: 1, firstPlayer: 1, scores: [0, 0], flipped: [], winner: null, message: '' };
}
function resetMemoryCards(state) { state.cards = shuffle([...MEMORY_ICONS, ...MEMORY_ICONS]).map((icon, i) => ({ id: i, icon, flipped: false, matched: false })); }
function initialDotsState() {
  // 4x4 dots => 3x3 boxes. edges[dir][r][c]: dir 0 horizontal, 1 vertical. boxes[r][c]=0|1|2.
  return { status: 'waiting', currentPlayer: 1, firstPlayer: 1, scores: [0, 0], edges: { 0: createBoard(4, 3, 0), 1: createBoard(3, 4, 0) }, boxes: createBoard(3, 3, 0), winner: null, moves: 0, totalLines: 24 };
}

function initialOthelloState() {
  const board = createBoard(8, 8);
  board[3][3] = 2; board[3][4] = 1; board[4][3] = 1; board[4][4] = 2;
  return { status: 'waiting', board, currentPlayer: 1, firstPlayer: 1, gameOver: false, winner: null, lastMove: null, scores: { 1: 2, 2: 2 } };
}
function initialBullsandcowsState() {
  return { status: 'waiting', secrets: { 1: null, 2: null }, guesses: [], currentPlayer: 1, firstPlayer: 1, gameOver: false, winner: null };
}
function initialBlackjackState() {
  return { status: 'waiting', deck: [], dealerHand: [], playerHands: { 1: [], 2: [] }, currentPlayer: 1, firstPlayer: 1, gameOver: false, winner: null, results: { 1: null, 2: null }, message: '', dealerHidden: true };
}
function initialUltttState() {
  return { status: 'waiting', board: createBoard(9, 9), metaBoard: createBoard(3, 3), activeBoard: null, currentPlayer: 1, firstPlayer: 1, gameOver: false, winner: null, lastMove: null };
}
function initialMinichessState() {
  const board = createBoard(6, 5, '');
  const back = ['r', 'n', 'b', 'k', 'q'];
  const Back = ['R', 'N', 'B', 'K', 'Q'];
  for (let c = 0; c < 5; c++) { board[0][c] = back[c]; board[5][c] = Back[c]; }
  for (let c = 0; c < 5; c++) { board[1][c] = 'p'; board[4][c] = 'P'; }
  return { status: 'waiting', board, currentPlayer: 1, firstPlayer: 1, gameOver: false, winner: null, captured: { 1: [], 2: [] }, lastMove: null, check: { 1: false, 2: false } };
}

const SNAKE_GRID = 20;
const SNAKE_MAPS = {
  empty: [],
  box: [{x:5,y:5},{x:6,y:5},{x:7,y:5},{x:8,y:5},{x:9,y:5},{x:10,y:5},{x:11,y:5},{x:12,y:5},{x:13,y:5},{x:14,y:5},
        {x:5,y:14},{x:6,y:14},{x:7,y:14},{x:8,y:14},{x:9,y:14},{x:10,y:14},{x:11,y:14},{x:12,y:14},{x:13,y:14},{x:14,y:14},
        {x:5,y:6},{x:5,y:7},{x:5,y:8},{x:5,y:9},{x:5,y:10},{x:5,y:11},{x:5,y:12},{x:5,y:13},
        {x:14,y:6},{x:14,y:7},{x:14,y:8},{x:14,y:9},{x:14,y:10},{x:14,y:11},{x:14,y:12},{x:14,y:13}],
  cross: [{x:9,y:0},{x:9,y:1},{x:9,y:2},{x:9,y:3},{x:9,y:4},{x:9,y:15},{x:9,y:16},{x:9,y:17},{x:9,y:18},{x:9,y:19},
          {x:10,y:0},{x:10,y:1},{x:10,y:2},{x:10,y:3},{x:10,y:4},{x:10,y:15},{x:10,y:16},{x:10,y:17},{x:10,y:18},{x:10,y:19},
          {x:0,y:9},{x:1,y:9},{x:2,y:9},{x:3,y:9},{x:4,y:9},{x:15,y:9},{x:16,y:9},{x:17,y:9},{x:18,y:9},{x:19,y:9},
          {x:0,y:10},{x:1,y:10},{x:2,y:10},{x:3,y:10},{x:4,y:10},{x:15,y:10},{x:16,y:10},{x:17,y:10},{x:18,y:10},{x:19,y:10}],
  maze: [{x:2,y:2},{x:3,y:2},{x:4,y:2},{x:5,y:2},{x:6,y:2},{x:7,y:2},{x:8,y:2},
         {x:11,y:2},{x:12,y:2},{x:13,y:2},{x:14,y:2},{x:15,y:2},{x:16,y:2},{x:17,y:2},
         {x:2,y:5},{x:3,y:5},{x:4,y:5},{x:5,y:5},{x:6,y:5},{x:7,y:5},{x:8,y:5},
         {x:11,y:5},{x:12,y:5},{x:13,y:5},{x:14,y:5},{x:15,y:5},{x:16,y:5},{x:17,y:5},
         {x:2,y:8},{x:3,y:8},{x:4,y:8},{x:5,y:8},{x:6,y:8},{x:7,y:8},{x:8,y:8},{x:9,y:8},{x:10,y:8},{x:11,y:8},{x:12,y:8},{x:13,y:8},{x:14,y:8},{x:15,y:8},{x:16,y:8},{x:17,y:8},
         {x:2,y:11},{x:3,y:11},{x:4,y:11},{x:5,y:11},{x:6,y:11},{x:7,y:11},{x:8,y:11},{x:9,y:11},{x:10,y:11},{x:11,y:11},{x:12,y:11},{x:13,y:11},{x:14,y:11},{x:15,y:11},{x:16,y:11},{x:17,y:11},
         {x:2,y:14},{x:3,y:14},{x:4,y:14},{x:5,y:14},{x:6,y:14},{x:7,y:14},{x:8,y:14},
         {x:11,y:14},{x:12,y:14},{x:13,y:14},{x:14,y:14},{x:15,y:14},{x:16,y:14},{x:17,y:14},
         {x:2,y:17},{x:3,y:17},{x:4,y:17},{x:5,y:17},{x:6,y:17},{x:7,y:17},{x:8,y:17},
         {x:11,y:17},{x:12,y:17},{x:13,y:17},{x:14,y:17},{x:15,y:17},{x:16,y:17},{x:17,y:17}]
};
function getMapWalls(name) { return SNAKE_MAPS[name] || SNAKE_MAPS.empty; }
function initialSnakeState() {
  return { status: 'waiting', map: 'empty', walls: [], snakes: { 1: null, 2: null }, dirs: { 1: { x: 1, y: 0 }, 2: { x: -1, y: 0 } }, nextDirs: { 1: { x: 1, y: 0 }, 2: { x: -1, y: 0 } }, foods: [], scores: { 1: 0, 2: 0 }, lives: { 1: 3, 2: 3 }, ready: { 1: false, 2: false }, dead: { 1: false, 2: false }, respawnAt: { 1: 0, 2: 0 }, winner: null, message: '' };
}
function startPositions(symbol) {
  if (symbol === 1) return [{x:2,y:2},{x:1,y:2},{x:0,y:2}];
  return [{x:SNAKE_GRID-3,y:SNAKE_GRID-3},{x:SNAKE_GRID-2,y:SNAKE_GRID-3},{x:SNAKE_GRID-1,y:SNAKE_GRID-3}];
}
function spawnSnake(symbol, mapName) {
  const segs = startPositions(symbol);
  const walls = getMapWalls(mapName);
  // if spawn blocked by walls, shift slightly
  if (walls.some(w => segs.some(s => s.x===w.x && s.y===w.y))) {
    segs.forEach(s => { s.x = (s.x + 2) % SNAKE_GRID; s.y = (s.y + 2) % SNAKE_GRID; });
  }
  return segs;
}

function startGameIfReady(room) {
  if (connectedPlayerCount(room) === 2 && room.state.status === 'waiting' && !room.state.gameOver) {
    if (room.gameType === 'rps') room.state.status = 'choosing';
    else if (room.gameType === 'bullsandcows') room.state.status = 'setting';
    else if (room.gameType === 'blackjack') startBlackjack(room);
    else room.state.status = 'playing';
    room.lastActivity = now();
  }
}

const WORD_POOL = [
  { word: '守株待兔', pinyin: 'shou zhu dai tu', category: '成语', meaning: 'a farmer waiting by a tree stump hoping another hare will crash into it', answers: ['守株待兔','shou zhu dai tu'] },
  { word: '画蛇添足', pinyin: 'hua she tian zu', category: '成语', meaning: 'drawing a snake and adding feet, ruining it by overdoing', answers: ['画蛇添足','hua she tian zu'] },
  { word: '亡羊补牢', pinyin: 'wang yang bu lao', category: '成语', meaning: 'mending the pen after sheep are lost, it is not too late', answers: ['亡羊补牢','wang yang bu lao'] },
  { word: '掩耳盗铃', pinyin: 'yan er dao ling', category: '成语', meaning: 'covering ones ears while stealing a bell', answers: ['掩耳盗铃','yan er dao ling'] },
  { word: '刻舟求剑', pinyin: 'ke zhou qiu jian', category: '成语', meaning: 'marking a boat to find a dropped sword', answers: ['刻舟求剑','ke zhou qiu jian'] },
  { word: '井底之蛙', pinyin: 'jing di zhi wa', category: '成语', meaning: 'a frog at the bottom of a well with a narrow view', answers: ['井底之蛙','jing di zhi wa'] },
  { word: '狐假虎威', pinyin: 'hu jia hu wei', category: '成语', meaning: 'a fox borrowing the tigers fierceness', answers: ['狐假虎威','hu jia hu wei'] },
  { word: '叶公好龙', pinyin: 'ye gong hao long', category: '成语', meaning: 'Lord Ye who claims to love dragons but is frightened by one', answers: ['叶公好龙','ye gong hao long'] },
  { word: '对牛弹琴', pinyin: 'dui niu tan qin', category: '成语', meaning: 'playing the lute to a cow, casting pearls before swine', answers: ['对牛弹琴','dui niu tan qin'] },
  { word: '塞翁失马', pinyin: 'sai weng shi ma', category: '成语', meaning: 'an old man lost his horse but it turned out to be a blessing', answers: ['塞翁失马','sai weng shi ma'] },
  { word: '指鹿为马', pinyin: 'zhi lu wei ma', category: '成语', meaning: 'pointing at a deer and calling it a horse', answers: ['指鹿为马','zhi lu wei ma'] },
  { word: '杯弓蛇影', pinyin: 'bei gong she ying', category: '成语', meaning: 'mistaking the reflection of a bow in the cup for a snake', answers: ['杯弓蛇影','bei gong she ying'] },
  { word: '自相矛盾', pinyin: 'zi xiang mao dun', category: '成语', meaning: 'attacking ones own shield with ones spear, self-contradictory', answers: ['自相矛盾','zi xiang mao dun'] },
  { word: '拔苗助长', pinyin: 'ba miao zhu zhang', category: '成语', meaning: 'pulling up seedlings to help them grow', answers: ['拔苗助长','ba miao zhu zhang'] },
  { word: '滥竽充数', pinyin: 'lan yu chong shu', category: '成语', meaning: 'passing oneself off as one of the players in an ensemble', answers: ['滥竽充数','lan yu chong shu'] },
  // 新增成语
  { word: '盲人摸象', pinyin: 'mang ren mo xiang', category: '成语', meaning: 'blind men touching an elephant, each only grasping a part', answers: ['盲人摸象','mang ren mo xiang'] },
  { word: '鸡飞狗跳', pinyin: 'ji fei gou tiao', category: '成语', meaning: 'chickens flying and dogs jumping, chaos everywhere', answers: ['鸡飞狗跳','ji fei gou tiao'] },
  { word: '顺手牵羊', pinyin: 'shun shou qian yang', category: '成语', meaning: 'taking a sheep while passing by, opportunistic theft', answers: ['顺手牵羊','shun shou qian yang'] },
  { word: '虎头蛇尾', pinyin: 'hu tou she wei', category: '成语', meaning: 'tiger head and snake tail, starting strong but ending weak', answers: ['虎头蛇尾','hu tou she wei'] },
  { word: '龙飞凤舞', pinyin: 'long fei feng wu', category: '成语', meaning: 'dragon flying and phoenix dancing, lively and vigorous', answers: ['龙飞凤舞','long fei feng wu'] },
  { word: '画饼充饥', pinyin: 'hua bing chong ji', category: '成语', meaning: 'drawing a cake to satisfy hunger, vain hope', answers: ['画饼充饥','hua bing chong ji'] },
  { word: '杀鸡取卵', pinyin: 'sha ji qu luan', category: '成语', meaning: 'killing the chicken to get the eggs, short-sighted gain', answers: ['杀鸡取卵','sha ji qu luan'] },
  { word: '买椟还珠', pinyin: 'mai du huan zhu', category: '成语', meaning: 'buying the box but returning the pearl, missing the point', answers: ['买椟还珠','mai du huan zhu'] },
  { word: '杞人忧天', pinyin: 'qi ren you tian', category: '成语', meaning: 'a man from Qi worrying about the sky falling, needless anxiety', answers: ['杞人忧天','qi ren you tian'] },
  { word: '邯郸学步', pinyin: 'han dan xue bu', category: '成语', meaning: 'learning to walk in Handan, forgetting ones own way', answers: ['邯郸学步','han dan xue bu'] },
  { word: '卧薪尝胆', pinyin: 'wo xin chang dan', category: '成语', meaning: 'sleeping on firewood and tasting gall, enduring hardship for revenge', answers: ['卧薪尝胆','wo xin chang dan'] },
  { word: '画地为牢', pinyin: 'hua di wei lao', category: '成语', meaning: 'drawing a circle on the ground as a prison, self-restraint', answers: ['画地为牢','hua di wei lao'] },
  { word: '杀鸡儆猴', pinyin: 'sha ji jing hou', category: '成语', meaning: 'killing the chicken to scare the monkey, warning by example', answers: ['杀鸡儆猴','sha ji jing hou'] },
  { word: '望梅止渴', pinyin: 'wang mei zhi ke', category: '成语', meaning: 'looking at plums to quench thirst, comforting oneself with fantasy', answers: ['望梅止渴','wang mei zhi ke'] },
  { word: '骑虎难下', pinyin: 'qi hu nan xia', category: '成语', meaning: 'riding a tiger and unable to get off, in too deep to back out', answers: ['骑虎难下','qi hu nan xia'] }
];
function pickWord() { return WORD_POOL[Math.floor(Math.random() * WORD_POOL.length)]; }
function normalizeGuess(g) { return String(g || '').trim().toLowerCase(); }

const DRAW2_WORDS = [
  { word: '苹果', pinyin: 'ping guo', category: '水果', answers: ['苹果','apple'] },
  { word: '香蕉', pinyin: 'xiang jiao', category: '水果', answers: ['香蕉','banana'] },
  { word: '猫', pinyin: 'mao', category: '动物', answers: ['猫','cat','kitty'] },
  { word: '狗', pinyin: 'gou', category: '动物', answers: ['狗','dog','puppy'] },
  { word: '汽车', pinyin: 'qi che', category: '交通工具', answers: ['汽车','car','automobile'] },
  { word: '飞机', pinyin: 'fei ji', category: '交通工具', answers: ['飞机','plane','airplane'] },
  { word: '电脑', pinyin: 'dian nao', category: '物品', answers: ['电脑','computer','pc'] },
  { word: '手机', pinyin: 'shou ji', category: '物品', answers: ['手机','phone','mobile'] },
  { word: '披萨', pinyin: 'pi sa', category: '食物', answers: ['披萨','pizza'] },
  { word: '蛋糕', pinyin: 'dan gao', category: '食物', answers: ['蛋糕','cake'] },
  { word: '太阳', pinyin: 'tai yang', category: '自然', answers: ['太阳','sun'] },
  { word: '月亮', pinyin: 'yue liang', category: '自然', answers: ['月亮','moon'] },
  { word: '吉他', pinyin: 'ji ta', category: '乐器', answers: ['吉他','guitar'] },
  { word: '篮球', pinyin: 'lan qiu', category: '运动', answers: ['篮球','basketball'] },
  { word: '书', pinyin: 'shu', category: '物品', answers: ['书','book'] },
  // 新增词汇
  { word: '雨伞', pinyin: 'yu san', category: '物品', answers: ['雨伞','umbrella'] },
  { word: '房子', pinyin: 'fang zi', category: '建筑', answers: ['房子','house'] },
  { word: '树', pinyin: 'shu', category: '自然', answers: ['树','tree'] },
  { word: '花', pinyin: 'hua', category: '自然', answers: ['花','flower'] },
  { word: '鱼', pinyin: 'yu', category: '动物', answers: ['鱼','fish'] },
  { word: '鸟', pinyin: 'niao', category: '动物', answers: ['鸟','bird'] },
  { word: '椅子', pinyin: 'yi zi', category: '家具', answers: ['椅子','chair'] },
  { word: '电视', pinyin: 'dian shi', category: '电器', answers: ['电视','tv','television'] },
  { word: '冰淇淋', pinyin: 'bing qi lin', category: '食物', answers: ['冰淇淋','ice cream'] },
  { word: '汉堡', pinyin: 'han bao', category: '食物', answers: ['汉堡','hamburger','burger'] },
  { word: '火箭', pinyin: 'huo jian', category: '交通工具', answers: ['火箭','rocket'] },
  { word: '自行车', pinyin: 'zi xing che', category: '交通工具', answers: ['自行车','bike','bicycle'] },
  { word: '钢琴', pinyin: 'gang qin', category: '乐器', answers: ['钢琴','piano'] },
  { word: '足球', pinyin: 'zu qiu', category: '运动', answers: ['足球','football','soccer'] },
  { word: '眼镜', pinyin: 'yan jing', category: '物品', answers: ['眼镜','glasses'] },
  { word: '闹钟', pinyin: 'nao zhong', category: '物品', answers: ['闹钟','clock','alarm'] },
  { word: '风扇', pinyin: 'feng shan', category: '电器', answers: ['风扇','fan'] },
  { word: '马桶', pinyin: 'ma tong', category: '物品', answers: ['马桶','toilet'] },
  { word: '牙刷', pinyin: 'ya shua', category: '物品', answers: ['牙刷','toothbrush'] },
  { word: '袜子', pinyin: 'wa zi', category: '物品', answers: ['袜子','socks'] },
  { word: '帽子', pinyin: 'mao zi', category: '物品', answers: ['帽子','hat','cap'] },
  { word: '围巾', pinyin: 'wei jin', category: '物品', answers: ['围巾','scarf'] },
  { word: '手套', pinyin: 'shou tao', category: '物品', answers: ['手套','gloves'] },
  { word: '蘑菇', pinyin: 'mo gu', category: '自然', answers: ['蘑菇','mushroom'] },
  { word: '胡萝卜', pinyin: 'hu luo bo', category: '食物', answers: ['胡萝卜','carrot'] },
  { word: '南瓜', pinyin: 'nan gua', category: '食物', answers: ['南瓜','pumpkin'] },
  { word: '仙人掌', pinyin: 'xian ren zhang', category: '自然', answers: ['仙人掌','cactus'] },
  { word: '星星', pinyin: 'xing xing', category: '自然', answers: ['星星','star'] },
  { word: '彩虹', pinyin: 'cai hong', category: '自然', answers: ['彩虹','rainbow'] },
  { word: '闪电', pinyin: 'shan dian', category: '自然', answers: ['闪电','lightning'] },
  { word: '螃蟹', pinyin: 'pang xie', category: '动物', answers: ['螃蟹','crab'] },
  { word: '大象', pinyin: 'da xiang', category: '动物', answers: ['大象','elephant'] },
  { word: '长颈鹿', pinyin: 'chang jing lu', category: '动物', answers: ['长颈鹿','giraffe'] },
  { word: '冰淇淋', pinyin: 'bing qi lin', category: '食物', answers: ['冰淇淋','ice cream'] },
  { word: '甜甜圈', pinyin: 'tian tian quan', category: '食物', answers: ['甜甜圈','donut'] },
  { word: '热狗', pinyin: 're gou', category: '食物', answers: ['热狗','hot dog'] },
  { word: '钻石', pinyin: 'zuan shi', category: '物品', answers: ['钻石','diamond'] },
  { word: '皇冠', pinyin: 'huang guan', category: '物品', answers: ['皇冠','crown'] },
  { word: '城堡', pinyin: 'cheng bao', category: '建筑', answers: ['城堡','castle'] },
  { word: '金字塔', pinyin: 'jin zi ta', category: '建筑', answers: ['金字塔','pyramid'] },
  { word: '飞碟', pinyin: 'fei die', category: '交通工具', answers: ['飞碟','ufo','saucer'] },
  { word: '蜡烛', pinyin: 'la zhu', category: '物品', answers: ['蜡烛','candle'] },
  { word: '灯泡', pinyin: 'deng pao', category: '物品', answers: ['灯泡','light bulb'] },
  { word: '镜子', pinyin: 'jing zi', category: '物品', answers: ['镜子','mirror'] },
  { word: '书包', pinyin: 'shu bao', category: '物品', answers: ['书包','backpack'] },
  { word: '机器人', pinyin: 'ji qi ren', category: '物品', answers: ['机器人','robot'] },
  { word: '恐龙', pinyin: 'kong long', category: '动物', answers: ['恐龙','dinosaur'] },
  { word: '企鹅', pinyin: 'qi e', category: '动物', answers: ['企鹅','penguin'] },
  { word: '猴子', pinyin: 'hou zi', category: '动物', answers: ['猴子','monkey'] },
  { word: '熊猫', pinyin: 'xiong mao', category: '动物', answers: ['熊猫','panda'] },
  { word: '狮子', pinyin: 'shi zi', category: '动物', answers: ['狮子','lion'] },
  { word: '老虎', pinyin: 'lao hu', category: '动物', answers: ['老虎','tiger'] },
  { word: '蝴蝶', pinyin: 'hu die', category: '动物', answers: ['蝴蝶','butterfly'] },
  { word: '青蛙', pinyin: 'qing wa', category: '动物', answers: ['青蛙','frog'] },
  { word: '兔子', pinyin: 'tu zi', category: '动物', answers: ['兔子','rabbit'] },
  { word: '猪', pinyin: 'zhu', category: '动物', answers: ['猪','pig'] },
  { word: '马', pinyin: 'ma', category: '动物', answers: ['马','horse'] },
  { word: '鸡', pinyin: 'ji', category: '动物', answers: ['鸡','chicken'] },
  { word: '鸭', pinyin: 'ya', category: '动物', answers: ['鸭','duck'] },
  { word: '微笑', pinyin: 'wei xiao', category: '表情', answers: ['微笑','smile'] },
  { word: '哭泣', pinyin: 'ku qi', category: '表情', answers: ['哭泣','cry'] },
  { word: '愤怒', pinyin: 'fen nu', category: '表情', answers: ['愤怒','angry'] },
  { word: '惊讶', pinyin: 'jing ya', category: '表情', answers: ['惊讶','surprise'] },
  { word: '医生', pinyin: 'yi sheng', category: '职业', answers: ['医生','doctor'] },
  { word: '老师', pinyin: 'lao shi', category: '职业', answers: ['老师','teacher'] },
  { word: '警察', pinyin: 'jing cha', category: '职业', answers: ['警察','police'] },
  { word: '消防员', pinyin: 'xiao fang yuan', category: '职业', answers: ['消防员','firefighter'] },
  { word: '厨师', pinyin: 'chu shi', category: '职业', answers: ['厨师','chef'] },
  { word: '圣诞树', pinyin: 'sheng dan shu', category: '节日', answers: ['圣诞树','christmas tree'] },
  { word: '灯笼', pinyin: 'deng long', category: '节日', answers: ['灯笼','lantern'] },
  { word: '鞭炮', pinyin: 'bian pao', category: '节日', answers: ['鞭炮','firecracker'] },
  { word: '烟花', pinyin: 'yan hua', category: '节日', answers: ['烟花','firework'] },
  { word: '睡觉', pinyin: 'shui jiao', category: '动作', answers: ['睡觉','sleep'] },
  { word: '吃饭', pinyin: 'chi fan', category: '动作', answers: ['吃饭','eat'] },
  { word: '跑步', pinyin: 'pao bu', category: '动作', answers: ['跑步','run'] },
  { word: '跳舞', pinyin: 'tiao wu', category: '动作', answers: ['跳舞','dance'] },
  { word: '游泳', pinyin: 'you yong', category: '动作', answers: ['游泳','swim'] },
  { word: '爱心', pinyin: 'ai xin', category: '符号', answers: ['爱心','heart'] },
  { word: '裙子', pinyin: 'qun zi', category: '服装', answers: ['裙子','skirt'] },
  { word: '裤子', pinyin: 'ku zi', category: '服装', answers: ['裤子','pants'] },
  { word: '鞋子', pinyin: 'xie zi', category: '服装', answers: ['鞋子','shoes'] },
  { word: '大桥', pinyin: 'da qiao', category: '建筑', answers: ['大桥','bridge'] },
  { word: '塔', pinyin: 'ta', category: '建筑', answers: ['塔','tower'] },
  { word: '风车', pinyin: 'feng che', category: '建筑', answers: ['风车','windmill'] },
  { word: '喷泉', pinyin: 'pen quan', category: '建筑', answers: ['喷泉','fountain'] },
  { word: '云朵', pinyin: 'yun duo', category: '自然', answers: ['云朵','cloud'] },
  { word: '雨滴', pinyin: 'yu di', category: '自然', answers: ['雨滴','raindrop'] },
  { word: '雪花', pinyin: 'xue hua', category: '自然', answers: ['雪花','snowflake'] }
];
function pickDraw2Word() { return DRAW2_WORDS[Math.floor(Math.random() * DRAW2_WORDS.length)]; }

function isCorrectGuess(wordObj, guess) {
  if (!wordObj) return false;
  const g = normalizeGuess(guess);
  if (!g) return false;
  if (wordObj.word && g === wordObj.word.toLowerCase()) return true;
  if (wordObj.zh && g === wordObj.zh.toLowerCase()) return true;
  if (wordObj.answers && wordObj.answers.some(a => a && a.toLowerCase() === g)) return true;
  return false;
}

// Pre-generate image cache
const IMAGE_CACHE_TARGET = 5;
let imageCache = [];
let imageCacheBusy = false;
async function refillImageCache() {
  if (imageCacheBusy) return;
  imageCacheBusy = true;
  let attempts = 0;
  while (imageCache.length < IMAGE_CACHE_TARGET && attempts < IMAGE_CACHE_TARGET * 3) {
    attempts++;
    try {
      const wordObj = pickWord();
      const imageUrl = await generateImage(wordObj);
      if (imageUrl) imageCache.push({ wordObj, imageUrl });
    } catch (e) {
      console.error('refillImageCache error:', e.message);
      break;
    }
  }
  imageCacheBusy = false;
}
function takeCachedImage() {
  const item = imageCache.shift();
  if (item) refillImageCache();
  return item;
}

function initialDrawguessState() {
  return { status: 'waiting', round: 1, maxRounds: 5, secretWord: null, imageUrl: null, category: '', guesses: [], scores: { 1: 0, 2: 0 }, winner: null, message: '', audio: null, loading: false };
}
function initialDraw2GuessState() {
  return { status: 'waiting', round: 1, maxRounds: 6, secretWord: null, category: '', drawer: 1, strokes: [], guesses: [], scores: { 1: 0, 2: 0 }, winner: null, message: '' };
}

// ---------- Room Management ----------
const QUICK_MATCH_RESERVE_MS = 30000;
const DISCONNECT_GRACE_MS = 30000;

function connectedPlayers(room) { return room.players.filter(p => p.connected); }
function connectedPlayerCount(room) { return connectedPlayers(room).length; }
function clearDisconnectTimer(player) { if (player && player.disconnectTimer) { clearTimeout(player.disconnectTimer); player.disconnectTimer = null; } }
function schedulePlayerRemoval(room, player) {
  clearDisconnectTimer(player);
  player.disconnectTimer = setTimeout(() => {
    try {
      if (!rooms.has(room.id)) return;
      const current = room.players.find(p => p.clientId === player.clientId);
      if (current && !current.connected) actuallyRemovePlayer(room, current.socketId);
    } catch (e) { console.error('schedulePlayerRemoval error:', e.message); }
  }, DISCONNECT_GRACE_MS);
}
function actuallyRemovePlayer(room, socketId) {
  const player = getPlayer(room, socketId);
  if (player) clearDisconnectTimer(player);
  const removed = removeFromRoom(room, socketId);
  if (removed) return;
  if (connectedPlayerCount(room) < 2) resetRoomStateAfterPlayerLeave(room);
  broadcastState(room);
}
function resetRoomStateAfterPlayerLeave(room) {
  stopGameLoop(room);
  room.rematchVotes = { 1: false, 2: false };
  switch (room.gameType) {
    case 'gomoku': room.state = initialGomokuState(); break;
    case 'pong': room.state = initialPongState(); break;
    case 'tictactoe': room.state = initialTictactoeState(); break;
    case 'connect4': room.state = initialConnect4State(); break;
    case 'rps': room.state = initialRpsState(); break;
    case 'memory': room.state = initialMemoryState(); break;
    case 'dots': room.state = initialDotsState(); break;
    case 'snake': room.state = initialSnakeState(); break;
    case 'racing': room.state = initialRacingState(); break;
    case 'drawguess': room.state = initialDrawguessState(); break;
    case 'draw2guess': room.state = initialDraw2GuessState(); break;
    case 'shooter': room.state = initialShooterState(); break;
    case 'lobby': room.state = {}; break;
    case 'othello': room.state = initialOthelloState(); break;
    case 'bullsandcows': room.state = initialBullsandcowsState(); break;
    case 'blackjack': room.state = initialBlackjackState(); break;
    case 'ulttt': room.state = initialUltttState(); break;
    case 'minichess': room.state = initialMinichessState(); break;
  }
  room.lastActivity = now();
}

function createQuickMatchRoom(gameType) {
  const roomId = generateRoomId();
  const room = {
    id: roomId,
    gameType,
    isPublic: false,
    players: [],
    spectators: [],
    messages: [],
    createdAt: now(),
    lastActivity: now(),
    quickMatch: true,
    reservedUntil: now() + QUICK_MATCH_RESERVE_MS,
    rematchVotes: { 1: false, 2: false },
    state: gameType === 'gomoku' ? initialGomokuState()
         : gameType === 'pong' ? initialPongState()
         : gameType === 'drawguess' ? initialDrawguessState()
         : gameType === 'tictactoe' ? initialTictactoeState()
         : gameType === 'connect4' ? initialConnect4State()
         : gameType === 'draw2guess' ? initialDraw2GuessState()
         : gameType === 'rps' ? initialRpsState()
         : gameType === 'memory' ? initialMemoryState()
         : gameType === 'dots' ? initialDotsState()
         : gameType === 'snake' ? initialSnakeState()
         : gameType === 'shooter' ? initialShooterState()
         : gameType === 'racing' ? initialRacingState()
         : gameType === 'othello' ? initialOthelloState()
         : gameType === 'bullsandcows' ? initialBullsandcowsState()
         : gameType === 'blackjack' ? initialBlackjackState()
         : gameType === 'ulttt' ? initialUltttState()
         : gameType === 'minichess' ? initialMinichessState()
         : initialGomokuState(),
    loop: null
  };
  rooms.set(roomId, room);
  return room;
}

function createRoom(gameType, hostName, hostSocketId, isPublic = true, clientId = null) {
  const roomId = generateRoomId();
  const room = {
    id: roomId,
    gameType,
    isPublic: isPublic !== false,
    players: [{ socketId: hostSocketId, clientId: clientId || hostSocketId, name: hostName || 'Player 1', symbol: 1, isHost: true, connected: true }],
    spectators: [],
    messages: [],
    createdAt: now(),
    lastActivity: now(),
    rematchVotes: { 1: false, 2: false },
    state: gameType === 'gomoku' ? initialGomokuState()
         : gameType === 'pong' ? initialPongState()
         : gameType === 'drawguess' ? initialDrawguessState()
         : gameType === 'tictactoe' ? initialTictactoeState()
         : gameType === 'connect4' ? initialConnect4State()
         : gameType === 'draw2guess' ? initialDraw2GuessState()
         : gameType === 'rps' ? initialRpsState()
         : gameType === 'memory' ? initialMemoryState()
         : gameType === 'dots' ? initialDotsState()
         : gameType === 'snake' ? initialSnakeState()
         : gameType === 'shooter' ? initialShooterState()
         : gameType === 'racing' ? initialRacingState()
         : gameType === 'othello' ? initialOthelloState()
         : gameType === 'bullsandcows' ? initialBullsandcowsState()
         : gameType === 'blackjack' ? initialBlackjackState()
         : gameType === 'ulttt' ? initialUltttState()
         : gameType === 'minichess' ? initialMinichessState()
         : initialGomokuState(),
    loop: null
  };
  rooms.set(roomId, room);
  return room;
}
function joinRoomAsPlayer(room, socketId, playerName, clientId = null) {
  const existing = clientId ? room.players.find(p => p.clientId === clientId) : null;
  if (existing) {
    existing.socketId = socketId;
    existing.connected = true;
    existing.name = playerName || existing.name;
    clearDisconnectTimer(existing);
    return existing;
  }
  if (room.players.length >= 2) return null;
  const symbol = room.players.length + 1;
  const isHost = room.players.length === 0;
  const player = { socketId, clientId: clientId || socketId, name: playerName || `Player ${symbol}`, symbol, isHost, connected: true };
  room.players.push(player);
  return player;
}
function joinRoomAsSpectator(room, socketId, playerName) {
  const spec = { socketId, name: playerName || `Spectator ${room.spectators.length + 1}` };
  room.spectators.push(spec);
  return spec;
}
function removeFromRoom(room, socketId) {
  const player = getPlayer(room, socketId);
  if (player) clearDisconnectTimer(player);
  room.players = room.players.filter(p => p.socketId !== socketId);
  room.spectators = room.spectators.filter(s => s.socketId !== socketId);
  if (room.players.length === 0 && room.spectators.length === 0) {
    stopGameLoop(room);
    rooms.delete(room.id);
    return true;
  }
  if (room.players.length > 0 && !room.players[0].isHost) {
    room.players[0].isHost = true;
    room.players[0].symbol = 1;
    if (room.players[1]) room.players[1].symbol = 2;
  }
  return false;
}
function getPlayer(room, socketId) { return room.players.find(p => p.socketId === socketId); }
function publicRoomState(room) {
  try {
    const state = JSON.parse(JSON.stringify(room.state));
    delete state.secretWord;
    delete state.secrets;
    if (room.gameType === 'blackjack' && state.dealerHidden && Array.isArray(state.dealerHand) && state.dealerHand.length > 1) {
      state.dealerHand = [state.dealerHand[0], { hidden: true }];
    }
    return { roomId: room.id, gameType: room.gameType, isPublic: room.isPublic, players: room.players.map(p => ({ name: p.name, symbol: p.symbol, isHost: p.isHost, connected: p.connected })), spectators: room.spectators.length, rematchVotes: room.rematchVotes, state };
  } catch (e) {
    console.error('publicRoomState error:', e.message);
    return { roomId: room.id, gameType: room.gameType, isPublic: room.isPublic, players: room.players.map(p => ({ name: p.name, symbol: p.symbol, isHost: p.isHost, connected: p.connected })), spectators: room.spectators.length, rematchVotes: room.rematchVotes, state: {} };
  }
}
function emitRoom(room, event, payload) {
  try { io.to(room.id).emit(event, payload); }
  catch (e) { console.error('emitRoom error:', e.message); }
}
function gameStateEvent(gameType) {
  return ['othello', 'bullsandcows', 'blackjack', 'ulttt', 'minichess'].includes(gameType) ? 'game:state' : `${gameType}:state`;
}
function broadcastState(room) {
  try { emitRoom(room, gameStateEvent(room.gameType), publicRoomState(room)); }
  catch (e) { console.error('broadcastState error:', e.message); }
}

function removeFromQuickMatch(socket) {
  for (const queue of quickMatchQueue.values()) queue.delete(socket.id);
}
function findQuickMatch(gameType, socket, playerName, clientId) {
  try {
    if (!ALL_GAMES.includes(gameType)) return;
    if (socket.roomId) { socket.emit('error', { message: '你已经在房间中，无法匹配' }); return; }
    removeFromQuickMatch(socket);
    let queue = quickMatchQueue.get(gameType);
    if (!queue) { queue = new Map(); quickMatchQueue.set(gameType, queue); }
    for (const [sid, entry] of queue) {
      const other = entry.socket;
      if (other && other.connected && other.id !== socket.id) {
        queue.delete(sid);
        const room = createQuickMatchRoom(gameType);
        rooms.set(room.id, room);

        // Join both sockets as players immediately
        const p1 = joinRoomAsPlayer(room, other.id, entry.name, entry.clientId || other.id);
        const p2 = joinRoomAsPlayer(room, socket.id, playerName || 'Player', clientId || socket.id);
        if (!p1 || !p2) { rooms.delete(room.id); return; }

        [other, socket].forEach((s, idx) => {
          s.join(room.id);
          s.roomId = room.id;
          s.playerSymbol = idx === 0 ? p1.symbol : p2.symbol;
        });

        // Start the game if applicable
        if (gameType === 'pong') startPongIfReady(room);
        else if (['gomoku','tictactoe','connect4','rps','memory','dots','othello','bullsandcows','blackjack','ulttt','minichess'].includes(gameType)) startGameIfReady(room);
        else if (gameType === 'snake') { /* snake requires ready/start, leave waiting */ }

        const common = publicRoomState(room);
        other.emit('quickMatch:found', { ...common, you: { socketId: other.id, name: p1.name, symbol: p1.symbol, isHost: p1.isHost } });
        socket.emit('quickMatch:found', { ...common, you: { socketId: socket.id, name: p2.name, symbol: p2.symbol, isHost: p2.isHost } });
        return;
      }
    }
    queue.set(socket.id, { socket, name: playerName || 'Player', clientId });
    socket.emit('quickMatch:waiting', { gameType });
  } catch (e) { console.error('findQuickMatch error:', e.message); }
}

// ---------- Gomoku ----------
function checkGomokuWin(board, row, col, player) {
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (let i = 1; i < 5; i++) { const r=row+dr*i,c=col+dc*i; if (r>=0&&r<15&&c>=0&&c<15&&board[r][c]===player) count++; else break; }
    for (let i = 1; i < 5; i++) { const r=row-dr*i,c=col-dc*i; if (r>=0&&r<15&&c>=0&&c<15&&board[r][c]===player) count++; else break; }
    if (count >= 5) return true;
  }
  return false;
}
function gomokuDraw(board) { for (let r=0;r<15;r++) for(let c=0;c<15;c++) if(board[r][c]===0) return false; return true; }
function handleGomokuMove(room, socketId, { row, col }) {
  const player = getPlayer(room, socketId);
  if (!player || room.state.status !== 'playing' || room.state.gameOver || room.state.currentPlayer !== player.symbol) return;
  row = parseInt(row, 10); col = parseInt(col, 10);
  if (Number.isNaN(row)||row<0||row>=15||Number.isNaN(col)||col<0||col>=15||room.state.board[row][col]!==0) return;
  room.state.board[row][col] = player.symbol;
  room.state.lastMove = { row, col, symbol: player.symbol };
  if (checkGomokuWin(room.state.board, row, col, player.symbol)) { room.state.gameOver=true; room.state.winner=player.symbol; room.state.status='ended'; }
  else if (gomokuDraw(room.state.board)) { room.state.gameOver=true; room.state.winner=null; room.state.status='ended'; }
  else room.state.currentPlayer = room.state.currentPlayer===1?2:1;
  room.lastActivity = now();
  broadcastState(room);
}
function resetGomoku(room, socketId) {
  const p=getPlayer(room,socketId); if(!p||!p.isHost) return;
  const nextFirst = room.state.firstPlayer === 1 ? 2 : 1;
  room.state=initialGomokuState(); room.state.firstPlayer=nextFirst; room.state.currentPlayer=nextFirst;
  room.lastActivity=now(); broadcastState(room);
}

// ---------- Pong (Vertical) ----------
const PONG = { paddleW: 0.22, paddleH: 0.025, paddleOff: 0.04, ballR: 0.018, maxSpeed: 0.04, tickMs: 33 };
function startPongIfReady(room) {
  if (room.gameType !== 'pong') return;
  if (connectedPlayerCount(room) === 2 && room.state.status === 'waiting') {
    room.state.status = 'waitingServe';
    room.state.server = Math.random() > 0.5 ? 1 : 2;
    room.state.ball = { x: 0.5, y: 0.5, vx: 0, vy: 0 };
    startGameLoop(room, () => updatePong(room));
  }
}
function updatePong(room) {
  const s = room.state;
  if (s.status !== 'playing') return;
  let { x, y, vx, vy } = s.ball;
  x += vx; y += vy;
  if (x - PONG.ballR < 0) { x = PONG.ballR; vx = Math.abs(vx); }
  if (x + PONG.ballR > 1) { x = 1 - PONG.ballR; vx = -Math.abs(vx); }
  const p1 = s.paddles[0].x, p2 = s.paddles[1].x;
  const topY = PONG.paddleOff + PONG.paddleH;
  const botY = 1 - PONG.paddleOff - PONG.paddleH;
  if (y - PONG.ballR <= topY && y > PONG.paddleOff && x >= p1 - PONG.paddleW/2 && x <= p1 + PONG.paddleW/2) {
    const hit = (x - p1) / (PONG.paddleW / 2);
    vy = Math.abs(vy) * 1.04;
    vx += hit * 0.015;
    y = topY + PONG.ballR;
  }
  if (y + PONG.ballR >= botY && y < 1 - PONG.paddleOff && x >= p2 - PONG.paddleW/2 && x <= p2 + PONG.paddleW/2) {
    const hit = (x - p2) / (PONG.paddleW / 2);
    vy = -Math.abs(vy) * 1.04;
    vx += hit * 0.015;
    y = botY - PONG.ballR;
  }
  const speed = Math.hypot(vx, vy);
  if (speed > PONG.maxSpeed) { const r=PONG.maxSpeed/speed; vx*=r; vy*=r; }
  if (y < 0) {
    s.scores[1]++;
    if (s.scores[1] >= s.targetScore) { s.status='ended'; s.winner=2; }
    else { s.status='waitingServe'; s.server=2; s.ball={x:0.5,y:0.5,vx:0,vy:0}; x=s.ball.x; y=s.ball.y; vx=s.ball.vx; vy=s.ball.vy; }
  } else if (y > 1) {
    s.scores[0]++;
    if (s.scores[0] >= s.targetScore) { s.status='ended'; s.winner=1; }
    else { s.status='waitingServe'; s.server=1; s.ball={x:0.5,y:0.5,vx:0,vy:0}; x=s.ball.x; y=s.ball.y; vx=s.ball.vx; vy=s.ball.vy; }
  }
  s.ball = { x, y, vx, vy };
  s.lastUpdate = now();
  emitRoom(room, 'pong:state', publicRoomState(room));
  room.lastActivity = now();
}
function handlePongPaddle(room, socketId, { x }) {
  const player = getPlayer(room, socketId);
  if (!player || room.state.status === 'ended') return;
  let val = parseFloat(x);
  if (Number.isNaN(val)) return;
  val = Math.max(PONG.paddleW/2, Math.min(1 - PONG.paddleW/2, val));
  room.state.paddles[player.symbol-1].x = val;
  room.lastActivity = now();
}
function handlePongServe(room, socketId) {
  const player = getPlayer(room, socketId);
  if (!player || room.state.status !== 'waitingServe' || room.state.server !== player.symbol) return;
  room.state.status = 'playing';
  resetPongBall(room.state, room.state.server === 1 ? 1 : -1);
  room.lastActivity = now();
  emitRoom(room, 'pong:state', publicRoomState(room));
}
function resetPong(room, socketId) {
  const p=getPlayer(room,socketId); if(!p||!p.isHost) return;
  stopGameLoop(room); room.state=initialPongState(); room.lastActivity=now(); broadcastState(room); startPongIfReady(room);
}

// ---------- Tic-Tac-Toe ----------
function checkTttWin(board, player) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a,b,c] of lines) {
    const ar=Math.floor(a/3), ac=a%3, br=Math.floor(b/3), bc=b%3, cr=Math.floor(c/3), cc=c%3;
    if (board[ar][ac]===player && board[br][bc]===player && board[cr][cc]===player) return true;
  }
  return false;
}
function handleTictactoeMove(room, socketId, { row, col }) {
  const player = getPlayer(room, socketId);
  if (!player || room.state.status !== 'playing' || room.state.gameOver || room.state.currentPlayer !== player.symbol) return;
  row = parseInt(row, 10); col = parseInt(col, 10);
  if (Number.isNaN(row)||row<0||row>2||Number.isNaN(col)||col<0||col>2||room.state.board[row][col]!==0) return;
  room.state.board[row][col] = player.symbol;
  room.state.moves++;
  if (checkTttWin(room.state.board, player.symbol)) { room.state.gameOver=true; room.state.winner=player.symbol; }
  else if (room.state.moves === 9) { room.state.gameOver=true; room.state.winner=null; }
  else room.state.currentPlayer = room.state.currentPlayer===1?2:1;
  room.lastActivity = now(); broadcastState(room);
}
function resetTictactoe(room, socketId) {
  const p=getPlayer(room,socketId); if(!p||!p.isHost) return;
  const nextFirst = room.state.firstPlayer === 1 ? 2 : 1;
  room.state=initialTictactoeState(); room.state.firstPlayer=nextFirst; room.state.currentPlayer=nextFirst;
  room.lastActivity=now(); broadcastState(room);
}

// ---------- Connect Four ----------
function connect4Drop(room, socketId, { col }) {
  const player = getPlayer(room, socketId);
  if (!player || room.state.status !== 'playing' || room.state.gameOver || room.state.currentPlayer !== player.symbol) return;
  col = parseInt(col, 10);
  if (Number.isNaN(col)||col<0||col>=7||room.state.board[0][col]!==0) return;
  let row = 5;
  while (row >= 0 && room.state.board[row][col] !== 0) row--;
  if (row < 0) return;
  room.state.board[row][col] = player.symbol;
  room.state.lastMove = { row, col, symbol: player.symbol };
  if (checkConnect4Win(room.state.board, row, col, player.symbol)) { room.state.gameOver=true; room.state.winner=player.symbol; }
  else if (room.state.board.every(r=>r.every(c=>c!==0))) { room.state.gameOver=true; room.state.winner=null; }
  else room.state.currentPlayer = room.state.currentPlayer===1?2:1;
  room.lastActivity = now(); broadcastState(room);
}
function checkConnect4Win(board, row, col, player) {
  const dirs = [[0,1],[1,0],[1,1],[1,-1]];
  for (const [dr,dc] of dirs) {
    let count=1;
    for (let i=1;i<4;i++){const r=row+dr*i,c=col+dc*i;if(r>=0&&r<6&&c>=0&&c<7&&board[r][c]===player)count++;else break;}
    for (let i=1;i<4;i++){const r=row-dr*i,c=col-dc*i;if(r>=0&&r<6&&c>=0&&c<7&&board[r][c]===player)count++;else break;}
    if (count>=4) return true;
  }
  return false;
}
function resetConnect4(room, socketId) {
  const p=getPlayer(room,socketId); if(!p||!p.isHost) return;
  const nextFirst = room.state.firstPlayer === 1 ? 2 : 1;
  room.state=initialConnect4State(); room.state.firstPlayer=nextFirst; room.state.currentPlayer=nextFirst;
  room.lastActivity=now(); broadcastState(room);
}

// ---------- Draw2Guess (Human Draw) ----------
function draw2WordObj() {
  const w = pickDraw2Word();
  return { ...w, zh: w.word };
}
function publicDraw2State(room) {
  const state = JSON.parse(JSON.stringify(room.state));
  delete state.secretWord;
  return { roomId: room.id, gameType: room.gameType, isPublic: room.isPublic, players: room.players.map(p => ({ name: p.name, symbol: p.symbol, isHost: p.isHost })), spectators: room.spectators.length, rematchVotes: room.rematchVotes, state };
}
function emitDraw2State(room) { io.to(room.id).emit('draw2guess:state', publicDraw2State(room)); }
function emitDraw2Word(room) {
  const wordObj = DRAW2_WORDS.find(w => w.word === room.state.secretWord);
  room.players.forEach(p => {
    if (p.symbol === room.state.drawer) io.to(p.socketId).emit('draw2guess:word', { word: room.state.secretWord, category: room.state.category });
  });
}
async function startDraw2GuessRound(room) {
  try {
    const wordObj = draw2WordObj();
    room.state.secretWord = wordObj.word;
    room.state.category = wordObj.category;
    room.state.strokes = [];
    room.state.guesses = [];
    room.state.message = '';
    room.state.winner = null;
    room.state.status = 'drawing';
    room.lastActivity = now();
    emitDraw2State(room);
    emitDraw2Word(room);
  } catch (e) {
    console.error('startDraw2GuessRound error:', e.message);
  }
}
function handleDraw2GuessStroke(room, socketId, { stroke }) {
  const player = getPlayer(room, socketId);
  if (!player || room.state.status !== 'drawing' || player.symbol !== room.state.drawer) return;
  if (!Array.isArray(stroke)) return;
  if (stroke.length === 0) room.state.strokes = [];
  else room.state.strokes.push(stroke);
  room.lastActivity = now();
  emitDraw2State(room);
}
async function judgeGuess(wordObj, guess) {
  if (!AGNES_KEY) return { score: 0, reason: 'AI 裁判未启用' };
  if (!wordObj) return { score: 0, reason: '题目无效' };
  try {
    const res = await axios.post(`${AGNES_BASE_URL}/chat/completions`, {
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: 'You are a judge for a Chinese drawing-guessing game. Compare the player guess to the target word. Rate semantic similarity from 0 to 100. Return only JSON: {"score":number,"reason":"short Chinese reason"}.' },
        { role: 'user', content: `Target word: ${wordObj.word} (category: ${wordObj.category}). Player guess: ${guess}. Score 0-100.` }
      ],
      temperature: 0.5,
      response_format: { type: 'json_object' }
    }, { headers: { Authorization: `Bearer ${AGNES_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    const parsed = JSON.parse(res.data.choices[0].message.content || '{}');
    return { score: Math.max(0, Math.min(100, parseInt(parsed.score, 10) || 0)), reason: String(parsed.reason || '') };
  } catch (e) { console.error('Judge failed', e.message); return { score: 0, reason: '裁判出错' }; }
}
async function handleDraw2GuessGuess(room, socketId, { guess }) {
  try {
    if (room.state.status !== 'drawing' && room.state.status !== 'guessing') return;
    const player = getPlayer(room, socketId);
    if (!player || player.symbol === room.state.drawer) return;
    const g = String(guess || '').trim();
    if (!g) return;
    if (!room.state.secretWord) return;
    const wordObj = DRAW2_WORDS.find(w => w.word === room.state.secretWord);
    const exact = isCorrectGuess(wordObj, g);
    room.state.guesses.push({ player: player.name, guess: g, symbol: player.symbol });
    room.lastActivity = now();
    if (exact) {
      room.state.scores[player.symbol] = (room.state.scores[player.symbol] || 0) + 100;
      room.state.winner = player.symbol;
      room.state.status = 'ended';
      room.state.message = `🎉 ${player.name} 完全猜中！答案是 ${room.state.secretWord}，+100 分`;
      emitDraw2State(room);
      return;
    }
    room.state.status = 'judging';
    emitDraw2State(room);
    const judgement = await judgeGuess(wordObj, g);
    const bonus = Math.round(judgement.score / 2); // partial score
    room.state.scores[player.symbol] = (room.state.scores[player.symbol] || 0) + bonus;
    room.state.status = 'ended';
    room.state.winner = player.symbol;
    room.state.message = `答案：${room.state.secretWord}。"${g}" 相似度 ${judgement.score}，${judgement.reason || ''} +${bonus} 分`;
    emitDraw2State(room);
  } catch (e) {
    console.error('handleDraw2GuessGuess error:', e.message);
  }
}
async function nextDraw2GuessRound(room, socketId) {
  try {
    const p = getPlayer(room, socketId); if (!p || !p.isHost) return;
    if (room.state.round >= room.state.maxRounds && room.state.status === 'ended') {
      const s1 = room.state.scores[1] || 0, s2 = room.state.scores[2] || 0;
      room.state.status = 'finished';
      room.state.message = `🏆 结束！P1 ${s1} : P2 ${s2}`;
      emitDraw2State(room); return;
    }
    room.state.round++;
    room.state.drawer = room.state.drawer === 1 ? 2 : 1;
    await startDraw2GuessRound(room);
  } catch (e) {
    console.error('nextDraw2GuessRound error:', e.message);
  }
}
function resetDraw2Guess(room, socketId) {
  const p = getPlayer(room, socketId); if (!p || !p.isHost) return;
  room.state = initialDraw2GuessState(); room.lastActivity = now();
  emitDraw2State(room);
}

// ---------- Drawguess (AI Image) ----------
async function generateImage(wordObj) {
  if (!AGNES_KEY) return null;
  try {
    const subject = wordObj.meaning || wordObj.word;
    const prompt = `A simple cute cartoon illustration depicting: ${subject}. Centered on a clean white background, no text, no letters, no Chinese characters, minimal style.`;
    const res = await axios.post(`${AGNES_BASE_URL}/images/generations`, {
      model: IMAGE_MODEL, prompt, n: 1, size: '512x512'
    }, { headers: { Authorization: `Bearer ${AGNES_KEY}`, 'Content-Type': 'application/json' }, timeout: 60000 });
    return res.data.data[0]?.url || null;
  } catch (e) {
    console.error('Image generation failed:', e.message);
    return null;
  }
}
async function synthesize(text, voice = TTS_VOICE, model = TTS_MODEL) {
  if (!MIMO_KEY) return null;
  try {
    const res = await axios.post(`${MIMO_BASE_URL}/chat/completions`, {
      model, messages: [{ role: 'user', content: '用自然、活泼的中文语调朗读。' }, { role: 'assistant', content: text }],
      audio: { format: 'wav', voice }
    }, { headers: { 'api-key': MIMO_KEY, 'Content-Type': 'application/json' }, timeout: 25000 });
    const audio = res.data.choices[0].message.audio;
    return audio ? `data:audio/wav;base64,${audio.data}` : null;
  } catch (e) { console.error('TTS failed:', e.message); return null; }
}
async function generateDrawguessHint(wordObj) {
  if (!AGNES_KEY) return 'AI 提示未启用';
  if (!wordObj) return '暂无提示';
  try {
    const res = await axios.post(`${AGNES_BASE_URL}/chat/completions`, {
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: '你是“画图猜成语”游戏的提示助手。请根据目标成语生成一条简短的中文线索，帮助玩家联想到这个成语，但绝不能直接写出成语中的任何字，也不能用拼音、谐音或近义词明示答案。线索要有启发性，可描述典故、场景、寓意或画面重点。只返回提示文本，不要加引号、编号或解释。' },
        { role: 'user', content: `目标成语：${wordObj.word}。含义：${wordObj.meaning || ''}。请生成一条提示。` }
      ],
      temperature: 0.8,
      max_tokens: 80
    }, { headers: { Authorization: `Bearer ${AGNES_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    const hint = String(res.data.choices[0]?.message?.content || '').trim();
    return hint || '暂无提示';
  } catch (e) {
    console.error('Hint generation failed:', e.message);
    return '提示生成失败，请重试';
  }
}
async function startDrawguessRound(room) {
  try {
    let wordObj, imageUrl;
    const cached = takeCachedImage();
    if (cached) { wordObj = cached.wordObj; imageUrl = cached.imageUrl; }
    else { wordObj = pickWord(); imageUrl = null; }
    room.state.secretWord = wordObj.word;
    room.state.category = wordObj.category;
    room.state.guesses = [];
    room.state.message = '';
    room.state.winner = null;
    room.state.status = 'playing';
    room.state.loading = true;
    room.state.audio = null;
    broadcastState(room);
    if (!imageUrl) {
      try { imageUrl = await generateImage(wordObj); }
      catch (e) { console.error('generateImage error:', e.message); imageUrl = null; }
    }
    room.state.imageUrl = imageUrl;
    room.state.loading = false;
    try { room.state.audio = await synthesize(`请猜这个成语`); }
    catch (e) { console.error('synthesize error:', e.message); room.state.audio = null; }
    room.lastActivity = now();
    broadcastState(room);
    refillImageCache().catch(e => console.error('refillImageCache error:', e.message));
  } catch (e) {
    console.error('startDrawguessRound error:', e.message);
    if (room && room.state) { room.state.loading = false; room.state.message = '开局出错，请重试'; broadcastState(room); }
  }
}
async function handleDrawguessGuess(room, socketId, { guess }) {
  try {
    if (room.state.status !== 'playing') return;
    const player = getPlayer(room, socketId);
    if (!player) return;
    if (!guess) return;
    if (!room.state.secretWord) return;
    const wordObj = WORD_POOL.find(w => w.word && w.word.toLowerCase() === room.state.secretWord.toLowerCase());
    const correct = isCorrectGuess(wordObj, guess);
    const displayGuess = String(guess).trim();
    room.state.guesses.push({ player: player.name, guess: displayGuess, symbol: player.symbol });
    room.lastActivity = now();
    if (correct) {
      room.state.scores[player.symbol] = (room.state.scores[player.symbol]||0)+1;
      room.state.winner = player.symbol;
      room.state.status = 'ended';
      room.state.message = `🎉 ${player.name} 猜对了！答案是 ${room.state.secretWord}`;
    } else {
      room.state.message = `❌ ${player.name} 猜错了`;
    }
    broadcastState(room);
  } catch (e) {
    console.error('handleDrawguessGuess error:', e.message);
  }
}
async function nextDrawguessRound(room, socketId) {
  try {
    const p = getPlayer(room, socketId);
    if (!p || !p.isHost) return;
    if (room.state.round >= room.state.maxRounds && room.state.status === 'ended') {
      room.state.status = 'finished';
      room.state.message = `🏆 结束！最终 ${room.state.scores[1]} : ${room.state.scores[2]}`;
      broadcastState(room);
      return;
    }
    room.state.round++;
    await startDrawguessRound(room);
  } catch (e) {
    console.error('nextDrawguessRound error:', e.message);
  }
}
function resetDrawguess(room, socketId) { const p=getPlayer(room,socketId); if(!p||!p.isHost) return; room.state=initialDrawguessState(); room.lastActivity=now(); broadcastState(room); }

// ---------- RPS ----------
function rpsJudge(a, b) { if (a === b) return 0; if ((a === '✊' && b === '✂️') || (a === '✂️' && b === '🖐️') || (a === '🖐️' && b === '✊')) return 1; return -1; }
function handleRpsChoice(room, socketId, { choice }) {
  const player = getPlayer(room, socketId);
  if (!player || !player.connected || room.state.status !== 'choosing') return;
  if (!['✊','✂️','🖐️'].includes(choice)) return;
  // 防止已出拳后改签
  if (room.state.choices[player.symbol] !== null) return;
  room.state.choices[player.symbol] = choice;
  room.lastActivity = now();
  if (room.state.choices[1] && room.state.choices[2]) {
    const a = room.state.choices[1], b = room.state.choices[2];
    const result = rpsJudge(a, b);
    room.state.result = result === 1 ? 1 : result === -1 ? 2 : 0;
    if (result !== 0) room.state.scores[result - 1]++;
    const target = room.state.target || 2;
    const maxRounds = 3;
    const reachedTarget = room.state.scores[0] >= target || room.state.scores[1] >= target;
    const reachedMaxRounds = room.state.round >= maxRounds;
    if (reachedTarget || reachedMaxRounds) {
      room.state.winner = room.state.scores[0] > room.state.scores[1] ? 1 : room.state.scores[0] < room.state.scores[1] ? 2 : 0;
      room.state.status = 'finished';
      broadcastState(room);
    } else {
      room.state.status = 'result';
      broadcastState(room);
      // 服务器控制流程：自动进入下一轮
      setTimeout(() => {
        if (!rooms.has(room.id)) return;
        if (room.state.status !== 'result') return;
        room.state.round++;
        room.state.choices = { 1: null, 2: null };
        room.state.result = null;
        room.state.status = 'choosing';
        room.lastActivity = now();
        broadcastState(room);
      }, 1500);
    }
  } else {
    broadcastState(room);
  }
}
function nextRpsRound(room, socketId) {
  const p = getPlayer(room, socketId); if (!p || !p.isHost) return;
  if (room.state.status !== 'result' && room.state.status !== 'finished') return;
  if (room.state.status === 'finished') {
    room.state = initialRpsState(); room.state.status = connectedPlayerCount(room) === 2 ? 'choosing' : 'waiting';
  } else {
    room.state.round++; room.state.choices = { 1: null, 2: null }; room.state.result = null; room.state.status = 'choosing';
  }
  room.lastActivity = now(); broadcastState(room);
}
function startRps(room, socketId) {
  const p = getPlayer(room, socketId); if (!p || !p.isHost) return;
  if (connectedPlayerCount(room) < 2) return;
  room.state.status = 'choosing'; room.state.choices = { 1: null, 2: null }; room.state.result = null; room.state.scores = [0, 0]; room.state.round = 1; room.state.winner = null;
  room.lastActivity = now(); broadcastState(room);
}
function resetRps(room, socketId) {
  const p = getPlayer(room, socketId); if (!p || !p.isHost) return;
  room.state = initialRpsState(); room.state.status = connectedPlayerCount(room) === 2 ? 'choosing' : 'waiting'; room.lastActivity = now(); broadcastState(room);
}

// ---------- Memory ----------
function handleMemoryFlip(room, socketId, { index }) {
  const player = getPlayer(room, socketId);
  if (!player || !player.connected || room.state.status !== 'playing' || room.state.currentPlayer !== player.symbol || connectedPlayerCount(room) < 2) return;
  index = parseInt(index, 10);
  if (Number.isNaN(index) || index < 0 || index >= room.state.cards.length) return;
  const card = room.state.cards[index];
  if (card.flipped || card.matched || room.state.flipped.length >= 2) return;
  card.flipped = true; room.state.flipped.push(index); room.lastActivity = now();
  if (room.state.flipped.length === 2) {
    const [i1, i2] = room.state.flipped;
    if (room.state.cards[i1].icon === room.state.cards[i2].icon) {
      room.state.cards[i1].matched = true; room.state.cards[i2].matched = true;
      room.state.scores[player.symbol - 1]++;
      room.state.flipped = [];
      room.state.message = `✅ ${player.name} 配对成功！`;
    } else {
      room.state.message = `❌ 不匹配，轮到对手`;
    }
    if (room.state.cards.every(c => c.matched)) {
      const s1 = room.state.scores[0], s2 = room.state.scores[1];
      room.state.winner = s1 === s2 ? null : (s1 > s2 ? 1 : 2);
      room.state.status = 'finished';
    }
  }
  broadcastState(room);
  if (room.state.flipped.length === 2 && room.state.status !== 'finished') {
    setTimeout(() => {
      room.state.flipped.forEach(i => { if (!room.state.cards[i].matched) room.state.cards[i].flipped = false; });
      room.state.currentPlayer = room.state.currentPlayer === 1 ? 2 : 1;
      room.state.flipped = [];
      room.lastActivity = now(); broadcastState(room);
    }, 1200);
  }
}
function resetMemory(room, socketId) {
  const p = getPlayer(room, socketId); if (!p || !p.isHost) return;
  const nextFirst = room.state.firstPlayer === 1 ? 2 : 1;
  room.state = initialMemoryState(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; room.state.status = connectedPlayerCount(room) === 2 ? 'playing' : 'waiting';
  room.lastActivity = now(); broadcastState(room);
}

// ---------- Dots ----------
function dotsLinesDrawn(state) { let n = 0; for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) if (state.edges[0][r][c]) n++; for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) if (state.edges[1][r][c]) n++; return n; }
function dotsCheckBoxes(state, player) {
  let gained = 0;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
    if (state.boxes[r][c]) continue;
    if (state.edges[0][r][c] && state.edges[0][r + 1][c] && state.edges[1][r][c] && state.edges[1][r][c + 1]) {
      state.boxes[r][c] = player; gained++; state.scores[player - 1]++;
    }
  }
  return gained;
}
function handleDotsLine(room, socketId, { dir, r, c }) {
  const player = getPlayer(room, socketId);
  if (!player || !player.connected || room.state.status !== 'playing' || room.state.currentPlayer !== player.symbol || connectedPlayerCount(room) < 2) return;
  dir = parseInt(dir, 10); r = parseInt(r, 10); c = parseInt(c, 10);
  if (dir !== 0 && dir !== 1) return;
  const bounds = dir === 0 ? (r >= 0 && r < 4 && c >= 0 && c < 3) : (r >= 0 && r < 3 && c >= 0 && c < 4);
  if (!bounds || room.state.edges[dir][r][c]) return;
  room.state.edges[dir][r][c] = player; room.state.moves = dotsLinesDrawn(room.state);
  const gained = dotsCheckBoxes(room.state, player);
  if (gained === 0) room.state.currentPlayer = room.state.currentPlayer === 1 ? 2 : 1;
  if (room.state.moves >= room.state.totalLines) {
    const s1 = room.state.scores[0], s2 = room.state.scores[1];
    room.state.winner = s1 === s2 ? null : (s1 > s2 ? 1 : 2);
    room.state.status = 'finished';
  }
  room.lastActivity = now(); broadcastState(room);
}
function resetDots(room, socketId) {
  const p = getPlayer(room, socketId); if (!p || !p.isHost) return;
  const nextFirst = room.state.firstPlayer === 1 ? 2 : 1;
  room.state = initialDotsState(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; room.state.status = connectedPlayerCount(room) === 2 ? 'playing' : 'waiting';
  room.lastActivity = now(); broadcastState(room);
}

// ---------- Snake ----------
function broadcastSnakeState(room) { io.to(room.id).emit('snake:state', publicRoomState(room)); }
function startSnake(room) {
  if (connectedPlayerCount(room) < 2 || room.state.status !== 'waiting') return;
  room.state.walls = getMapWalls(room.state.map);
  room.state.snakes = {};
  room.state.dirs = { 1: { x: 1, y: 0 }, 2: { x: -1, y: 0 } };
  room.state.nextDirs = { 1: { x: 1, y: 0 }, 2: { x: -1, y: 0 } };
  room.state.scores = { 1: 0, 2: 0 };
  room.state.lives = { 1: 3, 2: 3 };
  room.state.ready = { 1: false, 2: false };
  room.state.dead = { 1: false, 2: false };
  room.state.respawnAt = { 1: 0, 2: 0 };
  room.state.foods = [];
  room.state.winner = null;
  room.state.message = '';
  room.players.forEach(p => { room.state.snakes[p.symbol] = spawnSnake(p.symbol, room.state.map); });
  room.players.forEach(p => { room.state.foods[p.symbol - 1] = spawnSnakeFood(room); });
  room.state.status = 'playing';
  room.lastActivity = now();
  startGameLoop(room, () => updateSnake(room), 160);
  broadcastSnakeState(room);
}
function spawnSnakeFood(room) {
  const allSegs = [];
  Object.values(room.state.snakes).forEach(s => { if (s) allSegs.push(...s); });
  let pos;
  do {
    pos = { x: Math.floor(Math.random() * SNAKE_GRID), y: Math.floor(Math.random() * SNAKE_GRID) };
  } while (allSegs.some(s => s.x === pos.x && s.y === pos.y) || room.state.walls.some(w => w.x === pos.x && w.y === pos.y));
  return pos;
}
function opposite(d1, d2) { return d1.x + d2.x === 0 && d1.y + d2.y === 0; }
function handleSnakeDir(room, socketId, dirName) {
  const player = getPlayer(room, socketId);
  if (!player || room.state.status !== 'playing') return;
  const dirs = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
  const nd = dirs[dirName];
  if (!nd) return;
  const sym = player.symbol;
  const cur = room.state.nextDirs[sym] || room.state.dirs[sym];
  if (opposite(cur, nd)) return;
  room.state.nextDirs[sym] = nd;
  room.lastActivity = now();
}
function handleSnakeReady(room, socketId) {
  const player = getPlayer(room, socketId);
  if (!player || room.state.status !== 'waiting') return;
  room.state.ready[player.symbol] = true;
  room.lastActivity = now();
  broadcastSnakeState(room);
  if (room.state.ready[1] && room.state.ready[2]) startSnake(room);
}
function handleSnakeMap(room, socketId, { map }) {
  const player = getPlayer(room, socketId);
  if (!player || !player.isHost || room.state.status !== 'waiting') return;
  if (!SNAKE_MAPS[map]) return;
  room.state.map = map;
  room.lastActivity = now();
  broadcastSnakeState(room);
}
function resetSnake(room, socketId) {
  const p = getPlayer(room, socketId); if (!p || !p.isHost) return;
  stopGameLoop(room);
  room.state = initialSnakeState(); room.state.map = room.state.map;
  room.lastActivity = now();
  broadcastSnakeState(room);
}
function updateSnake(room) {
  const s = room.state;
  if (s.status !== 'playing') return;
  // apply queued directions
  [1, 2].forEach(sym => { s.dirs[sym] = s.nextDirs[sym] || s.dirs[sym]; });

  [1, 2].forEach(sym => {
    if (s.dead[sym]) {
      if (now() >= s.respawnAt[sym]) respawnSnake(room, sym);
      return;
    }
    const snake = s.snakes[sym];
    if (!snake) return;
    const dir = s.dirs[sym];
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // wall / obstacle collision
    if (head.x < 0 || head.x >= SNAKE_GRID || head.y < 0 || head.y >= SNAKE_GRID || s.walls.some(w => w.x === head.x && w.y === head.y)) {
      killSnake(room, sym); return;
    }

    // self / other collision (exclude tail - it moves away this tick)
    if (snake.slice(0, -1).some(seg => seg.x === head.x && seg.y === head.y)) { killSnake(room, sym); return; }
    const other = sym === 1 ? 2 : 1;
    const otherSnake = s.snakes[other];
    if (otherSnake && otherSnake.some(seg => seg.x === head.x && seg.y === head.y)) { killSnake(room, sym); return; }

    snake.unshift(head);
    const food = s.foods[sym - 1];
    if (food && food.x === head.x && food.y === head.y) {
      s.scores[sym] += 10;
      s.foods[sym - 1] = spawnSnakeFood(room);
    } else {
      snake.pop();
    }
  });

  checkSnakeWinner(room);
  room.lastActivity = now();
  broadcastSnakeState(room);
}
function killSnake(room, sym) {
  const s = room.state;
  s.lives[sym]--;
  s.dead[sym] = true;
  s.snakes[sym] = null;
  if (s.lives[sym] <= 0) {
    const other = sym === 1 ? 2 : 1;
    s.winner = other;
    s.status = 'ended';
    s.message = `玩家 ${sym} 生命耗尽，玩家 ${other} 获胜！`;
    stopGameLoop(room);
  } else {
    s.respawnAt[sym] = now() + 1500;
    s.message = `玩家 ${sym} 撞墙，剩余生命 ${s.lives[sym]}`;
  }
}
function respawnSnake(room, sym) {
  const s = room.state;
  s.snakes[sym] = spawnSnake(sym, s.map);
  s.dirs[sym] = sym === 1 ? { x: 1, y: 0 } : { x: -1, y: 0 };
  s.nextDirs[sym] = { ...s.dirs[sym] };
  s.dead[sym] = false;
  s.respawnAt[sym] = 0;
  s.message = '';
}
function checkSnakeWinner(room) {
  const s = room.state;
  if (s.status !== 'playing') return;
  const alive = [1, 2].filter(sym => !s.dead[sym] || s.lives[sym] > 0);
  if (alive.length === 1) {
    s.winner = alive[0];
    s.status = 'ended';
    s.message = `玩家 ${alive[0]} 获胜！`;
    stopGameLoop(room);
  }
}

// ---------- Othello ----------
const OTHELLO_DIRS = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
function othelloValidMoves(board, player) {
  const moves = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (board[r][c] === 0) {
    for (const [dr, dc] of OTHELLO_DIRS) {
      let rr = r + dr, cc = c + dc, flipped = 0;
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr][cc] !== 0 && board[rr][cc] !== player) { rr += dr; cc += dc; flipped++; }
      if (flipped > 0 && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr][cc] === player) { moves.push({ r, c }); break; }
    }
  }
  return moves;
}
function othelloPlace(board, player, r, c) {
  board[r][c] = player;
  for (const [dr, dc] of OTHELLO_DIRS) {
    let rr = r + dr, cc = c + dc, flipped = [];
    while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr][cc] !== 0 && board[rr][cc] !== player) { flipped.push({ r: rr, c: cc }); rr += dr; cc += dc; }
    if (flipped.length > 0 && rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr][cc] === player) flipped.forEach(p => board[p.r][p.c] = player);
  }
}
function othelloCount(board) { let c1 = 0, c2 = 0; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { if (board[r][c] === 1) c1++; if (board[r][c] === 2) c2++; } return { 1: c1, 2: c2 }; }
function handleOthelloMove(room, socketId, { row, col }) {
  const player = getPlayer(room, socketId);
  if (!player || !player.connected || room.state.status !== 'playing' || room.state.gameOver || room.state.currentPlayer !== player.symbol || connectedPlayerCount(room) < 2) return;
  row = parseInt(row, 10); col = parseInt(col, 10);
  if (Number.isNaN(row) || row < 0 || row >= 8 || Number.isNaN(col) || col < 0 || col >= 8 || room.state.board[row][col] !== 0) return;
  const moves = othelloValidMoves(room.state.board, player.symbol);
  if (!moves.some(m => m.r === row && m.c === col)) return;
  othelloPlace(room.state.board, player.symbol, row, col);
  room.state.scores = othelloCount(room.state.board);
  room.state.lastMove = { row, col, symbol: player.symbol };
  const next = room.state.currentPlayer === 1 ? 2 : 1;
  if (othelloValidMoves(room.state.board, next).length > 0) room.state.currentPlayer = next;
  else if (othelloValidMoves(room.state.board, player.symbol).length === 0) {
    room.state.gameOver = true; room.state.status = 'ended';
    room.state.winner = room.state.scores[1] > room.state.scores[2] ? 1 : room.state.scores[2] > room.state.scores[1] ? 2 : null;
  }
  room.lastActivity = now(); broadcastState(room);
}
function resetOthello(room, socketId) {
  const p = getPlayer(room, socketId); if (!p || !p.isHost) return;
  const nextFirst = room.state.firstPlayer === 1 ? 2 : 1;
  room.state = initialOthelloState(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; room.state.status = connectedPlayerCount(room) === 2 ? 'playing' : 'waiting';
  room.lastActivity = now(); broadcastState(room);
}

// ---------- Bulls and Cows ----------
function bcValidDigits(digits) { return Array.isArray(digits) && digits.length === 4 && new Set(digits).size === 4 && digits.every(d => Number.isInteger(d) && d >= 0 && d <= 9); }
function bcResult(secret, guess) {
  let bulls = 0, cows = 0;
  for (let i = 0; i < 4; i++) if (guess[i] === secret[i]) bulls++;
  for (let i = 0; i < 4; i++) if (guess[i] !== secret[i] && secret.includes(guess[i])) cows++;
  return { bulls, cows };
}
function handleBullsandcowsMove(room, socketId, move) {
  const player = getPlayer(room, socketId);
  if (!player || !player.connected || connectedPlayerCount(room) < 2) return;
  const sym = player.symbol, phase = move.phase;
  if (phase === 'secret') {
    if (room.state.status !== 'setting') return;
    if (!bcValidDigits(move.digits)) return;
    room.state.secrets[sym] = move.digits.slice();
    room.lastActivity = now(); broadcastState(room);
    if (room.state.secrets[1] && room.state.secrets[2]) {
      room.state.status = 'playing'; room.state.currentPlayer = room.state.firstPlayer; room.lastActivity = now(); broadcastState(room);
    }
    return;
  }
  if (phase === 'guess') {
    if (room.state.status !== 'playing' || room.state.gameOver || room.state.currentPlayer !== sym) return;
    if (!bcValidDigits(move.digits)) return;
    const opp = sym === 1 ? 2 : 1;
    if (!room.state.secrets[opp]) return;
    const result = bcResult(room.state.secrets[opp], move.digits);
    room.state.guesses.push({ player: sym, digits: move.digits.slice(), ...result });
    if (result.bulls === 4) { room.state.gameOver = true; room.state.winner = sym; room.state.status = 'ended'; }
    else room.state.currentPlayer = opp;
    room.lastActivity = now(); broadcastState(room);
  }
}
function resetBullsandcows(room, socketId) {
  const p = getPlayer(room, socketId); if (!p || !p.isHost) return;
  const nextFirst = room.state.firstPlayer === 1 ? 2 : 1;
  room.state = initialBullsandcowsState(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; room.state.status = connectedPlayerCount(room) === 2 ? 'setting' : 'waiting';
  room.lastActivity = now(); broadcastState(room);
}

// ---------- Blackjack ----------
function createDeck() {
  const suits = ['♠','♥','♦','♣'], ranks = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
  const deck = [];
  for (const s of suits) for (const r of ranks) deck.push({ suit: s, rank: r, value: r === 'A' ? 11 : ['J','Q','K'].includes(r) ? 10 : parseInt(r, 10) });
  shuffle(deck); return deck;
}
function handValue(hand) { let total = 0, aces = 0; for (const c of hand) { total += c.value; if (c.rank === 'A') aces++; } while (total > 21 && aces > 0) { total -= 10; aces--; } return total; }
function startBlackjack(room) {
  if (connectedPlayerCount(room) < 2) return;
  room.state.deck = createDeck();
  room.state.dealerHand = [room.state.deck.pop(), room.state.deck.pop()];
  room.state.playerHands = { 1: [room.state.deck.pop(), room.state.deck.pop()], 2: [room.state.deck.pop(), room.state.deck.pop()] };
  room.state.currentPlayer = 1; room.state.gameOver = false; room.state.winner = null;
  room.state.results = { 1: null, 2: null }; room.state.message = ''; room.state.dealerHidden = true; room.state.status = 'playing';
  if (handValue(room.state.playerHands[1]) === 21) room.state.results[1] = 'blackjack';
  if (handValue(room.state.playerHands[2]) === 21) room.state.results[2] = 'blackjack';
}
function blackjackAdvanceTurn(room) {
  if (room.state.currentPlayer === 1) room.state.currentPlayer = 2;
  else finishBlackjack(room);
}
function finishBlackjack(room) {
  room.state.dealerHidden = false;
  let dealer = handValue(room.state.dealerHand);
  while (dealer < 17 && room.state.deck.length > 0) { room.state.dealerHand.push(room.state.deck.pop()); dealer = handValue(room.state.dealerHand); }
  for (const sym of [1, 2]) {
    const pval = handValue(room.state.playerHands[sym]);
    if (room.state.results[sym] === 'bust') room.state.results[sym] = 'lose';
    else if (room.state.results[sym] === 'blackjack') room.state.results[sym] = 'win';
    else if (dealer > 21) room.state.results[sym] = 'win';
    else if (pval > dealer) room.state.results[sym] = 'win';
    else if (pval < dealer) room.state.results[sym] = 'lose';
    else room.state.results[sym] = 'push';
  }
  const wins = [1, 2].filter(s => room.state.results[s] === 'win');
  room.state.winner = wins.length === 1 ? wins[0] : null;
  room.state.gameOver = true; room.state.status = 'ended';
}
function handleBlackjackMove(room, socketId, { action }) {
  const player = getPlayer(room, socketId);
  if (!player || !player.connected || room.state.status !== 'playing' || room.state.gameOver || room.state.currentPlayer !== player.symbol || connectedPlayerCount(room) < 2) return;
  const sym = player.symbol;
  if (action === 'hit') {
    room.state.playerHands[sym].push(room.state.deck.pop());
    const val = handValue(room.state.playerHands[sym]);
    if (val > 21) { room.state.results[sym] = 'bust'; blackjackAdvanceTurn(room); }
  } else if (action === 'stand') {
    blackjackAdvanceTurn(room);
  }
  room.lastActivity = now(); broadcastState(room);
}
function resetBlackjack(room, socketId) {
  const p = getPlayer(room, socketId); if (!p || !p.isHost) return;
  room.state = initialBlackjackState(); room.state.status = connectedPlayerCount(room) === 2 ? 'playing' : 'waiting';
  if (room.state.status === 'playing') startBlackjack(room);
  room.lastActivity = now(); broadcastState(room);
}

// ---------- Ultimate Tic-Tac-Toe ----------
function ultttWin(board, player) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  return lines.some(([a,b,c]) => board[Math.floor(a/3)][a%3] === player && board[Math.floor(b/3)][b%3] === player && board[Math.floor(c/3)][c%3] === player);
}
function ultttSmallBoardWon(state, br, bc, player) {
  const b = [[0,0,0],[0,0,0],[0,0,0]];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) b[r][c] = state.board[br*3+r][bc*3+c];
  return ultttWin(b, player);
}
function ultttSmallBoardFull(state, br, bc) {
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) if (state.board[br*3+r][bc*3+c] === 0) return false;
  return true;
}
function handleUltttMove(room, socketId, { row, col }) {
  const player = getPlayer(room, socketId);
  if (!player || !player.connected || room.state.status !== 'playing' || room.state.gameOver || room.state.currentPlayer !== player.symbol || connectedPlayerCount(room) < 2) return;
  row = parseInt(row, 10); col = parseInt(col, 10);
  if (Number.isNaN(row) || row < 0 || row >= 9 || Number.isNaN(col) || col < 0 || col >= 9 || room.state.board[row][col] !== 0) return;
  const br = Math.floor(row/3), bc = Math.floor(col/3);
  if (room.state.activeBoard && (room.state.activeBoard[0] !== br || room.state.activeBoard[1] !== bc)) return;
  if (room.state.metaBoard[br][bc] !== 0) return;
  room.state.board[row][col] = player.symbol;
  room.state.lastMove = { row, col, symbol: player.symbol };
  if (ultttSmallBoardWon(room.state, br, bc, player.symbol)) room.state.metaBoard[br][bc] = player.symbol;
  else if (ultttSmallBoardFull(room.state, br, bc)) room.state.metaBoard[br][bc] = 3;
  const nextBr = row % 3, nextBc = col % 3;
  room.state.activeBoard = room.state.metaBoard[nextBr][nextBc] === 0 ? [nextBr, nextBc] : null;
  if (ultttWin(room.state.metaBoard, player.symbol)) { room.state.gameOver = true; room.state.winner = player.symbol; room.state.status = 'ended'; }
  else if (room.state.metaBoard.flat().every(v => v !== 0)) { room.state.gameOver = true; room.state.winner = null; room.state.status = 'ended'; }
  else room.state.currentPlayer = room.state.currentPlayer === 1 ? 2 : 1;
  room.lastActivity = now(); broadcastState(room);
}
function resetUlttt(room, socketId) {
  const p = getPlayer(room, socketId); if (!p || !p.isHost) return;
  const nextFirst = room.state.firstPlayer === 1 ? 2 : 1;
  room.state = initialUltttState(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; room.state.status = connectedPlayerCount(room) === 2 ? 'playing' : 'waiting';
  room.lastActivity = now(); broadcastState(room);
}

// ---------- Mini Chess ----------
function mcPieceColor(p) { if (!p) return 0; return p === p.toUpperCase() ? 1 : 2; }
function mcFindKing(board, player) {
  const target = player === 1 ? 'K' : 'k';
  for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) if (board[r][c] === target) return { r, c };
  return null;
}
function mcInBounds(r, c) { return r >= 0 && r < 6 && c >= 0 && c < 5; }
function mcCanAttack(board, fr, fc, tr, tc) {
  const p = board[fr][fc]; if (!p) return false;
  const player = mcPieceColor(p), target = board[tr][tc];
  if (target && mcPieceColor(target) === player) return false;
  const dr = tr - fr, dc = tc - fc;
  const piece = p.toLowerCase();
  if (piece === 'p') { const dir = player === 1 ? -1 : 1; return dr === dir && Math.abs(dc) === 1; }
  if (piece === 'n') return (Math.abs(dr) === 2 && Math.abs(dc) === 1) || (Math.abs(dr) === 1 && Math.abs(dc) === 2);
  if (piece === 'k') return Math.abs(dr) <= 1 && Math.abs(dc) <= 1 && (dr !== 0 || dc !== 0);
  let stepR = 0, stepC = 0, max = 1;
  if (piece === 'r') { if (dr === 0) stepC = Math.sign(dc); else if (dc === 0) stepR = Math.sign(dr); else return false; max = 5; }
  else if (piece === 'b') { if (Math.abs(dr) !== Math.abs(dc)) return false; stepR = Math.sign(dr); stepC = Math.sign(dc); max = 5; }
  else if (piece === 'q') {
    if (dr === 0 && dc !== 0) stepC = Math.sign(dc);
    else if (dc === 0 && dr !== 0) stepR = Math.sign(dr);
    else if (Math.abs(dr) === Math.abs(dc)) { stepR = Math.sign(dr); stepC = Math.sign(dc); }
    else return false;
    max = 5;
  }
  if (stepR === 0 && stepC === 0) return false;
  for (let i = 1; i <= max; i++) {
    const r = fr + stepR * i, c = fc + stepC * i;
    if (r === tr && c === tc) return true;
    if (!mcInBounds(r, c) || board[r][c]) return false;
  }
  return false;
}
function mcCanMove(board, fr, fc, tr, tc) {
  const p = board[fr][fc]; if (!p) return false;
  const player = mcPieceColor(p), target = board[tr][tc];
  if (target && mcPieceColor(target) === player) return false;
  const dr = tr - fr, dc = tc - fc;
  const piece = p.toLowerCase();
  if (piece === 'p') {
    const dir = player === 1 ? -1 : 1;
    if (dc === 0 && dr === dir && !target) return true;
    if (dc === 0 && dr === 2 * dir && !target) {
      const startRow = player === 1 ? 4 : 1;
      if (fr !== startRow) return false;
      return !board[fr + dir][fc];
    }
    if (Math.abs(dc) === 1 && dr === dir && target) return true;
    return false;
  }
  return mcCanAttack(board, fr, fc, tr, tc);
}
function mcLegalMove(board, player, fr, fc, tr, tc) {
  const p = board[fr][fc];
  if (!p || mcPieceColor(p) !== player) return false;
  if (!mcCanMove(board, fr, fc, tr, tc)) return false;
  const nb = board.map(row => row.slice());
  nb[tr][tc] = nb[fr][fc]; nb[fr][fc] = '';
  if (p.toLowerCase() === 'p' && (tr === 0 || tr === 5)) nb[tr][tc] = player === 1 ? 'Q' : 'q';
  const king = mcFindKing(nb, player);
  if (!king) return false;
  return !mcAttacked(nb, player, king);
}
function mcAttacked(board, player, kingPos) {
  const opp = player === 1 ? 2 : 1;
  for (let r = 0; r < 6; r++) for (let c = 0; c < 5; c++) {
    const p = board[r][c];
    if (mcPieceColor(p) !== opp) continue;
    if (mcCanAttack(board, r, c, kingPos.r, kingPos.c)) return true;
  }
  return false;
}
function mcAnyLegalMove(board, player) {
  for (let fr = 0; fr < 6; fr++) for (let fc = 0; fc < 5; fc++) {
    if (mcPieceColor(board[fr][fc]) !== player) continue;
    for (let tr = 0; tr < 6; tr++) for (let tc = 0; tc < 5; tc++) {
      if (fr === tr && fc === tc) continue;
      if (mcLegalMove(board, player, fr, fc, tr, tc)) return true;
    }
  }
  return false;
}
function handleMinichessMove(room, socketId, { from, to, promotion }) {
  const player = getPlayer(room, socketId);
  if (!player || !player.connected || room.state.status !== 'playing' || room.state.gameOver || room.state.currentPlayer !== player.symbol || connectedPlayerCount(room) < 2) return;
  const fr = parseInt(from && from.r, 10), fc = parseInt(from && from.c, 10);
  const tr = parseInt(to && to.r, 10), tc = parseInt(to && to.c, 10);
  if (Number.isNaN(fr) || Number.isNaN(fc) || Number.isNaN(tr) || Number.isNaN(tc)) return;
  if (!mcLegalMove(room.state.board, player.symbol, fr, fc, tr, tc)) return;
  const p = room.state.board[fr][fc];
  const captured = room.state.board[tr][tc];
  room.state.board[tr][tc] = p; room.state.board[fr][fc] = '';
  if (p.toLowerCase() === 'p' && (tr === 0 || tr === 5)) {
    const promo = String(promotion || '').toLowerCase();
    const choices = { q: player.symbol === 1 ? 'Q' : 'q', r: player.symbol === 1 ? 'R' : 'r', b: player.symbol === 1 ? 'B' : 'b', n: player.symbol === 1 ? 'N' : 'n' };
    room.state.board[tr][tc] = choices[promo] || (player.symbol === 1 ? 'Q' : 'q');
  }
  if (captured) room.state.captured[player.symbol].push(captured);
  room.state.lastMove = { from: { r: fr, c: fc }, to: { r: tr, c: tc }, symbol: player.symbol, captured };
  const next = player.symbol === 1 ? 2 : 1;
  const king = mcFindKing(room.state.board, next);
  const inCheck = king ? mcAttacked(room.state.board, next, king) : false;
  room.state.check[next] = inCheck; room.state.check[player.symbol] = false;
  if (inCheck && !mcAnyLegalMove(room.state.board, next)) { room.state.gameOver = true; room.state.winner = player.symbol; room.state.status = 'ended'; }
  else if (!inCheck && !mcAnyLegalMove(room.state.board, next)) { room.state.gameOver = true; room.state.winner = null; room.state.status = 'ended'; }
  else room.state.currentPlayer = next;
  room.lastActivity = now(); broadcastState(room);
}
function resetMinichess(room, socketId) {
  const p = getPlayer(room, socketId); if (!p || !p.isHost) return;
  const nextFirst = room.state.firstPlayer === 1 ? 2 : 1;
  room.state = initialMinichessState(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; room.state.status = connectedPlayerCount(room) === 2 ? 'playing' : 'waiting';
  room.lastActivity = now(); broadcastState(room);
}

// ---------- Loops ----------
function startGameLoop(room, fn, intervalMs = PONG.tickMs) {
  stopGameLoop(room);
  room.loop = setInterval(() => {
    if (!rooms.has(room.id)) { stopGameLoop(room); return; }
    try { fn(); } catch (e) { console.error('loop error', e); }
  }, intervalMs);
}
function stopGameLoop(room) { if (room.loop) { clearInterval(room.loop); room.loop = null; } }

// ---------- Rematch / Reset Helpers ----------
function canRematch(status) {
  return status === 'ended' || status === 'finished' || status === 'result';
}

function resetRoomState(room) {
  const nextFirst = room.state.firstPlayer === 1 ? 2 : 1;
  room.rematchVotes = { 1: false, 2: false };
  room.lastActivity = now();
  switch (room.gameType) {
    case 'gomoku':
      room.state = initialGomokuState(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; break;
    case 'pong':
      stopGameLoop(room); room.state = initialPongState(); startPongIfReady(room); break;
    case 'tictactoe':
      room.state = initialTictactoeState(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; break;
    case 'connect4':
      room.state = initialConnect4State(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; break;
    case 'rps':
      room.state = initialRpsState(); room.state.status = connectedPlayerCount(room) === 2 ? 'choosing' : 'waiting'; break;
    case 'memory':
      room.state = initialMemoryState(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; room.state.status = connectedPlayerCount(room) === 2 ? 'playing' : 'waiting'; break;
    case 'dots':
      room.state = initialDotsState(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; room.state.status = connectedPlayerCount(room) === 2 ? 'playing' : 'waiting'; break;
    case 'snake':
      stopGameLoop(room); room.state = initialSnakeState(); break;
    case 'racing':
      stopGameLoop(room); room.state = initialRacingState(); break;
    case 'drawguess':
      room.state = initialDrawguessState(); break;
    case 'draw2guess':
      room.state = initialDraw2GuessState(); break;
    case 'othello':
      room.state = initialOthelloState(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; room.state.status = connectedPlayerCount(room) === 2 ? 'playing' : 'waiting'; break;
    case 'bullsandcows':
      room.state = initialBullsandcowsState(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; room.state.status = connectedPlayerCount(room) === 2 ? 'setting' : 'waiting'; break;
    case 'blackjack':
      room.state = initialBlackjackState(); room.state.status = connectedPlayerCount(room) === 2 ? 'playing' : 'waiting'; if (room.state.status === 'playing') startBlackjack(room); break;
    case 'ulttt':
      room.state = initialUltttState(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; room.state.status = connectedPlayerCount(room) === 2 ? 'playing' : 'waiting'; break;
    case 'minichess':
      room.state = initialMinichessState(); room.state.firstPlayer = nextFirst; room.state.currentPlayer = nextFirst; room.state.status = connectedPlayerCount(room) === 2 ? 'playing' : 'waiting'; break;
  }
}

async function startAfterRematch(room) {
  try {
    if (room.gameType === 'drawguess') {
      await startDrawguessRound(room);
    } else if (room.gameType === 'draw2guess') {
      await startDraw2GuessRound(room);
    }
  } catch (e) {
    console.error('startAfterRematch error:', e.message);
  }
}

function handleRematch(room, socketId) {
  try {
    const player = getPlayer(room, socketId);
    if (!player || !player.connected || !canRematch(room.state.status)) return;
    room.rematchVotes[player.symbol] = true;
    broadcastState(room);
    if (room.rematchVotes[1] && room.rematchVotes[2]) {
      resetRoomState(room);
      startAfterRematch(room).then(() => {
        broadcastState(room);
      }).catch(e => {
        console.error('rematch start error', e);
        broadcastState(room);
      });
    }
  } catch (e) {
    console.error('handleRematch error:', e.message);
  }
}

function clearVotesOnMove(room) {
  if (room.rematchVotes[1] || room.rematchVotes[2]) {
    room.rematchVotes = { 1: false, 2: false };
  }
}

// ---------- Socket Events ----------
function attachGameListeners(socket) {
  socket.on('createRoom', ({ gameType, playerName, isPublic, clientId }) => {
    try {
      if (!ALL_GAMES.includes(gameType)) return;
      const room = createRoom(gameType, playerName, socket.id, isPublic, clientId);
      socket.join(room.id);
      socket.roomId = room.id;
      socket.playerSymbol = 1;
      socket.emit('roomCreated', { roomId: room.id, gameType, isPublic: room.isPublic, player: { ...room.players[0], socketId: socket.id }, link: getShareLink(room) });
      socket.emit('chat:history', room.messages.slice(-50));
      broadcastState(room);
    } catch (e) { console.error('createRoom error:', e.message); }
  });

  socket.on('quickMatch:join', ({ gameType, playerName, clientId }) => {
    try { findQuickMatch(gameType, socket, playerName, clientId); }
    catch (e) { console.error('quickMatch:join error:', e.message); }
  });
  socket.on('quickMatch:leave', () => {
    try { removeFromQuickMatch(socket); }
    catch (e) { console.error('quickMatch:leave error:', e.message); }
  });

  socket.on('joinRoom', ({ roomId, playerName, clientId }) => {
    try {
      const room = rooms.get(roomId && roomId.toUpperCase());
      if (!room) { socket.emit('error', { message: 'Room not found' }); return; }
      if (room.players.find(p => p.socketId === socket.id)) return;
      if (room.players.length >= 2 && !room.players.find(p => clientId && p.clientId === clientId)) {
        const spec = joinRoomAsSpectator(room, socket.id, playerName);
        socket.join(room.id); socket.roomId = room.id; socket.isSpectator = true;
        socket.emit('joinedAsSpectator', publicRoomState(room));
      } else {
        const player = joinRoomAsPlayer(room, socket.id, playerName, clientId);
        if (!player) { socket.emit('error', { message: 'Room is full' }); return; }
        socket.join(room.id); socket.roomId = room.id; socket.playerSymbol = player.symbol;
        socket.emit('joinedRoom', { ...publicRoomState(room), you: { socketId: player.socketId, name: player.name, symbol: player.symbol, isHost: player.isHost } });
        socket.emit('chat:history', room.messages.slice(-50));
        if (connectedPlayerCount(room) === 2 && room.state.status === 'waiting') {
          if (room.gameType === 'pong') startPongIfReady(room);
          else if (['gomoku','tictactoe','connect4','rps','memory','dots','othello','bullsandcows','blackjack','ulttt','minichess'].includes(room.gameType)) startGameIfReady(room);
        }
        broadcastState(room);
      }
    } catch (e) { console.error('joinRoom error:', e.message); }
  });
  socket.on('chat:history', () => {
    try {
      const room = rooms.get(socket.roomId);
      if (room) socket.emit('chat:history', room.messages.slice(-50));
    } catch (e) { console.error('chat:history error:', e.message); }
  });

  socket.on('createUniversalRoom', ({ playerName, isPublic, clientId }) => {
    try {
      const room = createRoom('lobby', playerName, socket.id, isPublic, clientId);
      socket.join(room.id);
      socket.roomId = room.id;
      socket.playerSymbol = 1;
      socket.emit('roomCreated', { roomId: room.id, gameType: 'lobby', isPublic: room.isPublic, player: { ...room.players[0], socketId: socket.id }, link: getShareLink(room) });
      socket.emit('chat:history', room.messages.slice(-50));
      io.to(room.id).emit('lobby:state', publicRoomState(room));
    } catch (e) { console.error('createUniversalRoom error:', e.message); }
  });

  socket.on('lobby:chooseGame', ({ gameType }) => {
    try {
      const room = rooms.get(socket.roomId);
      if (!room || room.gameType !== 'lobby') return;
      const player = getPlayer(room, socket.id);
      if (!player || !player.isHost) { socket.emit('error', { message: '只有房主可以选择游戏' }); return; }
      if (!ALL_GAMES.includes(gameType)) return;
      room.gameType = gameType;
      room.state = gameType === 'gomoku' ? initialGomokuState()
               : gameType === 'pong' ? initialPongState()
               : gameType === 'drawguess' ? initialDrawguessState()
               : gameType === 'tictactoe' ? initialTictactoeState()
               : gameType === 'connect4' ? initialConnect4State()
               : gameType === 'draw2guess' ? initialDraw2GuessState()
               : gameType === 'rps' ? initialRpsState()
               : gameType === 'memory' ? initialMemoryState()
               : gameType === 'dots' ? initialDotsState()
               : gameType === 'snake' ? initialSnakeState()
               : gameType === 'shooter' ? initialShooterState()
               : gameType === 'racing' ? initialRacingState()
               : gameType === 'othello' ? initialOthelloState()
               : gameType === 'bullsandcows' ? initialBullsandcowsState()
               : gameType === 'blackjack' ? initialBlackjackState()
               : gameType === 'ulttt' ? initialUltttState()
               : gameType === 'minichess' ? initialMinichessState()
               : initialGomokuState();
      room.lastActivity = now();
      io.to(room.id).emit('lobby:gameChosen', { roomId: room.id, gameType, link: getShareLink(room) });
    } catch (e) { console.error('lobby:chooseGame error:', e.message); }
  });

  socket.on('rematch', () => {
    try {
      const room = rooms.get(socket.roomId);
      if (!room) return;
      handleRematch(room, socket.id);
    } catch (e) { console.error('rematch error:', e.message); }
  });

  socket.on('leaveRoom', () => {
    try {
      const room = rooms.get(socket.roomId);
      if (!room) return;
      socket.leave(room.id);
      const removed = removeFromRoom(room, socket.id);
      socket.roomId = null;
      socket.playerSymbol = null;
      socket.isSpectator = null;
      if (!removed && connectedPlayerCount(room) < 2) {
        resetRoomStateAfterPlayerLeave(room);
        broadcastState(room);
      }
    } catch (e) { console.error('leaveRoom error:', e.message); }
  });

  socket.on('reconnect', ({ clientId }) => {
    try {
      if (!clientId) return;
      for (const room of rooms.values()) {
        const player = room.players.find(p => p.clientId === clientId);
        if (player) {
          if (socket.roomId && socket.roomId !== room.id) socket.leave(socket.roomId);
          socket.join(room.id);
          socket.roomId = room.id;
          socket.playerSymbol = player.symbol;
          clearDisconnectTimer(player);
          player.socketId = socket.id;
          player.connected = true;
          if (connectedPlayerCount(room) === 2 && room.state.status === 'waiting') {
            if (room.gameType === 'pong') startPongIfReady(room);
            else if (['gomoku','tictactoe','connect4','rps','memory','dots','othello','bullsandcows','blackjack','ulttt','minichess'].includes(room.gameType)) startGameIfReady(room);
          }
          socket.emit('reconnected', { ...publicRoomState(room), player: { socketId: player.socketId, clientId: player.clientId, name: player.name, symbol: player.symbol, isHost: player.isHost } });
          if (room.gameType === 'lobby') io.to(room.id).emit('lobby:state', publicRoomState(room));
          else broadcastState(room);
          return;
        }
      }
      socket.emit('reconnect:failed');
    } catch (e) { console.error('reconnect error:', e.message); }
  });

  socket.on('gomoku:move', data => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='gomoku') { clearVotesOnMove(r); handleGomokuMove(r,socket.id,data); } }
    catch (e) { console.error('gomoku:move error:', e.message); }
  });
  socket.on('gomoku:reset', () => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='gomoku') resetGomoku(r,socket.id); }
    catch (e) { console.error('gomoku:reset error:', e.message); }
  });

  socket.on('pong:paddle', data => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='pong') handlePongPaddle(r,socket.id,data); }
    catch (e) { console.error('pong:paddle error:', e.message); }
  });
  socket.on('pong:serve', () => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='pong') handlePongServe(r,socket.id); }
    catch (e) { console.error('pong:serve error:', e.message); }
  });
  socket.on('pong:reset', () => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='pong') resetPong(r,socket.id); }
    catch (e) { console.error('pong:reset error:', e.message); }
  });

  socket.on('tictactoe:move', data => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='tictactoe') handleTictactoeMove(r,socket.id,data); }
    catch (e) { console.error('tictactoe:move error:', e.message); }
  });
  socket.on('tictactoe:reset', () => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='tictactoe') resetTictactoe(r,socket.id); }
    catch (e) { console.error('tictactoe:reset error:', e.message); }
  });

  socket.on('connect4:drop', data => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='connect4') connect4Drop(r,socket.id,data); }
    catch (e) { console.error('connect4:drop error:', e.message); }
  });
  socket.on('connect4:reset', () => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='connect4') resetConnect4(r,socket.id); }
    catch (e) { console.error('connect4:reset error:', e.message); }
  });

  socket.on('drawguess:start', async () => {
    try {
      const r = rooms.get(socket.roomId);
      if (!r || r.gameType !== 'drawguess') return;
      const p = getPlayer(r, socket.id);
      if (!p || !p.isHost) return;
      await startDrawguessRound(r);
    } catch (e) { console.error('drawguess:start error:', e.message); }
  });
  socket.on('drawguess:guess', data => {
    try {
      const r = rooms.get(socket.roomId);
      if (r && r.gameType === 'drawguess') handleDrawguessGuess(r, socket.id, data);
    } catch (e) { console.error('drawguess:guess error:', e.message); }
  });
  socket.on('drawguess:next', async () => {
    try {
      const r = rooms.get(socket.roomId);
      if (r && r.gameType === 'drawguess') await nextDrawguessRound(r, socket.id);
    } catch (e) { console.error('drawguess:next error:', e.message); }
  });
  socket.on('drawguess:reset', () => {
    try {
      const r = rooms.get(socket.roomId);
      if (r && r.gameType === 'drawguess') resetDrawguess(r, socket.id);
    } catch (e) { console.error('drawguess:reset error:', e.message); }
  });
  socket.on('drawguess:hint', async () => {
    try {
      const r = rooms.get(socket.roomId);
      if (!r || r.gameType !== 'drawguess') return;
      if (r.state.status !== 'playing') return;
      const p = getPlayer(r, socket.id);
      if (!p || p.symbol === null) return;
      const wordObj = WORD_POOL.find(w => w.word && w.word.toLowerCase() === r.state.secretWord.toLowerCase());
      const hint = await generateDrawguessHint(wordObj);
      socket.emit('drawguess:hint', { hint });
    } catch (e) { console.error('drawguess:hint error:', e.message); }
  });

  socket.on('draw2guess:start', async () => {
    try {
      const r = rooms.get(socket.roomId);
      if (!r || r.gameType !== 'draw2guess') return;
      const p = getPlayer(r, socket.id);
      if (!p || !p.isHost) return;
      if (connectedPlayerCount(r) < 2) { socket.emit('error', { message: '需要两名玩家才能开始' }); return; }
      await startDraw2GuessRound(r);
    } catch (e) { console.error('draw2guess:start error:', e.message); }
  });
  socket.on('draw2guess:stroke', data => {
    try {
      const r = rooms.get(socket.roomId);
      if (r && r.gameType === 'draw2guess') handleDraw2GuessStroke(r, socket.id, data);
    } catch (e) { console.error('draw2guess:stroke error:', e.message); }
  });
  socket.on('draw2guess:guess', async data => {
    try {
      const r = rooms.get(socket.roomId);
      if (r && r.gameType === 'draw2guess') await handleDraw2GuessGuess(r, socket.id, data);
    } catch (e) { console.error('draw2guess:guess error:', e.message); }
  });
  socket.on('draw2guess:next', async () => {
    try {
      const r = rooms.get(socket.roomId);
      if (r && r.gameType === 'draw2guess') await nextDraw2GuessRound(r, socket.id);
    } catch (e) { console.error('draw2guess:next error:', e.message); }
  });
  socket.on('draw2guess:reset', () => {
    try {
      const r = rooms.get(socket.roomId);
      if (r && r.gameType === 'draw2guess') resetDraw2Guess(r, socket.id);
    } catch (e) { console.error('draw2guess:reset error:', e.message); }
  });

  socket.on('rps:choice', data => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='rps') handleRpsChoice(r,socket.id,data); }
    catch (e) { console.error('rps:choice error:', e.message); }
  });

  socket.on('memory:flip', data => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='memory') handleMemoryFlip(r,socket.id,data); }
    catch (e) { console.error('memory:flip error:', e.message); }
  });
  socket.on('memory:reset', () => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='memory') resetMemory(r,socket.id); }
    catch (e) { console.error('memory:reset error:', e.message); }
  });

  socket.on('dots:line', data => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='dots') handleDotsLine(r,socket.id,data); }
    catch (e) { console.error('dots:line error:', e.message); }
  });
  socket.on('dots:reset', () => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='dots') resetDots(r,socket.id); }
    catch (e) { console.error('dots:reset error:', e.message); }
  });

  socket.on('snake:dir', data => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='snake') handleSnakeDir(r,socket.id,data); }
    catch (e) { console.error('snake:dir error:', e.message); }
  });
  socket.on('snake:ready', () => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='snake') handleSnakeReady(r,socket.id); }
    catch (e) { console.error('snake:ready error:', e.message); }
  });
  socket.on('snake:map', data => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='snake') handleSnakeMap(r,socket.id,data); }
    catch (e) { console.error('snake:map error:', e.message); }
  });
  socket.on('snake:start', () => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='snake') startSnake(r); }
    catch (e) { console.error('snake:start error:', e.message); }
  });
  socket.on('snake:reset', () => {
    try { const r=rooms.get(socket.roomId); if(r&&r.gameType==='snake') resetSnake(r,socket.id); }
    catch (e) { console.error('snake:reset error:', e.message); }
  });

  // ---------- Shooter co-op relay ----------
  socket.on('shooter:start', data => {
    try { const r=rooms.get(socket.roomId); if(!r||r.gameType!=='shooter') return; socket.to(r.id).emit('shooter:start', data); }
    catch (e) { console.error('shooter:start error:', e.message); }
  });
  socket.on('shooter:restartWave', data => {
    try { const r=rooms.get(socket.roomId); if(!r||r.gameType!=='shooter') return; socket.to(r.id).emit('shooter:restartWave', data); }
    catch (e) { console.error('shooter:restartWave error:', e.message); }
  });
  socket.on('shooter:end', data => {
    try { const r=rooms.get(socket.roomId); if(!r||r.gameType!=='shooter') return; socket.to(r.id).emit('shooter:end', data); }
    catch (e) { console.error('shooter:end error:', e.message); }
  });
  socket.on('shooter:plane', data => {
    try { const r=rooms.get(socket.roomId); if(!r||r.gameType!=='shooter') return; const p=getPlayer(r,socket.id); socket.to(r.id).emit('shooter:plane', {...data, fromSymbol:p?p.symbol:1}); }
    catch (e) { console.error('shooter:plane error:', e.message); }
  });
  socket.on('shooter:input', data => {
    try { const r=rooms.get(socket.roomId); if(!r||r.gameType!=='shooter') return; const p=getPlayer(r,socket.id); socket.to(r.id).emit('shooter:input', {...data, fromSymbol:p?p.symbol:1}); }
    catch (e) { console.error('shooter:input error:', e.message); }
  });
  socket.on('shooter:sync', data => {
    try { const r=rooms.get(socket.roomId); if(!r||r.gameType!=='shooter') return; socket.to(r.id).emit('shooter:sync', data); }
    catch (e) { console.error('shooter:sync error:', e.message); }
  });

  // ---------- Racing (co-op / versus) ----------
  function racingRectsOverlap(a, b) {
    return Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.h + b.h) / 2;
  }
  function spawnRacingEnemy(s) {
    const lane = Math.floor(Math.random() * s.LANE_COUNT);
    if (s.enemies.some(e => e.lane === lane && e.y < 80)) return;
    const colors = ['#ff4d6a', '#ff9f43', '#ffd93d', '#6bcb77', '#9b59b6', '#e84393'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const w = s.CAR_W * (0.85 + Math.random() * 0.3);
    const h = s.CAR_H * (0.85 + Math.random() * 0.3);
    const vy = s.speed * (0.4 + Math.random() * 0.4);
    s.enemies.push({
      x: racingLaneCenter(lane, s.W, s.LANE_COUNT),
      y: -h,
      w, h, lane, color, vy
    });
  }
  function spawnRacingItem(s) {
    const lane = Math.floor(Math.random() * s.LANE_COUNT);
    const types = ['speed', 'shield', 'slow'];
    const type = types[Math.floor(Math.random() * types.length)];
    s.items.push({
      x: racingLaneCenter(lane, s.W, s.LANE_COUNT),
      y: -40,
      w: 28, h: 28, lane, type,
      vy: s.speed * 0.25
    });
  }
  function applyRacingEffect(s, sym, type) {
    const ef = s.effects[sym];
    if (type === 'speed') ef.speed = 300;
    else if (type === 'shield') ef.shield = 1;
    else if (type === 'slow') ef.slow = 360;
  }
  function spawnRacingParticles(s, x, y, color, count) {
    for (let i = 0; i < count; i++) {
      s.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6,
        life: 30 + Math.random() * 20,
        color,
        r: 2 + Math.random() * 3
      });
    }
  }
  function damageRacingPlayer(room, sym) {
    const s = room.state;
    s.lives[sym] = Math.max(0, s.lives[sym] - 1);
    s.collisionCooldown[sym] = 60;
    if (s.lives[sym] <= 0) {
      s.dead[sym] = true;
      s.cars[sym].y = s.H + 200;
    }
  }
  function checkRacingGameOver(room) {
    const s = room.state;
    if (s.dead[1] && s.dead[2]) {
      s.gameOver = true;
      s.status = 'ended';
      s.winner = null;
      stopGameLoop(room);
    }
  }
  function updateRacing(room) {
    const s = room.state;
    if (s.status !== 'playing' || s.gameOver) return;
    s.frameCount++;
    s.score = Math.floor(s.frameCount / 6);
    s.speed = 5 + s.score * 0.008;
    if (s.speed > 14) s.speed = 14;

    [1, 2].forEach(sym => {
      const ef = s.effects[sym];
      if (ef.speed > 0) ef.speed--;
      if (ef.slow > 0) ef.slow--;
      if (s.collisionCooldown[sym] > 0) s.collisionCooldown[sym]--;
    });

    let effectiveSpeed = s.speed;
    const anySpeed = s.effects[1].speed > 0 || s.effects[2].speed > 0;
    const anySlow = s.effects[1].slow > 0 || s.effects[2].slow > 0;
    if (anySpeed) effectiveSpeed += 3.5;
    if (anySlow) effectiveSpeed *= 0.7;
    if (effectiveSpeed > 18) effectiveSpeed = 18;

    [1, 2].forEach(sym => {
      if (s.dead[sym]) return;
      const car = s.cars[sym];
      const ef = s.effects[sym];
      const dir = s.inputs[sym] || 0;
      car.tilt = dir * 2;
      let moveSpeed = 6.5;
      if (ef.speed > 0) moveSpeed = 8.5;
      const targetVx = dir * moveSpeed;
      car.vx += (targetVx - car.vx) * 0.35;
      if (Math.abs(car.vx) < 0.05) car.vx = 0;
      car.x += car.vx;
      car.x = Math.max(car.w / 2 + 4, Math.min(s.W - car.w / 2 - 4, car.x));
    });

    s.roadOffset = (s.roadOffset + effectiveSpeed) % 50;

    s.spawnTimer++;
    const spawnRate = Math.max(18, 50 - s.score * 0.08);
    if (s.spawnTimer >= spawnRate) {
      spawnRacingEnemy(s);
      s.spawnTimer = 0;
    }

    s.itemSpawnTimer++;
    if (s.itemSpawnTimer >= 480 + Math.random() * 120) {
      spawnRacingItem(s);
      s.itemSpawnTimer = 0;
    }

    const enemySpeedMul = (s.effects[1].slow > 0 || s.effects[2].slow > 0) ? 0.45 : 1;

    for (let i = s.enemies.length - 1; i >= 0; i--) {
      const e = s.enemies[i];
      e.y += effectiveSpeed + e.vy * enemySpeedMul;
      if (e.y > s.H + 60) {
        s.enemies.splice(i, 1);
        continue;
      }
      let hit = false;
      [1, 2].forEach(sym => {
        if (hit || s.dead[sym] || s.collisionCooldown[sym] > 0) return;
        const car = s.cars[sym];
        if (racingRectsOverlap(car, e)) {
          if (s.effects[sym].shield > 0) {
            s.effects[sym].shield = 0;
            spawnRacingParticles(s, e.x, e.y, '#4fc3f7', 15);
            s.enemies.splice(i, 1);
            hit = true;
            return;
          }
          spawnRacingParticles(s, e.x, e.y, '#ff4444', 12);
          s.enemies.splice(i, 1);
          damageRacingPlayer(room, sym);
          hit = true;
        }
      });
    }

    for (let i = s.items.length - 1; i >= 0; i--) {
      const it = s.items[i];
      it.y += effectiveSpeed * 0.35;
      if (it.y > s.H + 50) {
        s.items.splice(i, 1);
        continue;
      }
      let picked = false;
      [1, 2].forEach(sym => {
        if (picked || s.dead[sym]) return;
        const car = s.cars[sym];
        if (racingRectsOverlap(car, it)) {
          applyRacingEffect(s, sym, it.type);
          const pColor = it.type === 'speed' ? '#ffeb3b' : it.type === 'shield' ? '#4fc3f7' : '#81c784';
          spawnRacingParticles(s, it.x, it.y, pColor, 10);
          s.items.splice(i, 1);
          picked = true;
        }
      });
    }

    if (!s.dead[1] && !s.dead[2] && s.collisionCooldown[1] <= 0 && s.collisionCooldown[2] <= 0) {
      if (racingRectsOverlap(s.cars[1], s.cars[2])) {
        spawnRacingParticles(s, (s.cars[1].x + s.cars[2].x) / 2, (s.cars[1].y + s.cars[2].y) / 2, '#ff4444', 12);
        damageRacingPlayer(room, 1);
        damageRacingPlayer(room, 2);
        s.collisionCooldown[1] = 60;
        s.collisionCooldown[2] = 60;
      }
    }

    for (let i = s.particles.length - 1; i >= 0; i--) {
      const p = s.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
      if (p.life <= 0) s.particles.splice(i, 1);
    }

    checkRacingGameOver(room);
    room.lastActivity = now();
    emitRoom(room, 'racing:state', publicRoomState(room));
  }
  function handleRacingInput(room, socketId, { dir }) {
    const player = getPlayer(room, socketId);
    if (!player || room.state.status !== 'playing') return;
    let d = parseInt(dir, 10) || 0;
    d = Math.max(-1, Math.min(1, d));
    room.state.inputs[player.symbol] = d;
    room.lastActivity = now();
  }
  function startRacing(room, socketId) {
    const player = getPlayer(room, socketId);
    if (!player || !player.isHost || connectedPlayerCount(room) < 2) return;
    stopGameLoop(room);
    room.state = initialRacingState();
    room.state.status = 'playing';
    room.lastActivity = now();
    startGameLoop(room, () => updateRacing(room), 33);
    broadcastState(room);
  }
  function resetRacing(room, socketId) {
    const player = getPlayer(room, socketId);
    if (!player || !player.isHost) return;
    stopGameLoop(room);
    room.state = initialRacingState();
    room.lastActivity = now();
    broadcastState(room);
  }

  socket.on('racing:input', data => {
    try { const r = rooms.get(socket.roomId); if (r && r.gameType === 'racing') handleRacingInput(r, socket.id, data); }
    catch (e) { console.error('racing:input error:', e.message); }
  });
  socket.on('racing:start', () => {
    try { const r = rooms.get(socket.roomId); if (r && r.gameType === 'racing') startRacing(r, socket.id); }
    catch (e) { console.error('racing:start error:', e.message); }
  });
  socket.on('racing:reset', () => {
    try { const r = rooms.get(socket.roomId); if (r && r.gameType === 'racing') resetRacing(r, socket.id); }
    catch (e) { console.error('racing:reset error:', e.message); }
  });

  socket.on('chat:send', ({ text, type }) => {
    try {
      const room = rooms.get(socket.roomId);
      if (!room) return;
      const player = getPlayer(room, socket.id);
      const name = player ? player.name : (room.spectators.find(s=>s.socketId===socket.id)?.name || 'Guest');
      const msg = { id: generateRoomId(), name, text: String(text||'').slice(0, 200), type: type || 'text', time: now() };
      room.messages.push(msg);
      if (room.messages.length > 50) room.messages.shift();
      emitRoom(room, 'chat:message', msg);
    } catch (e) { console.error('chat:send error:', e.message); }
  });

  socket.on('disconnect', () => {
    try {
      removeFromQuickMatch(socket);
      if (!socket.roomId) return;
      const room = rooms.get(socket.roomId);
      if (!room) return;
      const player = getPlayer(room, socket.id);
      if (player) {
        player.connected = false;
        schedulePlayerRemoval(room, player);
        broadcastState(room);
        return;
      }
      const spec = room.spectators.find(s => s.socketId === socket.id);
      if (spec) {
        room.spectators = room.spectators.filter(s => s.socketId !== socket.id);
        broadcastState(room);
      }
    } catch (e) { console.error('disconnect error:', e.message); }
  });

  // Unified game:move / game:reset for turn-based Agent games
  socket.on('game:move', data => {
    try {
      const r = rooms.get(socket.roomId);
      if (!r) return;
      clearVotesOnMove(r);
      switch (r.gameType) {
        case 'othello': handleOthelloMove(r, socket.id, data); break;
        case 'bullsandcows': handleBullsandcowsMove(r, socket.id, data); break;
        case 'blackjack': handleBlackjackMove(r, socket.id, data); break;
        case 'ulttt': handleUltttMove(r, socket.id, data); break;
        case 'minichess': handleMinichessMove(r, socket.id, data); break;
      }
    } catch (e) { console.error('game:move error:', e.message); }
  });
  socket.on('game:reset', () => {
    try {
      const r = rooms.get(socket.roomId);
      if (!r) return;
      switch (r.gameType) {
        case 'othello': resetOthello(r, socket.id); break;
        case 'bullsandcows': resetBullsandcows(r, socket.id); break;
        case 'blackjack': resetBlackjack(r, socket.id); break;
        case 'ulttt': resetUlttt(r, socket.id); break;
        case 'minichess': resetMinichess(r, socket.id); break;
      }
    } catch (e) { console.error('game:reset error:', e.message); }
  });
}
io.on('connection', socket => {
  try { attachGameListeners(socket); }
  catch (e) { console.error('connection error:', e.message); }
});

// ---------- REST API ----------
app.get('/api/health', (req, res) => res.json({ ok: true, rooms: rooms.size, uptime: process.uptime() }));

app.post('/api/auth/register', (req, res) => {
  try {
    const { account, password, name } = req.body || {};
    const result = createUser(account, password, name);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ ...result.user, token: result.user.id });
  } catch (e) { console.error('/api/auth/register error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/auth/login', (req, res) => {
  try {
    const { account, password } = req.body || {};
    const u = checkLogin(account, password);
    if (!u) return res.status(401).json({ error: '账号或密码错误' });
    res.json({ ...publicUser(u), token: u.id });
  } catch (e) { console.error('/api/auth/login error:', e.message); res.status(500).json({ error: e.message }); }
});
app.get('/api/auth/me', (req, res) => {
  try {
    const u = getUserByToken(req.query.token);
    if (!u) return res.status(401).json({ error: '未登录' });
    res.json(publicUser(u));
  } catch (e) { console.error('/api/auth/me error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/auth/rename', (req, res) => {
  try {
    const { token, name } = req.body || {};
    const result = renameUser(token, name);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result.user);
  } catch (e) { console.error('/api/auth/rename error:', e.message); res.status(500).json({ error: e.message }); }
});
app.get('/api/users/records', (req, res) => {
  try {
    const u = getUserByToken(req.query.token);
    if (!u) return res.status(401).json({ error: '未登录' });
    res.json({ user: publicUser(u), records: getUserRecords(u.id) });
  } catch (e) { console.error('/api/users/records error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/leaderboard/submit', (req, res) => {
  try {
    const { token, game, score } = req.body || {};
    const u = getUserByToken(token);
    if (!u) return res.status(401).json({ error: '未登录' });
    const result = submitRecord(u.id, game, score);
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true });
  } catch (e) { console.error('/api/leaderboard/submit error:', e.message); res.status(500).json({ error: e.message }); }
});
app.get('/api/leaderboard', (req, res) => {
  try {
    res.json({ game: req.query.game, list: getLeaderboard(req.query.game, parseInt(req.query.limit, 10) || 20) });
  } catch (e) { console.error('/api/leaderboard error:', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/rooms', (req, res) => {
  const list = [];
  for (const room of rooms.values()) {
    if (!room.isPublic) continue;
    if (connectedPlayerCount(room) >= 2) continue;
    if (room.state.status === 'finished' || room.state.status === 'ended') continue;
    list.push({
      id: room.id,
      gameType: room.gameType,
      isPublic: room.isPublic,
      players: room.players.map(p => ({ name: p.name, symbol: p.symbol, isHost: p.isHost, connected: p.connected })),
      status: room.state.status,
      createdAt: room.createdAt
    });
  }
  res.json({ rooms: list });
});

app.get('/api/rooms/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({
    id: room.id,
    gameType: room.gameType,
    isPublic: room.isPublic,
    players: room.players.map(p => ({ name: p.name, symbol: p.symbol, isHost: p.isHost, connected: p.connected })),
    status: room.state.status
  });
});

// ---------- Agent-friendly REST API for turn-based games ----------
const API_GAMES = ['othello', 'bullsandcows', 'blackjack', 'ulttt', 'minichess'];
function apiCreateRoom(gameType, playerName) {
  const room = createRoom(gameType, playerName || 'Agent', 'api-host');
  room.apiHost = true;
  return room;
}
function apiJoinRoom(room, playerName) {
  if (room.players.length >= 2) return null;
  const sid = 'api-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
  return { player: joinRoomAsPlayer(room, sid, playerName || 'Agent'), playerId: sid };
}
API_GAMES.forEach(type => {
  app.post(`/api/games/${type}/rooms`, (req, res) => {
    try {
      const room = apiCreateRoom(type, req.body.playerName);
      res.json({ success: true, roomId: room.id, link: getShareLink(room), state: publicRoomState(room) });
    } catch (e) { console.error(`api ${type} rooms error:`, e.message); res.status(500).json({ error: e.message }); }
  });
  app.get(`/api/games/${type}/rooms/:roomId`, (req, res) => {
    try {
      const room = rooms.get(req.params.roomId.toUpperCase());
      if (!room || room.gameType !== type) return res.status(404).json({ error: 'Room not found' });
      res.json(publicRoomState(room));
    } catch (e) { console.error(`api ${type} get error:`, e.message); res.status(500).json({ error: e.message }); }
  });
  app.post(`/api/games/${type}/rooms/:roomId/join`, (req, res) => {
    try {
      const room = rooms.get(req.params.roomId.toUpperCase());
      if (!room || room.gameType !== type) return res.status(404).json({ error: 'Room not found' });
      const joined = apiJoinRoom(room, req.body.playerName);
      if (!joined) return res.status(400).json({ error: 'Room full' });
      if (connectedPlayerCount(room) === 2) startGameIfReady(room);
      broadcastState(room);
      res.json({ success: true, playerId: joined.playerId, player: { name: joined.player.name, symbol: joined.player.symbol }, state: publicRoomState(room) });
    } catch (e) { console.error(`api ${type} join error:`, e.message); res.status(500).json({ error: e.message }); }
  });
});
app.post('/api/games/:type/move', (req, res) => {
  try {
    const type = req.params.type;
    if (!API_GAMES.includes(type)) return res.status(400).json({ ok: false, error: 'Unsupported game type' });
    const { roomId, playerId, move } = req.body || {};
    if (!roomId || !playerId) return res.status(400).json({ ok: false, error: 'missing roomId or playerId' });
    const room = rooms.get(String(roomId).toUpperCase());
    if (!room || room.gameType !== type) return res.status(404).json({ ok: false, error: 'Room not found' });
    switch (type) {
      case 'othello': {
        const p = room.players.find(p => String(p.symbol) === String(playerId) || p.name === playerId);
        if (p) handleOthelloMove(room, p.socketId, move); else res.status(404).json({ ok: false, error: 'Player not found' });
      } break;
      case 'bullsandcows': {
        const p = room.players.find(p => String(p.symbol) === String(playerId) || p.name === playerId);
        if (p) handleBullsandcowsMove(room, p.socketId, move); else res.status(404).json({ ok: false, error: 'Player not found' });
      } break;
      case 'blackjack': handleBlackjackMove(room, playerId, move); break;
      case 'ulttt': handleUltttMove(room, playerId, move); break;
      case 'minichess': handleMinichessMove(room, playerId, move); break;
    }
    res.json({ ok: true, state: publicRoomState(room).state });
  } catch (e) { console.error('/api/games/:type/move error:', e.message); res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const { messages, model, temperature, response_format } = req.body;
    const result = await axios.post(`${AGNES_BASE_URL}/chat/completions`, { model: model||CHAT_MODEL, messages, temperature: temperature??0.7, response_format }, { headers: { Authorization: `Bearer ${AGNES_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000 });
    res.json(result.data);
  } catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});
app.post('/api/ai/image', async (req, res) => {
  try {
    const { prompt, size, n } = req.body;
    const result = await axios.post(`${AGNES_BASE_URL}/images/generations`, { model: IMAGE_MODEL, prompt, n: n||1, size: size||'1024x1024' }, { headers: { Authorization: `Bearer ${AGNES_KEY}`, 'Content-Type': 'application/json' }, timeout: 90000 });
    res.json(result.data);
  } catch (e) { res.status(500).json({ error: e.message, details: e.response?.data }); }
});
app.post('/api/ai/tts', async (req, res) => {
  try {
    const { text, voice, model } = req.body;
    const audio = await synthesize(text, voice||TTS_VOICE, model||TTS_MODEL);
    if (!audio) return res.status(500).json({ error: 'TTS failed' });
    res.json({ audio, text });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---------- OpenClaw Remote API for Drawguess ----------
app.post('/api/openclaw/drawguess/rooms', (req, res) => {
  try {
    const room = createRoom('drawguess', req.body.playerName || 'OpenClaw', 'openclaw-host');
    room.openclawHost = true;
    res.json({ success: true, roomId: room.id, link: getShareLink(room), state: publicRoomState(room) });
  } catch (e) { console.error('openclaw drawguess rooms error:', e.message); res.status(500).json({ error: e.message }); }
});
app.get('/api/openclaw/drawguess/rooms/:roomId', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'drawguess') return res.status(404).json({ error: 'Room not found' });
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw drawguess get error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/drawguess/rooms/:roomId/join', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'drawguess') return res.status(404).json({ error: 'Room not found' });
    if (room.players.length >= 2) return res.status(400).json({ error: 'Room full' });
    const sid = `openclaw-${Date.now()}`;
    const player = joinRoomAsPlayer(room, sid, req.body.playerName || 'OpenClaw');
    res.json({ success: true, playerId: sid, player: { name: player.name, symbol: player.symbol }, state: publicRoomState(room) });
  } catch (e) { console.error('openclaw drawguess join error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/drawguess/rooms/:roomId/start', async (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'drawguess') return res.status(404).json({ error: 'Room not found' });
    await startDrawguessRound(room);
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw drawguess start error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/drawguess/rooms/:roomId/guess', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'drawguess') return res.status(404).json({ error: 'Room not found' });
    const { playerId, guess } = req.body;
    const player = room.players.find(p => p.socketId === playerId);
    if (!player) return res.status(400).json({ error: 'Player not in room' });
    if (!room.state.secretWord) return res.status(400).json({ error: 'Round not started' });
    const wordObj = WORD_POOL.find(w => w.word && w.word.toLowerCase() === room.state.secretWord.toLowerCase());
    const correct = isCorrectGuess(wordObj, guess);
    const displayGuess = String(guess).trim();
    room.state.guesses.push({ player: player.name, guess: displayGuess, symbol: player.symbol });
    if (correct) {
      room.state.scores[player.symbol] = (room.state.scores[player.symbol]||0)+1;
      room.state.winner = player.symbol; room.state.status = 'ended';
      room.state.message = `🎉 ${player.name} guessed correctly! Answer: ${room.state.secretWord}`;
    } else room.state.message = `❌ ${player.name} guessed wrong`;
    broadcastState(room);
    res.json({ guess: displayGuess, correct, answer: room.state.secretWord, state: publicRoomState(room) });
  } catch (e) { console.error('openclaw drawguess guess error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/drawguess/rooms/:roomId/agnes-guess', async (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'drawguess') return res.status(404).json({ error: 'Room not found' });
    if (!AGNES_KEY) return res.status(500).json({ error: 'Agnes key missing' });
    const player = room.players.find(p => p.socketId === req.body.playerId);
    if (!player) return res.status(400).json({ error: 'Player not in room' });
    if (!room.state.secretWord) return res.status(400).json({ error: 'Round not started' });
    const result = await axios.post(`${AGNES_BASE_URL}/chat/completions`, {
      model: CHAT_MODEL,
      messages: [
        { role: 'system', content: 'You are playing a word guessing game. Based on the image category and previous guesses, guess a single English word. Return only JSON: {"guess":"word"}.' },
        { role: 'user', content: `Category: ${room.state.category}. Previous guesses: ${room.state.guesses.map(g=>g.guess).join(', ')||'none'}. What is the word?` }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    }, { headers: { Authorization: `Bearer ${AGNES_KEY}`, 'Content-Type': 'application/json' }, timeout: 20000 });
    const parsed = JSON.parse(result.data.choices[0].message.content || '{}');
    const guess = String(parsed.guess || '').trim();
    const wordObj = WORD_POOL.find(w => w.word && w.word.toLowerCase() === room.state.secretWord.toLowerCase());
    const correct = isCorrectGuess(wordObj, guess);
    room.state.guesses.push({ player: `${player.name} (Agnes)`, guess, symbol: player.symbol });
    if (correct) { room.state.scores[player.symbol]=(room.state.scores[player.symbol]||0)+1; room.state.winner=player.symbol; room.state.status='ended'; room.state.message=`🎉 ${player.name} (Agnes) guessed correctly! Answer: ${room.state.secretWord}`; }
    else room.state.message = `❌ ${player.name} (Agnes) guessed "${guess}" — wrong`;
    broadcastState(room);
    res.json({ guess, correct, answer: room.state.secretWord, state: publicRoomState(room) });
  } catch (e) { console.error('agnes-guess error:', e.message); res.status(500).json({ error: e.message }); }
});
// ---------- OpenClaw endpoints for Gomoku / Tictactoe / Connect4 / Pong ----------
function openclawRoom(gameType, playerName) {
  const room = createRoom(gameType, playerName || 'OpenClaw', 'openclaw-host');
  room.openclawHost = true;
  return room;
}
function openclawJoin(room, playerName) {
  if (room.players.length >= 2) return null;
  const sid = `openclaw-${Date.now()}`;
  return { player: joinRoomAsPlayer(room, sid, playerName || 'OpenClaw'), playerId: sid };
}

['gomoku','tictactoe','connect4','pong','rps','memory','dots'].forEach(gameType => {
  app.post(`/api/openclaw/${gameType}/rooms`, (req, res) => {
    try {
      const room = openclawRoom(gameType, req.body.playerName);
      res.json({ success: true, roomId: room.id, link: getShareLink(room), state: publicRoomState(room) });
    } catch (e) { console.error(`openclaw ${gameType} rooms error:`, e.message); res.status(500).json({ error: e.message }); }
  });
  app.get(`/api/openclaw/${gameType}/rooms/:roomId`, (req, res) => {
    try {
      const room = rooms.get(req.params.roomId.toUpperCase());
      if (!room || room.gameType !== gameType) return res.status(404).json({ error: 'Room not found' });
      res.json(publicRoomState(room));
    } catch (e) { console.error(`openclaw ${gameType} get error:`, e.message); res.status(500).json({ error: e.message }); }
  });
  app.post(`/api/openclaw/${gameType}/rooms/:roomId/join`, (req, res) => {
    try {
      const room = rooms.get(req.params.roomId.toUpperCase());
      if (!room || room.gameType !== gameType) return res.status(404).json({ error: 'Room not found' });
      const joined = openclawJoin(room, req.body.playerName);
      if (!joined) return res.status(400).json({ error: 'Room full' });
      if (gameType === 'pong' && room.players.length === 2) startPongIfReady(room);
      if (['gomoku','tictactoe','connect4','rps','memory','dots','othello','bullsandcows','blackjack','ulttt','minichess'].includes(gameType)) startGameIfReady(room);
      broadcastState(room);
      res.json({ success: true, playerId: joined.playerId, player: { name: joined.player.name, symbol: joined.player.symbol }, state: publicRoomState(room) });
    } catch (e) { console.error(`openclaw ${gameType} join error:`, e.message); res.status(500).json({ error: e.message }); }
  });
});

app.post('/api/openclaw/gomoku/rooms/:roomId/move', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'gomoku') return res.status(404).json({ error: 'Room not found' });
    handleGomokuMove(room, req.body.playerId, { row: req.body.row, col: req.body.col });
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw gomoku move error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/gomoku/rooms/:roomId/reset', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'gomoku') return res.status(404).json({ error: 'Room not found' });
    resetGomoku(room, req.body.playerId);
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw gomoku reset error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/openclaw/tictactoe/rooms/:roomId/move', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'tictactoe') return res.status(404).json({ error: 'Room not found' });
    handleTictactoeMove(room, req.body.playerId, { row: req.body.row, col: req.body.col });
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw tictactoe move error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/tictactoe/rooms/:roomId/reset', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'tictactoe') return res.status(404).json({ error: 'Room not found' });
    resetTictactoe(room, req.body.playerId);
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw tictactoe reset error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/openclaw/connect4/rooms/:roomId/drop', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'connect4') return res.status(404).json({ error: 'Room not found' });
    connect4Drop(room, req.body.playerId, { col: req.body.col });
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw connect4 drop error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/connect4/rooms/:roomId/reset', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'connect4') return res.status(404).json({ error: 'Room not found' });
    resetConnect4(room, req.body.playerId);
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw connect4 reset error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/openclaw/pong/rooms/:roomId/paddle', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'pong') return res.status(404).json({ error: 'Room not found' });
    handlePongPaddle(room, req.body.playerId, { x: req.body.x });
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw pong paddle error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/pong/rooms/:roomId/serve', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'pong') return res.status(404).json({ error: 'Room not found' });
    handlePongServe(room, req.body.playerId);
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw pong serve error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/pong/rooms/:roomId/reset', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'pong') return res.status(404).json({ error: 'Room not found' });
    resetPong(room, req.body.playerId);
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw pong reset error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/openclaw/rps/rooms/:roomId/choice', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'rps') return res.status(404).json({ error: 'Room not found' });
    handleRpsChoice(room, req.body.playerId, { choice: req.body.choice });
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw rps choice error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/rps/rooms/:roomId/start', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'rps') return res.status(404).json({ error: 'Room not found' });
    startRps(room, req.body.playerId);
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw rps start error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/rps/rooms/:roomId/next', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'rps') return res.status(404).json({ error: 'Room not found' });
    nextRpsRound(room, req.body.playerId);
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw rps next error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/rps/rooms/:roomId/reset', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'rps') return res.status(404).json({ error: 'Room not found' });
    resetRps(room, req.body.playerId);
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw rps reset error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/openclaw/memory/rooms/:roomId/flip', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'memory') return res.status(404).json({ error: 'Room not found' });
    handleMemoryFlip(room, req.body.playerId, { index: req.body.index });
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw memory flip error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/memory/rooms/:roomId/reset', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'memory') return res.status(404).json({ error: 'Room not found' });
    resetMemory(room, req.body.playerId);
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw memory reset error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/openclaw/dots/rooms/:roomId/line', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'dots') return res.status(404).json({ error: 'Room not found' });
    handleDotsLine(room, req.body.playerId, { dir: req.body.dir, r: req.body.r, c: req.body.c });
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw dots line error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/dots/rooms/:roomId/reset', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'dots') return res.status(404).json({ error: 'Room not found' });
    resetDots(room, req.body.playerId);
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw dots reset error:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/openclaw/draw2guess/rooms', (req, res) => {
  try {
    const room = openclawRoom('draw2guess', req.body.playerName);
    res.json({ success: true, roomId: room.id, link: getShareLink(room), state: publicRoomState(room) });
  } catch (e) { console.error('openclaw draw2guess rooms error:', e.message); res.status(500).json({ error: e.message }); }
});
app.get('/api/openclaw/draw2guess/rooms/:roomId', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'draw2guess') return res.status(404).json({ error: 'Room not found' });
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw draw2guess get error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/draw2guess/rooms/:roomId/join', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'draw2guess') return res.status(404).json({ error: 'Room not found' });
    const joined = openclawJoin(room, req.body.playerName);
    if (!joined) return res.status(400).json({ error: 'Room full' });
    res.json({ success: true, playerId: joined.playerId, player: { name: joined.player.name, symbol: joined.player.symbol }, state: publicRoomState(room) });
  } catch (e) { console.error('openclaw draw2guess join error:', e.message); res.status(500).json({ error: e.message }); }
});
app.get('/api/openclaw/draw2guess/rooms/:roomId/word', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'draw2guess') return res.status(404).json({ error: 'Room not found' });
    const player = room.players.find(p => p.socketId === req.query.playerId);
    if (!player || player.symbol !== room.state.drawer) return res.status(403).json({ error: 'Not drawer' });
    res.json({ word: room.state.secretWord, category: room.state.category });
  } catch (e) { console.error('openclaw draw2guess word error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/draw2guess/rooms/:roomId/start', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'draw2guess') return res.status(404).json({ error: 'Room not found' });
    const p = room.players.find(pl => pl.socketId === req.body.playerId);
    if (!p || !p.isHost) return res.status(403).json({ error: 'Only host' });
    if (room.players.length < 2) return res.status(400).json({ error: 'Need 2 players' });
    startDraw2GuessRound(room);
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw draw2guess start error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/draw2guess/rooms/:roomId/stroke', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'draw2guess') return res.status(404).json({ error: 'Room not found' });
    handleDraw2GuessStroke(room, req.body.playerId, { stroke: req.body.stroke });
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw draw2guess stroke error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/draw2guess/rooms/:roomId/guess', async (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'draw2guess') return res.status(404).json({ error: 'Room not found' });
    await handleDraw2GuessGuess(room, req.body.playerId, { guess: req.body.guess });
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw draw2guess guess error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/draw2guess/rooms/:roomId/next', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'draw2guess') return res.status(404).json({ error: 'Room not found' });
    nextDraw2GuessRound(room, req.body.playerId);
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw draw2guess next error:', e.message); res.status(500).json({ error: e.message }); }
});
app.post('/api/openclaw/draw2guess/rooms/:roomId/reset', (req, res) => {
  try {
    const room = rooms.get(req.params.roomId.toUpperCase());
    if (!room || room.gameType !== 'draw2guess') return res.status(404).json({ error: 'Room not found' });
    resetDraw2Guess(room, req.body.playerId);
    res.json(publicRoomState(room));
  } catch (e) { console.error('openclaw draw2guess reset error:', e.message); res.status(500).json({ error: e.message }); }
});

app.get('/api/openclaw', (req, res) => {
  res.json({ info: 'OpenClaw remote play endpoints', endpoints: [
    'drawguess: POST /api/openclaw/drawguess/rooms, :roomId/join, :roomId/start, :roomId/guess, :roomId/agnes-guess',
    'gomoku: POST /api/openclaw/gomoku/rooms, :roomId/join, :roomId/move, :roomId/reset',
    'tictactoe: POST /api/openclaw/tictactoe/rooms, :roomId/join, :roomId/move, :roomId/reset',
    'connect4: POST /api/openclaw/connect4/rooms, :roomId/join, :roomId/drop, :roomId/reset',
    'pong: POST /api/openclaw/pong/rooms, :roomId/join, :roomId/paddle, :roomId/serve, :roomId/reset',
    'rps: POST /api/openclaw/rps/rooms, :roomId/join, :roomId/start, :roomId/choice, :roomId/next, :roomId/reset',
    'memory: POST /api/openclaw/memory/rooms, :roomId/join, :roomId/flip, :roomId/reset',
    'dots: POST /api/openclaw/dots/rooms, :roomId/join, :roomId/line, :roomId/reset',
    'draw2guess: POST /api/openclaw/draw2guess/rooms, :roomId/join, :roomId/start, :roomId/stroke, :roomId/guess, :roomId/next, :roomId/reset'
  ]});
});

// ---------- Catch-all ----------
app.get('*', (req, res) => {
  try {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } catch (e) {
    console.error('sendFile error:', e.message);
    res.status(500).send('Server error');
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Express error:', err && err.stack ? err.stack : err);
  res.status(500).json({ error: 'Internal server error' });
});
setInterval(() => {
  const t = now();
  for (const [id, room] of rooms) {
    if (room.quickMatch && room.players.length === 0 && t > room.reservedUntil) {
      rooms.delete(id);
    } else if (!room.quickMatch && room.players.length === 0 && room.spectators.length === 0 && t - room.createdAt > 5 * 60 * 1000) {
      rooms.delete(id);
    } else if (!room.quickMatch && room.players.length > 0 && connectedPlayerCount(room) === 0 && t - room.lastActivity > DISCONNECT_GRACE_MS + 5000) {
      rooms.delete(id);
    }
  }
}, 10000);

server.listen(PORT, () => {
  console.log(`🎮 AI Game Box running on http://0.0.0.0:${PORT}`);
  if (AGNES_KEY) refillImageCache();
});
