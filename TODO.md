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
- 说明：补充更多内置关卡与难度曲线，验证不同地图 / 波次组合；为未来新模式登记关卡引用，避免被删除。
- 涉及：`public/levels/`、`src/data/levels/`、`src/levels.ts`、`src/main.ts`、README/CHANGELOG。

### 中优先级

#### 桌面版打包（Electron）

- 状态：后续做，不进当前版本（0.7.1）。
- 范围：只做「打完包能玩」，不包含地图工坊保存。
- 要点：
  - 加 `electron` / `electron-builder` 两个 dev 依赖；主进程在 `127.0.0.1` 起临时静态服务指向 `dist`，再 `loadURL`——不能用 `file://`，否则 `fetch` 读取 `/maps/*.json`、`/levels/*.json` 会失败。
  - 游戏代码不改；开发者模式入口与 dev 保存接口在生产构建里本就剥离，桌面版保持不可用。
  - 打包产物 macOS 约 150–250 MB；未签名首次启动会被 Gatekeeper 拦截，正式分发需签名公证。
  - 优先级建议：低到中，排在草丛 / 水池之后。
- 涉及：`package.json`、Electron 主进程与打包配置、`README.md`（构建说明）、`CHANGELOG.md`。

### 低优先级

#### AI 生成音效

- 状态：待办
- 说明：引入 AI 音效生成路线（ElevenLabs 托管 MCP 或本地 Stable Audio），替换当前合成音色，优先僵尸吼叫与枪械；保留现有 CC0 素材作为降级。
- 涉及：`public/audio/`、`src/audio/events.ts`、`manager.ts`、`CREDITS.md`。

#### 音效随机变体

- 状态：待办
- 说明：同一事件支持音高 / 时长随机变化，避免重复音过于机械；仍受全局限频约束。
- 涉及：`src/audio/events.ts`、`manager.ts`。

### 待评估

#### 桌面版用户地图目录

- 状态：待评估，不展开设计。
- 说明：为单位地图工坊在桌面版里建图保存所需，目标目录为 `app.getPath('userData')/maps`；涉及主进程 IPC、加载优先级、用户地图与内置地图的分组与删除保护。
- 涉及：Electron 主进程、`src/data/maps/` 加载顺序、工坊地图列表分组与引用保护。

## 已完成

- **0.7.1 电击枪电弧视觉优化**：每跳改为 8–12 段高频低振幅抖动曲线、线宽 / 亮度逐跳递减，新增命中光环与起止闪点，单体加成只对被击中的僵尸叠加强白闪、电火花与轻微尺寸脉冲；数值与链式规则未动。
- **0.7.0 尸潮求生**：单角色 Roguelike 生存（`#/survival`）、空旷地地图、WASD 移动与镜头跟随、自动索敌开火、经验吸附与三选一升级、时间 / 等级双难度曲线、HUD 与失败结算、最佳记录持久化。
- **0.6.0 放置模式关卡制**：关卡 JSON + manifest 加载与回退、选关逐关解锁、准备阶段 / 放置 / 库存恢复 / 波次 / 胜负、大号库存面板与 HUD。
- **0.6.0 开发者关卡编辑器**：选关页新建 / 编辑 / 复制 / 删除，表单覆盖人类与波次，dev-only 保存 / 删除中间件与热刷新。
- **0.6.0 胖子精灵重绘**：圆润体型、工装遮不住肚子，倒地帧同步更新。
- **0.5.1 工坊 dev 保存 / 删除**：loopback 限制、schema 二次校验、名称唯一、备份、原子写入、manifest 登记与引用保护。
- **0.5.1 地图名称与多区域**：名称 1–24 字全局唯一，人类区 / 僵尸区支持多块矩形。
- **0.5.1 breach 追击**：按体型连通区域图 + 区域邻接图选择破门窗路径，`direct` 模式保留。
- **0.5.0 地图工坊**：地图 JSON 化、任意户型守岗与出怪、工坊编辑器本体、训练场选图、开发者模式入口。
- **0.4.x 战斗与表现**：人类真实血量与撕咬扣血、受击减速、电击枪链式 hitscan、头顶血条与受击闪白。
- **0.3.0 存档与参数面板**：设置覆盖值、localStorage / 本地目录 / 导入导出三层兜底、音量与静音。
