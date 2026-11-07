# TODO

按优先级记录待办事项。完成一项后把对应内容挪到文末「已完成」，并在提交里同步 `CHANGELOG.md`。

## 交付约定

新增**僵尸 / 武器 / 地图 / 关卡**时必须同时交付以下内容，缺一不算完成：

- 代码：实体定义 + 注册表登记（僵尸 `src/data/zombies/`、武器 `src/data/weapons/`、地图 `public/maps/` + manifest、关卡 `public/levels/` + manifest）。
- 精灵：`src/art/` 里的 32×32 像素精灵与全部动画帧，并在 `sprites.html` 核对 anchor / muzzle / footprintRadius。
- 音效：`public/audio/` 文件 + `src/audio/events.ts` 三处登记 + `public/audio/CREDITS.md` 授权台账。
- 文档：同步更新 `README.md`、`CHANGELOG.md`、`AGENTS.md`。
- 验证：`npx tsc --noEmit`、`npm run build`，并在训练场 / 选关页实跑。

## 待办

### 高优先级

#### 草丛（瓦片地形）

- 状态：待办
- 说明：新增可通行瓦片；人类索敌半径缩短、双方在草丛内略微减速；喷火灼烧 1–2 秒后草丛暂时失效并在一段时间后重生。玩家视角不变，僵尸索敌不受限。
- 涉及：`src/data/maps/schema.ts`、`compile.ts`、`src/core/world.ts`、`src/systems/ai.ts`、`combat.ts`、`flowField.ts`、`render/renderer.ts`、`src/training/`。

#### 水池（瓦片地形）

- 状态：待办
- 说明：新增不可通行瓦片（暂等同墙体），子弹与电击枪射线可穿过，不影响视野。
- 涉及：`schema.ts`、`compile.ts`、`world.ts`、`collision.ts`、`combat.ts`、`flowField.ts`、`renderer.ts`。

#### 多关卡扩展

- 状态：待办（0.6.0 已具备关卡 JSON、选关解锁与编辑器，内置仍只有教学关）
- 说明：补充更多内置关卡与难度曲线，验证不同地图 / 波次组合；为「闯关模式」等新模式登记关卡引用，避免被删除。
- 涉及：`public/levels/`、`src/data/levels/`、`src/levels.ts`、`src/main.ts`、README/CHANGELOG。

### 中优先级

#### 人为操控单位

- 状态：待办
- 说明：训练场支持手动操控单个单位（移动、手动开火），用于验证手感与 AI 行为。
- 涉及：`src/training/`、`src/systems/ai.ts`、`combat.ts`、`src/core/world.ts`、`src/main.ts`、`render/renderer.ts`。

#### 电击枪视觉优化

- 状态：待办
- 说明：强化电弧折线与链式跳跃的视觉反馈（起点 / 落点、逐跳衰减、命中高亮），不改变数值与链式规则。
- 涉及：`src/systems/combat.ts`（特效数据）、`src/render/renderer.ts`（`renderArcs`）、`src/art/`（如新增贴图）。

### 低优先级

#### AI 生成音效

- 状态：待办
- 说明：引入 AI 音效生成路线（ElevenLabs 托管 MCP 或本地 Stable Audio），替换当前合成音色，优先僵尸吼叫与枪械；保留现有 CC0 素材作为降级。
- 涉及：`public/audio/`、`src/audio/events.ts`、`manager.ts`、`CREDITS.md`。

#### 音效随机变体

- 状态：待办
- 说明：同一事件支持音高 / 时长随机变化，避免重复音过于机械；仍受全局限频约束。
- 涉及：`src/audio/events.ts`、`manager.ts`。

### 待定

#### 闯关模式

- 状态：待办（主菜单入口为占位说明，不会进入空页面）
- 说明：在放置模式之外增加「闯关」玩法与多种胜负条件；关卡引用通过 `registerLevelReference()` 登记。
- 涉及：`src/levels.ts`、`src/main.ts`、`src/core/game.ts`、`index.html`、`src/style.css`。

## 已完成

- **0.6.0 放置模式关卡制**：关卡 JSON + manifest 加载与回退、选关逐关解锁、准备阶段 / 放置 / 库存恢复 / 波次 / 胜负、大号库存面板与 HUD。
- **0.6.0 开发者关卡编辑器**：选关页新建 / 编辑 / 复制 / 删除，表单覆盖人类与波次，dev-only 保存 / 删除中间件与热刷新。
- **0.6.0 胖子精灵重绘**：圆润体型、工装遮不住肚子，倒地帧同步更新。
- **0.5.1 工坊 dev 保存 / 删除**：loopback 限制、schema 二次校验、名称唯一、备份、原子写入、manifest 登记与引用保护。
- **0.5.1 地图名称与多区域**：名称 1–24 字全局唯一，人类区 / 僵尸区支持多块矩形。
- **0.5.1 breach 追击**：按体型连通区域图 + 区域邻接图选择破门窗路径，`direct` 模式保留。
- **0.5.0 地图工坊**：地图 JSON 化、任意户型守岗与出怪、工坊编辑器本体、训练场选图、开发者模式入口。
- **0.4.x 战斗与表现**：人类真实血量与撕咬扣血、受击减速、电击枪链式 hitscan、头顶血条与受击闪白。
- **0.3.0 存档与参数面板**：设置覆盖值、localStorage / 本地目录 / 导入导出三层兜底、音量与静音。
