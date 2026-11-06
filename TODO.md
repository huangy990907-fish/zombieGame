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

- 优先级：待定
- 状态：待办
- 前置条件：先把多地图 / 开口实例化那套结构落地。
- 说明：把地图从「线段式」（按墙段与开口矩形描述）改成「瓦片式」（N×M 网格，每格是墙 / 窗 / 空），流场、碰撞、渲染、开口血量、守岗逻辑都要跟着换。开工前先向用户确认以下问题，避免返工：
  1. 格子大小（32px 一格 37×22 = 1184×704，还是 16px 一格）；
  2. 可绘元素（只有墙 + 窗，还是含门；出入口自由摆放还是固定位）；
  3. 敌人出生带与人类区是否也在编辑器里划定；
  4. 合法性校验（至少一个入口、出生区连通；不合法禁止保存还是允许但警告）；
  5. 保存方式（仅本地，还是支持导出 / 导入 JSON）；
  6. 适用范围（只在训练场试玩，还是能进正式对局 / 闯关）。
- 建议分三期：①瓦片模型 + JSON 读写，现有地图用代码生成等价瓦片（玩法不变）；②编辑器 UI 与校验；③接入训练场 / 关卡。
- 涉及模块：`src/data/maps/`、`src/core/world.ts`、`src/systems/flowField.ts`、`src/systems/ai.ts`、`src/core/game.ts`、`src/render/renderer.ts`、`src/training/`、`src/levels.ts`。
