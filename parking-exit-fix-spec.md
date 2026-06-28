# 停车场出口游戏 - 第二轮修改规格

## 文件
- 源文件：`public/games/parking-exit.html`
- 只修改这个文件

## 修改项

### 1. 环形道乘客匹配问题（核心修复）
**现象**：当前活跃颜色的乘客不在环形道上，导致该颜色的车无法进入停车位上客。
**位置**：`loadLevel()` 中 track 填充逻辑（~1340-1350行）和 `refillTrackFromPending()`（~1630-1653行）

**要求**：
- 关卡加载时，`pendingPassengers` 的第一个乘客**必须是**当前活跃颜色（`levelColorOrder[0]`），确保轨道能填充乘客
- `refillTrackFromPending()` 要更主动地补充轨道，不要等
- 如果轨道为空且有待上车乘客，立即补充轨道，确保轨道始终有活跃颜色的乘客
- 补充速度可以稍快一些（当前 `setInterval(refillTrackFromPending, 180)` 的间隔可保持）
- 关键：`pendingPassengers[0] !== activeColor` 时不能跳过，应该移动指针找到正确颜色的乘客

### 2. 乘客排序散开（混合排列）
**现象**：当前 `makePassengers()` (744-753行) 按颜色分组排列乘客（先全部红色，再全部蓝色...），导致上车时一串同色。
**要求**：
- 生成乘客列表后，**打散排列**，让颜色交错
- 例如：红、蓝、红、绿、蓝、红、蓝、绿 这样交错
- 方法：在 `makePassengers()` 中，先算出每个颜色的人数，然后轮流从各颜色取人，直到取完
- 效果：环形道上看到各种颜色交错排列，而不是一坨同色
- 但仍然要保证第一个乘客是当前活跃颜色

### 3. 大幅增加车辆数量和难度
**现象**：当前棋盘车辆不够密集，难度不够。
**要求**：
- 在 `makeLevelSpecs()` 中大幅增加车辆数量：
  - `minCars` 从 8→15（第1关就有15辆）
  - `maxCars` 从 18→24
  - 使用更多颜色：`colorCount` 改为 `Math.min(COLORS.length, 3 + Math.floor((levelNum - 1) / 2))`（从第1关就用3种颜色）
- 车辆大小和容量不变
- 使用所有7种颜色（red, blue, green, yellow, purple, pink, orange），不要只取前N个
- 颜色选择改为随机从全部颜色池中取，不局限前N种
- 增加对角方向车辆的比例（提高可玩性）
- 保持 `simulateSolvable()` 可解性检查

## 注意事项
- 只修改 parking-exit.html
- 保持其他功能不变
