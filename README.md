# 🎮 沫芒游境 · Game Box

> **多人在线小游戏盒子** — 手机端优先，支持AI对战、本地双人和在线联机

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.x-blue.svg)](https://expressjs.com)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-lightgrey.svg)](https://socket.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ 在线体验

部署后访问 `http://<你的IP>:3000` 即可开玩。

---

## 🎯 游戏列表

### 🧠 策略棋牌

| 游戏 | 单人 | AI对战 | 联机对战 | 说明 |
|:----|:---:|:------:|:--------:|:----|
| ⚫⚪ **五子棋** | ✅ | ✅ | ✅ | 本地双人/AI/在线开黑，带聊天贴纸 |
| 🎱 **奥赛罗** | — | ✅ | — | AI黑白棋 |
| ♟️ **迷你国际象棋** | — | ✅ | — | 简化国际象棋规则 |
| 🔢 **2048** | ✅ | — | — | 经典数字合成 |
| 🐂 **猜数字** | — | — | ✅ | Bulls and Cows多人版 |

### 🏃 实时竞技

| 游戏 | 模式 | 说明 |
|:----|:----|:----|
| 🏓 **乒乓对决** | 同屏PK / 在线对战 | 竖屏5分制快节奏 |
| 🏎️ **赛车** | 在线对战 | 实时竞速 |
| ⚪ **打砖块** | 单人 | 经典Breakout |
| 🐍 **贪吃蛇** | 单人 / 在线 | 双人同屏对战 |
| 🐍 **贪吃蛇(单人)** | 单人 | 经典模式 |

### 🎨 创意互动

| 游戏 | 模式 | 说明 |
|:----|:----|:----|
| 🎨 **AI画图猜词** | 单人 / 在线 | 看图猜词，AI为你作画 |
| 👥 **画画接力** | 多人 | 你画我猜2人版 |
| 💬 **你画我猜2** | 联机 | 在线多人猜词 |
| 🔫 **射击游戏** | 单人 | 生存射击 |

### 🧩 小游戏

| 游戏 | 模式 | 说明 |
|:----|:----|:----|
| ❌⭕ **井字棋** | AI对战 / 联机 | 经典三连棋 |
| 🔵🔴 **四子棋** | AI对战 / 联机 | Connect 4 |
| 🟡⚫ **黑白棋** | AI对战 | 极简版Othello |
| 🚗 **停车挑战** | 单人 | 拼图式泊车 |
| 🚧 **停车出口** | 单人 | 倒车出库解谜 |
| ✂️ **石头剪刀布** | 联机 | 经典猜拳 |
| 🪂 **坠落求生** | 单人 | 反应力挑战 |
| 🎯 **记忆翻牌** | 单人 | 记忆力训练 |
| 👻 **传送门** | 单人 | 益智解谜 |
| 🟦 **点点连线** | 联机 | Dots多人对战 |

---

## 🛠 技术栈

```
前端: 原生 HTML/CSS/JS  ·  响应式移动端优先
后端: Node.js + Express  ·  Socket.IO 实时通信
存储: 内存 + 文件系统    ·  Session + Token 认证
```

### 核心依赖

| 包 | 用途 |
|---|------|
| `express` | Web框架 |
| `socket.io` | WebSocket实时通信 |
| `axios` | HTTP客户端（AI画图等） |

---

## 🚀 部署

### 快速启动

```bash
# 安装依赖
npm install

# 启动（默认端口3000）
node server.js

# 或指定端口
PORT=8080 node server.js
```

### Docker

```bash
docker build -t game-box .
docker run -d -p 3000:3000 game-box
```

---

## 🔧 配置

| 环境变量 | 说明 | 默认值 |
|---------|------|--------|
| `PORT` | 服务端口 | `3000` |
| `AG_KEY` | AI画图API密钥 | — |

---

## 📂 项目结构

```
public/
├── index.html          # 首页（沫芒游境）
├── games/              # 所有游戏HTML/JS
│   ├── gomoku.html     # 五子棋
│   ├── pong.html       # 乒乓
│   ├── racing.html     # 赛车
│   ├── snake.html      # 贪吃蛇
│   ├── parking-exit.html # 停车出口
│   └── ...             # 30+游戏
├── style.css           # 全局样式
└── light-home.css      # 首页样式
server.js               # 服务端（路由 + Socket.IO + Session）
```

---

## 🤝 贡献指南

1. Fork 本仓库
2. 新建游戏在 `public/games/` 下添加 `xxx.html + xxx.js`
3. 在 `index.html` 的game-grid中添加卡片
4. 如果游戏需要联机功能，在 `server.js` 中添加socket事件处理
5. 提交PR

---

## 📜 许可证

MIT
