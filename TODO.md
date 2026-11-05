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
