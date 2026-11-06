# TODO

按优先级记录待办事项。完成一项后把「状态」改为「已完成」，并在对应提交里同步 `CHANGELOG.md`。

## 交付约定

新增**僵尸 / 武器 / 地图**时必须同时交付以下内容，缺一不算完成：

- 代码：实体定义文件 + 注册表登记（僵尸 `src/data/zombies/`、武器 `src/data/weapons/`、地图 `src/data/maps/`）。
- 精灵：`src/art/` 里的 32×32 像素精灵与全部动画帧（含死亡/开火等），并在预览页核对 anchor / muzzle / footprintRadius。
- 音效：`public/audio/` 的音频文件 + `src/audio/events.ts` 的事件、`SFX_MAP`、`SFX_THROTTLE` 登记，并在 `public/audio/CREDITS.md` 补授权台账。
- 文档：同步更新 `README.md` 与 `CHANGELOG.md`。
- 训练场：确认新实体在训练场单位库自动出现、可生成、统计列正常。

## 高优先级

（暂无）

## 中优先级

### 人为操控单位

- 优先级：中
- 状态：待办
- 说明：训练场支持手动操控某个单位（键盘/点击移动、手动开火），用于手动验证手感与 AI 行为。
- 涉及模块：`src/training/`、`src/systems/ai.ts`、`src/systems/combat.ts`、`src/core/world.ts`、`src/main.ts`（输入）、`src/render/renderer.ts`（选中与操控提示）。

## 低优先级

### AI 生成音效

- 优先级：低
- 状态：待办
- 说明：引入 AI 音效生成路线（ElevenLabs 官方托管 MCP 或本地 Stable Audio 3 Small SFX），替换当前合成的干瘪音色，尤其是僵尸吼叫与枪械。
- 涉及模块：`public/audio/`、`src/audio/events.ts`、`src/audio/manager.ts`、`public/audio/CREDITS.md`。

## 待定

### 多地图与多关卡

- 优先级：待定
- 状态：待办
- 说明：见后续讨论，暂记一条占位。
- 涉及模块：`src/data/maps/`、`src/levels.ts`、`src/router.ts`、选关与 HUD。

### 地图工坊（瓦片地图编辑器）

- 优先级：待定（排在 0.4.2 之后）
- 状态：待办
- 分层定位：工坊是**内容生产工具**，不是玩家功能。开发者模式可见并可新增地图；玩家模式只提供已发布地图的游玩，界面不出现工坊入口。
- 权限边界：纯浏览器游戏没有后端账号，开发者模式只能做到「界面隐藏」，**不是安全边界**——玩家改 localStorage 或直接访问 URL 仍可进入。若未来需要真隔离，得走服务端发布或维护两套构建产物；文档里写明这一点，避免后来者误以为有权限校验。
- 数据形态：地图必须先 **JSON 化**——把现有 TS 常量地图改成带 `schemaVersion` 的 JSON 定义，工坊编辑它、对局读取它。开发者的产出走「导出 JSON → 进仓库 `public/maps/` 或 `src/data/maps/` → 随版本发布」，才真正实现「开发者建图、玩家游玩」；只存 localStorage 仅对本机有效，不能当成发布。
- 校验要双向：编辑期给警告，加载期也要**拒绝非法地图并回退默认图**（例如无入口、出生区被堵死）。
- 前置条件：先把多地图 / 开口实例化那套结构落地。
- 说明：把地图从「线段式」（按墙段与开口矩形描述）改成「瓦片式」（N×M 网格，每格是墙 / 窗 / 空），流场、碰撞、渲染、开口血量、守岗逻辑都要跟着换。开工前先向用户确认以下问题，避免返工：
  1. 格子大小（32px 一格 37×22 = 1184×704，还是 16px 一格）；
  2. 可绘元素（只有墙 + 窗，还是含门；出入口自由摆放还是固定位）；
  3. 敌人出生带与人类区是否也在编辑器里划定；
  4. 合法性校验（至少一个入口、出生区连通；不合法禁止保存还是允许但警告）；
  5. 保存方式（仅本地，还是支持导出 / 导入 JSON）；
  6. 适用范围（只在训练场试玩，还是能进正式对局 / 闯关）。
- 推荐顺序：①地图 JSON 化（玩法不变，现有地图生成等价 JSON）→ ②工坊编辑器 → ③放置模式选图 → ④闯关模式（关卡 = 地图 + 波次 + 目标，工坊只管前半段）。
- 涉及模块：`src/data/maps/`、`src/core/world.ts`、`src/systems/flowField.ts`、`src/systems/ai.ts`、`src/core/game.ts`、`src/render/renderer.ts`、`src/training/`、`src/levels.ts`。
