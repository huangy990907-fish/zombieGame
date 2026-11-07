# AGENTS.md —— 项目索引（给后续接手的大模型）

> 先读本文件，再按「改 X 去哪」直接打开对应文件，不需要递归扫描全仓库。

## 一句话定位

浏览器 2D 关卡制自动对抗小游戏：玩家在关卡里的人类区放置不同武器的人类（各自有库存与恢复），抵御从门/窗涌入的丧尸；开发者可在选关页新建 / 编辑关卡。玩家不直接操控单位，通过放置、切行为模式与速度观察战局；另有独立训练场做单位与武器回归。技术栈 **PixiJS 8 + TypeScript 5.7 + Vite 6**，像素美术与音效全部内置于仓库，无外部 CDN / 在线美术依赖。

当前版本 **0.6.0**。路由只有 5 个：`#/menu`（主菜单）、`#/levels`（选关与关卡编辑入口，`?level=<id>` 进关）、`#/play`（对局）、`#/training`（训练场）、`#/workshop`（工坊编辑器，仅开发者模式可见，玩家模式直达会被挡回主菜单）。

## 顶层目录职责

| 目录 | 职责 | 关键约束 |
|---|---|---|
| `src/data/` | **唯一数值来源**：实体定义、地图、关卡、默认设置、滑块元数据 | 调平衡只改这里；玩家改动只存覆盖值，读取时合并 |
| `public/maps/` | **地图运行时来源**：`manifest.json` + `<id>.json` 瓦片地图（内置 `arena` / `test-yard` / `test-multi`） | 内置只读；加载失败回退 `src/data/maps/arena.ts` |
| `public/levels/` | **关卡运行时来源**：`manifest.json` + `<id>.json`（内置 `level-1` 只读） | 关卡只引用 `mapId`，不复制地图数据；加载失败回退 `src/data/levels/level-1.ts` |
| `src/core/` | 运行时状态与流程：`world.ts` 实体/空间索引/开口，`game.ts` 准备/放置/库存/波次/胜负，`storage.ts` 存档与逐关解锁，`devMode.ts` 开发者模式开关与密码校验 | `world` 只存状态和查询；行为不放这里；`devMode` 只是界面显隐，不是权限系统 |
| `src/systems/` | 行为与规则：`ai.ts` 人类/丧尸/感染/受击减速推进与追击模式分发，`collision.ts` 人类/丧尸/生成落点共用的阻挡判定，`combat.ts` 开火、命中与减速结算，`flowField.ts` BFS 寻路（支持显式多源），`regions.ts` 按体型的连通区域图与区域邻接边 | 新玩法规则优先落在这里 |
| `src/render/` | PixiJS 绘制：`renderer.ts` 场景/单位/粒子/倒地/准备区标记，`pixel.ts` 精灵与坐标换算 | 只读 World，不改数据 |
| `src/art/` | 32×32 像素精灵数据：`sprites.ts` 单体，`composites.ts` 人类+武器烘焙，`preview.ts` 预览页 | 不 import 游戏其它模块 |
| `src/audio/` | `events.ts` 事件/文件/限频，`manager.ts` 预加载与播放 | 音频文件在 `public/audio/`，必须登记授权 |
| `src/training/` | `session.ts` 独立沙盒 World 与统计，`panel.ts` 右侧 DOM 面板 | 复用正式玩法，不复制 AI/战斗逻辑 |
| `src/levelEditor/` | `page.ts` 开发者关卡编辑器弹层，`devSave.ts` / `devDelete.ts` 开发态请求封装 | 只编辑 JSON；保存 / 删除接口只在 dev；生产构建整块剥离 |
| `src/workshop/` | `doc.ts` 瓦片文档与历史快照，`editor.ts` 2D 画布，`page.ts` 整页 UI，`devSave.ts` 开发态保存请求，`storage.ts` 草稿与试玩预览 | 只编辑 JSON，不直接改运行时 World；保存接口只在 dev |
| `scripts/` | `workshop-save-plugin.ts`：地图 / 关卡「保存、删除」Vite dev 中间件（只读保护 / 名称唯一 / 备份 / manifest 登记与移除 / `/maps/*.json`、`/levels/*.json` 即时读取） | 只在 dev 注册；不进入构建产物 |
| `src/ui/` | `hud.ts` 对局顶栏读数，`inventory.ts` 准备阶段库存卡片与开始按钮 | 只做展示 |
| `src/utils/` | `math.ts` 数学工具，`spatialHash.ts` 空间哈希 | 无游戏语义 |

根目录：`index.html`（骨架与所有覆盖层）、`src/main.ts`（启动/路由/主循环/菜单事件/选关与编辑器接线）、`src/style.css`、`src/levels.ts`（关卡展示投影与地图 / 关卡引用登记）、`src/router.ts`、`vite.config.ts`（注册 dev 保存插件 + 构建期清理 `.bak`）、`sprites.html`（仅开发期预览）、`public/audio/`、`public/maps/`、`public/levels/`、`README.md`、`CHANGELOG.md`、`TODO.md`、`AGENTS.md`。

## 改 X 去哪几个文件

| 需求 | 必改文件 | 通常还需要 |
|---|---|---|
| 新增僵尸 | `src/data/zombies/<id>.ts`（含 `damage`、可选 `pursuit`）、`src/data/zombies/index.ts`（注册 + `ZOMBIE_IDS`） | `src/art/sprites.ts`（精灵与倒地帧）、`src/render/pixel.ts`（缺图兜底/死亡精灵 id）、`src/audio/events.ts` + `public/audio/*` + `CREDITS.md`（专属叫声）、README/CHANGELOG |
| 改人类血量 / 撕咬伤害 | `src/systems/ai.ts`（咬人扣血→归零才 turning）、`src/core/world.ts`（`Human.hp/hurtTimer`、`Zombie.damage`）、`src/data/zombies/*.ts`（`damage`） | `src/render/renderer.ts`（头顶血条）、`src/data/settings/runtime.ts`（`damage` 覆盖值）、训练场编辑器/统计 |
| 改受击减速 | `src/systems/combat.ts`（`applyHitSlow`）、`src/systems/ai.ts`（推进/应用到移速）、`src/data/zombies/index.ts`（`ZOMBIE_SLOW`） | `src/core/world.ts`（`slowMul/slowTimer/flash`）、`src/render/renderer.ts`（受击闪白） |
| 新增武器 | `src/data/weapons/<id>.ts`、`src/data/weapons/index.ts`（注册 + `WEAPON_IDS` / `WEAPON_LIST`） | `src/art/sprites.ts` / `src/art/composites.ts`（人类武器外观与枪口）、`src/data/levels/schema.ts`（`LEVEL_WEAPON_ORDER`）、`src/data/settings/sliders.ts`（如要单独滑块）、训练场自动出现；电击枪类链式武器还要改 `src/systems/combat.ts`（独立 hitscan/链式，不复用 Bullet）与 `src/render/renderer.ts`（`renderArcs` 折线特效） |
| 新增地图 | `public/maps/<id>.json` + `public/maps/manifest.json`（瓦片 74×45 / 16px）、`src/data/maps/index.ts`（注册与加载） | `src/data/maps/schema.ts`（校验）、`src/data/maps/compile.ts`（编译）、`src/data/maps/arena.ts`（TS 兜底）、`src/levels.ts`（`LevelDef.mapId` 引用）、`src/render/renderer.ts`（`setMap()` 重建静态层） |
| 新增音效 | `public/audio/<name>.mp3`、`src/audio/events.ts`（`SFX` + `SFX_MAP` + `SFX_THROTTLE` 三处） | `public/audio/CREDITS.md`、调用点（`src/systems/ai.ts` / `src/systems/combat.ts` / `src/core/game.ts` / `src/main.ts`） |
| 改 AI 行为 | `src/systems/ai.ts`（含 `breach` / `direct` 分发） | `src/data/zombies/<id>.ts`（`pursuit`）、`src/data/types.ts`（`ZombiePursuitMode`）、`src/systems/regions.ts`（连通区域图）、`src/systems/flowField.ts`（寻路规则）、`src/core/world.ts`（区域 / 流场缓存与 `invalidateNavigation`）、`src/data/zombies/index.ts`（`WANDER_TUNING`）、`src/data/settings/runtime.ts` + `sliders.ts`（可调参数） |
| 改移动 / 碰撞判定 | `src/systems/collision.ts`（`isBlockedForBody` / `findFreePoint`） | `src/core/world.ts`（`solidAt` / `findFreeSpot`）、`src/systems/ai.ts`（人类逐轴移动）、`src/core/game.ts`（随机出生落点）、`src/training/session.ts`（点选生成）、`src/data/humans.ts`（`HUMAN_BODY_DIAMETER`） |
| 改渲染 / 外观 | `src/render/renderer.ts`、`src/render/pixel.ts` | `src/art/sprites.ts`（像素数据）、`sprites.html` 预览 |
| 改训练场 | `src/training/session.ts`、`src/training/panel.ts`、`index.html`（面板 DOM）、`src/style.css` | `src/audio/events.ts`（如新增操作音） |
| 改工坊编辑器 | `src/workshop/doc.ts`（瓦片/区域/实施例）、`src/workshop/editor.ts`（画布与输入）、`src/workshop/page.ts`（整页 UI 与校验/存读档）、`src/workshop/storage.ts`（草稿与试玩预览） | `src/data/maps/schema.ts`（校验规则）、`index.html` + `src/style.css`（覆盖层 DOM 与样式）、`src/router.ts` + `src/main.ts`（路由、`?map=workshop-draft` 注册、开发者模式守卫） |
| 工坊「保存到项目 / 删除地图」 | `scripts/workshop-save-plugin.ts`（dev 中间件：校验/名称唯一/备份/manifest 登记与移除/即时读取）、`src/workshop/devSave.ts` / `src/workshop/devDelete.ts`（请求封装）、`src/workshop/page.ts`（dev-only 按钮与流程）、`src/levels.ts`（`getMapReferences()` 引用保护与未来模式登记点） | `vite.config.ts`（注册插件）、`.gitignore`（`.bak/` 与 `*.tmp`）、`src/workshop/storage.ts`（`resetWorkshopCatalog`）、`src/main.ts` + `src/training/panel.ts`（热刷新下拉 / 删除当前训练图回退 `arena`） |
| 改地图名称 / id | `src/workshop/doc.ts`（`generateWorkshopId`、名称回退）、`src/workshop/page.ts`（只填名称、客户端唯一性预校验）、`scripts/workshop-save-plugin.ts`（服务端名称二次校验）、`src/workshop/storage.ts`（目录显示名 / `hasName`） | `src/data/maps/schema.ts`（name 1–24 字校验）、`src/data/maps/compile.ts`（无 name 回退 id）、`src/training/panel.ts`（下拉显示名称） |
| 改设置面板 | `src/data/settings/sliders.ts`、`src/data/settings/defaults.ts`、`src/data/settings/runtime.ts` | `src/main.ts`（渲染/读写滑块）、`index.html` + `src/style.css`（面板与主菜单设置弹窗）、`src/core/devMode.ts`（开发者模式区块） |
| 新增 / 改关卡数据 | `public/levels/<id>.json` + `public/levels/manifest.json`、`src/data/levels/schema.ts`（结构与校验）、`src/data/levels/index.ts`（加载 / 回退 / 注册表） | `src/data/levels/level-1.ts`（TS 兜底）、`src/levels.ts`（展示投影与引用登记）、`src/main.ts`（启动 `loadLevels()`）、README/CHANGELOG |
| 改选关 / 解锁 | `src/main.ts`（`refreshLevelsPage` / `isLevelUnlocked` / `#/play?level=`）、`src/core/storage.ts`（`recordBeaten` / `loadProgress`） | `src/data/levels/index.ts`（顺序与只读集合）、`src/router.ts`（查询串）、`index.html` + `src/style.css`（列表与锁定态） |
| 改放置 / 库存 / 胜负 | `src/core/game.ts`（`PlacementResult` / `placeHuman` / `beginBattle` / `regenInventory` / 胜负判定）、`src/ui/inventory.ts`、`src/render/renderer.ts`（`setPlacementZones`） | `src/core/world.ts`（`spawnHuman` 血量覆盖、`solidAt` / `findFreeSpot`）、`index.html` + `src/style.css`（库存面板）、`src/ui/hud.ts`（波次 / 人数读数） |
| 改关卡编辑器 | `src/levelEditor/page.ts`（表单 / 波次 / 校验 / 保存删除流程）、`scripts/workshop-save-plugin.ts`（`/__levels/save` / `/__levels/delete` 与 `/levels/*.json` 静态服务） | `src/levelEditor/devSave.ts` / `devDelete.ts`（请求封装）、`src/data/levels/schema.ts`（`LevelValidationContext`）、`src/levels.ts`（`getLevelReferences`）、`src/main.ts`（列表按钮与热刷新）、`src/style.css`（`.le-*`）、`vite.config.ts`（build 清理 `.bak`） |
| 改主菜单 / 路由 | `index.html`、`src/main.ts`、`src/style.css` | `src/router.ts`、`src/levels.ts`、`src/core/devMode.ts`（工坊入口显隐与 `#/workshop` 守卫） |

## 新增实体「三件套」流程（缺一项视为未完成）

1. **数据注册**：新建定义文件并在注册表登记。数值只写定义文件，不在设置里重复；僵尸必须写 `damage`（每次撕咬对人类的伤害）。训练场按钮、统计行、HUD 会自动跟随注册表。
2. **精灵与动画帧**：`src/art/sprites.ts` 增加 `SpriteDef`（32 行 × 32 字符，`.` 透明）；僵尸 id 为 `zombie-<kind>`，倒地帧用 `zombie-<kind>-death`；同步 `sprites.html` 预览（1× / 游戏内尺寸 / 8×）。
3. **音效与 events**：文件放 `public/audio/`，`src/audio/events.ts` 登记事件、映射、限频；无新素材时优先从现有 CC0 派生，避免新增授权。
4. **授权台账**：`public/audio/CREDITS.md` 记录来源、许可证、作者与处理方式；派生物注明原文件。
5. **文档**：`README.md` 更新目录树、实体清单、玩法/限制；`CHANGELOG.md` 在 `[Unreleased]` 写「新增/变更/修复」。
6. **训练场验收**：单位库出现按钮、可生成、可选中、统计行有数值；再跑 `npx tsc --noEmit`、`npm run build`，实跑 `#/play`、`#/training` 无 console error。

## 强制约定

- **每次版本变更必须同步**：`README.md` 顶部版本号与相关玩法/目录/限制，`CHANGELOG.md` 新建/更新版本段。版本号以 `package.json` 为唯一来源。
- **发版**：同步升 `package.json` 与 `package-lock.json`，把 `[Unreleased]` 清空并写入新版本段，打 **annotated tag** `vX.Y.Z`。
- **git push 由用户手动执行**。助手只做本地提交，并在交付信息里给出可复制的推送命令（如 `git push origin main` 与 `git push origin vX.Y.Z`）；不要自行 push、不要自行打远程 tag。
- 提交信息用约定前缀：`feat:` / `fix:` / `docs:` / `perf:` / `refactor:` / `chore:`。
- **截图策略**：交付截图只做临时展示，验证图只放 `/tmp`，仓库**不保留** `screenshots/` 目录；不要提交任何冒烟 / 验证截图。
- 不要引入新运行时依赖；UI 用原生 DOM + CSS，与现有深色紫色调保持一致。
- 数值与几何避免写死魔法常量：查询半径、分离距离、开口通行等尽量从 `src/data` 的定义/半径推导。

## 常用命令与验证要点

```bash
npm install
npm run dev       # 开发服务器（默认 5173，可 --port 指定）
npm run build     # tsc --noEmit + vite build，产物 dist/
npm run preview   # 预览构建产物
npx tsc --noEmit  # 单项类型检查
```

- **必须走 HTTP 服务**：不能双击 `index.html`，`file://` 下模块与资源会加载失败。
- 启动后控制台应出现 `[audio] 预加载完成`；若某 mp3 缺失会静默降级，不抛错。地图正常路径应出现 `[maps] 已加载「arena」1184×720` 与 `[maps] 内置地图就绪 1/1`；关卡正常路径应出现 `[levels] 关卡就绪 N 个（清单 N 项）`。出现 `[maps] ... 回退 TS 定义` 或 `[levels] ... 使用 TS 兜底关卡` 说明 JSON / 校验失败，选关页顶部会有 `.map-notice` 提示。
- **训练场是主要回归入口**：可自由生成僵尸/人类、破门窗、调速度、逐帧单步，验证 AI、命中、感染、倒地与窗洞通行。
- `#/play` 冒烟：主菜单「放置抵抗」→ `#/levels` → 点已解锁关 → 准备阶段可见人类区 / 僵尸区与库存面板 → 放置人类 → 开始 → 波次推进 → 无 console error。未放置人类点「开始」应只提示、不判负。
- 开发者模式验收：玩家模式 `#/menu` 无「地图工坊」按钮；设置里输入 `VITE_DEV_PASSWORD`（默认 `zb9993`）后入口出现并可进 `#/workshop`；退出后入口消失、直达 `#/workshop` 被挡回主菜单。开发者模式下 `#/levels` 全解锁并出现「新建 / 编辑 / 复制 / 删除」，内置教学关只能「复制」。密码放 `.env.local`，不要提交。
- 关卡编辑器验收：新建关 → 填名称 → 保存 → 列表热刷新出现新关；重名被拦截；删除后 manifest 与列表恢复；`npm run build` 后 `dist` 搜不到 `__levels/save` / `__levels/delete` / `保存到项目（dev）` / `删除关卡`，`npm run preview` 下接口 404。
- 像素外观改动先看 `sprites.html`；单位尺寸由 `src/render/pixel.ts` 的 `VISUAL_SCALE = 1.5` 与 `Zombie.bodyDiameter`（= 2 × 碰撞半径）决定。
- 0.4.2 规则：**开口净宽 < 单位身体直径即不可通行**（门 80、窗 16；普通 11 / 狂奔 9 / 胖子 22）。通行判定口径 = 可见体宽 = 2 × 碰撞半径；渲染盒宽 = 2r × `VISUAL_SCALE`（普通 16.5 / 狂奔 13.5 / 胖子 33），1.5 只补精灵透明留白，不要叠加到半径上。胖子只能走门，流场与移动碰撞都按该通用规则过滤，不是写死特例。
- 0.4.3 规则：**人类血量是真实生命值**（`HUMAN_DEF.hp = 100`，可被设置/训练场覆盖），丧尸每次撕咬按 `Zombie.damage` 扣血，`hp <= 0` 才设置 `turning`；turning 期间 `alive` 仍为 true（`livingHumans` 口径不变）。训练场 `invincible` 完全免疫掉血与异变。
- 0.4.3 规则：**受击减速**由 `combat.ts` 的 `applyHitSlow` 写入 `slowMul/slowTimer`，`ai.ts` 每帧线性恢复并乘到 hunt/wander 移速；每点伤害 4%、最低 40%，0.6 秒恢复，不叠加只取最强并刷新计时；大体型（`bodyDiameter >= 20`）幅度减半、最低 70%；喷火每秒最多结算一次。受击反馈是 `flash > 0` 时渲染层加法混合提亮 0.08 秒。
- 0.4.3 规则：**电击枪** `tesla` 是独立 hitscan（射线投影 + 目标半径 + 墙体/完好门窗视线），不复用 Bullet 扫掠；首个目标 96px 内无其他僵尸时 ×2.2，否则向最近可见僵尸逐只跳跃，最多 5 只（含首个），每跳衰减到 75%。参数集中在 `src/data/weapons/tesla.ts` 的 `tesla` 字段。闪电是 `EffectKind = "arc"` 的折线（`Effect.points`），每跳一段，渲染在 `renderer.ts` 的 `renderArcs()`；训练场链式读数走 `World.onTeslaVolley` 钩子，独立于 DPS 表。
- 0.5.0 规则（阶段 0）：地图运行时来源是 `public/maps/manifest.json` + `<id>.json`；`main.ts` 先 `await loadBuiltinMaps()` 再构造任何依赖地图的实例。瓦片固定 `74×45` / `16px`，加载时 `compileTilesToMapDef()` 编译回 `walls[] + openings[]`，World / 流场 / 渲染结构不变。每扇门窗有独立 `id`，玩家覆盖仍按门 / 窗种类生效。加载失败或校验不通过时回退 `src/data/maps/arena.ts`（0.4.3 的 `1180 × 720` / 窗宽 18），正常路径为 `1184 × 720` / 窗宽 16。
- 0.5.0 规则（阶段 1B）：`assignPosts()` 不依赖开口下标与方位，门岗按门洞长度分名额、窗岗按窗净宽推导、预备队按开局人数 20%，坐标由开口中心与房间几何推导；出怪只从多块 `spawn` / 可选 `windowSpawn.top/bottom` 按面积加权。`World` 按每扇门窗自身 JSON 的 `maxHp/passSpeed` 初始化，`setActiveMap()` 让 `settings()` / `openingTuning()` 跟随当前地图；玩家覆盖仍按门 / 窗种类优先。内置新增 `test-multi`（2 门 3 窗）。
- 0.5.0 规则（阶段 1A）：`Game` / `TrainingSession` 构造与 `TrainingSession.reset()` 接受 `MapDef | id`，`Game.start()` 优先级为「显式选择 > `LevelDef.mapId` > 当前地图」；`resolveMap()` 对不存在的 id 输出 warning 并回退 `DEFAULT_MAP`，`main.ts` 用 `.map-notice` 做可见提示。换图时 `createWorld(map)` 重建 World / 流场 / 空间索引，`Renderer.setMap()` 清空并重画地板、墙体、训练场装饰与门窗层。临时选图入口为 `?map=<id>`；内置只读地图为 `arena`、`test-yard` 与 `test-multi`。
- 0.5.0 规则（阶段 2）：工坊编辑器只在 `#/workshop` 打开，整页 DOM 覆盖层；入口由阶段 4 的开发者模式控制（玩家模式不显示）。文档用 `Uint8Array` 存瓦片，历史快照是 `serializeDoc()` 的 JSON 字符串；门窗拖拽宽度按格（16px 整数倍），默认值可逐扇改。校验共用 `validateMapJson()`，新增「门窗两侧可通行」规则；带坐标错误可点击跳格。草稿存 localStorage（`zombieGame.workshop.draft.v1`），导出 JSON 可直接进 `public/maps`；内置图只读，必须「另存为副本」。试玩把草稿存 `zombieGame.workshop.preview.v1`，`main.ts` 在 `loadBuiltinMaps()` 后用 `compileTilesToMapDef()` 编译并 `registerRuntimeMap()` 注册为 `workshop-draft`，再进 `?map=workshop-draft#/training`，不落盘。
- 0.5.0 规则（阶段 3）：训练场面板顶部「地图」下拉是唯一玩家可见的选图入口，选项由 `MAP_LIST` + `BUILTIN_MAP_IDS` 分为「内置地图」与「工坊地图」两组（当前图未注册时补一组，显示名与 id 转义）。`TrainingPanel` 新增第三参 `onMapChange`，`main.ts` 的 `switchTrainingMap()` 负责 `training.reset(id)` + `reportMapFallback()` + `renderer.setMap()`；`reset()` 会重建 World / 流场 / 空间索引并清空单位、选中、armed、tool、计时与全部读数，**换图不共用会话**（房间与人类区几何按图不同，跨图保留单位可能落墙里，读数也会混算）。`#/play` 不使用该下拉，仍按 `Game.start()` 优先级（显式选择 > `LevelDef.mapId` > 当前地图）绑定；`level-1` 的 `mapId` 仍是 `arena`，选关节点 / 详情 / 开始按钮显示地图名。
- 0.5.0 规则（阶段 4）：开发者模式是**纯界面开关，不是安全边界**。`src/core/devMode.ts` 用 localStorage key `zombieGame.devMode.v1` 持久化；密码优先读 `.env.local` 的 `VITE_DEV_PASSWORD`（该文件被 git 忽略），缺失/为空时回退 `zb9993`，明文比较。主菜单 `#btnWorkshop` 默认 `hidden`，只由 `main.ts` 的 `syncDevModeUI()` 按状态切换；`applyRoute("workshop")` 在未开启开发者模式时用 `.map-notice` 提示并 `router.go("menu")`，退出开发者模式时若仍在工坊页也会自动回主菜单。玩家模式完全看不到工坊入口，但玩家改 localStorage 或直接构造 URL 仍可绕过。
- 0.5.1 规则：工坊「保存到项目」**只在开发态**。`vite.config.ts` 注册 `scripts/workshop-save-plugin.ts`（`apply: "serve"`），只在 `configureServer` 挂 `POST /__workshop/save`；默认只接受 loopback（`127.0.0.1` / `::1` / `::ffff:127.0.0.1`），非本机 403，远程开发需显式设 `VITE_WORKSHOP_ALLOW_REMOTE=1`。
- 0.5.1 规则：服务端二次校验顺序 = JSON body → id 白名单（`^[a-z0-9][a-z0-9_-]{0,31}$`、保留 id `workshop-draft`）→ `map.id` 与请求 id 一致 → `validateMapJson()` + `schemaVersion === MAP_SCHEMA_VERSION` → manifest 读取与结构 → **名称全局唯一（trim、区分大小写，遍历 manifest 下所有地图 JSON 的 `name`，排除自身 id；冲突 409 `name_taken`）** → 内置只读图 403（`entry.readOnly !== false`）→ 重名未确认 409 → 备份 → 原子写入 → manifest 登记。覆盖前备份到 `public/maps/.bak/<id>-<时间戳>.json`，每个 id 只留最近 5 份；`.bak/` 与 `*.tmp` 已进 `.gitignore`。写入失败用备份回滚（无备份则删新文件），进程内串行队列避免并发互相覆盖；manifest 已有条目只更新 `file` / `readOnly:false`，不追加重复项。
- 0.5.1 规则：工坊编辑器按钮是**空占位 HTML** `<button id="wsSaveProject" hidden disabled>` / `<button id="wsDeleteMap" hidden disabled>`，只在 `import.meta.env.DEV` 下动态 `import("./devSave")` / `import("./devDelete")` 后设置文案 / 显示 / 绑定；生产构建不加载这两个模块，`dist` 里不应出现 `__workshop/save`、`__workshop/delete`、「保存到项目」与「删除当前地图」。
- 0.5.1 规则：保存成功后 `resetWorkshopCatalog()` 清 manifest / 地图 JSON 缓存 → 工坊内置图下拉重载 → `main.ts` 回调 `await loadBuiltinMaps()` 后 `trainingPanel.reloadMaps(savedId)`；不整页 reload。若 `savedId` 正是当前训练图，面板提示「切到其它地图再切回」（World 不会因保存自动重建）。
- 0.5.1 规则：工坊地图删除只在开发态。`scripts/workshop-save-plugin.ts` 额外挂 `POST /__workshop/delete`（同样 loopback 限制、同一串行队列）：id 白名单 → 未知 id 404 → `entry.readOnly !== false` 403 → `getMapReferences()` 命中 409（当前 `level-1` → `arena`，未来放置 / 闯关模式通过 `registerMapReference()` 登记）→ 备份到 `.bak/`（与保存共用每 id 最近 5 份）→ 移除 manifest 条目（2 空格缩进 + 末尾换行）→ 删除文件；写 manifest 失败会回滚。`src/workshop/devDelete.ts` 只在 DEV 动态加载，按钮在 `#wsBuiltinSelect` 旁；客户端也会用同一 `getMapReferences()` 禁用删除并显示原因。
- 0.5.1 规则：删除成功后 `resetWorkshopCatalog()` + `loadBuiltinCatalog()` 重载工坊下拉，`main.ts` 的 `onDeleted` 重新 `await loadBuiltinMaps()`（会把已删 id 从 `MAPS` / `BUILTIN_MAP_IDS` / `READONLY_MAP_IDS` 移除）并刷新训练场下拉；若删的是当前训练图，立即 `switchTrainingMap("arena")` 重建 World / 流场 / 静态层，不整页 reload。
- 0.5.1 规则：地图**名称**（`name`）去首尾空格后 1–24 字，全局唯一且区分大小写；id 由系统生成（`ws-<时间戳>-<4位随机十六进制>`），冲突自动换一个，用户不填写。客户端用已加载目录预校验（`validationErrors()`），服务端再读 manifest 下所有 JSON 二次校验；删除后名称释放可复用。旧 JSON 没有 `name` 时显示 id，不阻断加载。
- 0.5.1 规则：人类活动区 `humanZone` 与僵尸区 `spawn` 都支持**多块矩形**（JSON 数组；读取兼容旧版单个对象，保存统一写数组，`schemaVersion` 仍为 1）。语义按并集：僵尸区沿用面积加权出怪；人类活动区只决定出生点（按面积加权落在并集内），不限制后续活动范围，移动夹取仍用 `humanBounds`（由 `room` 内缩推导）。工坊用人类 / 僵尸画笔新增矩形，点选已有矩形后拖动可调整位置，选中后 `Delete` / `Backspace` 删除；画布与区域列表选中联动。
- 0.5.1 规则（dev 静态服务缺口）：Vite 只在启动时把已有 public 文件收进 `publicFiles`，之后新建的 `public/maps/*.json` 会被内部静态中间件跳过并落到 SPA fallback（返回 index.html）。插件在 `configureServer` 里**前置**一个只读中间件，直接从磁盘返回 `/maps/*.json`（`Content-Type: application/json; charset=utf-8`、`Cache-Control: no-cache`），这是「保存后立刻可读 / 热刷新」的前提；该中间件同样只在 dev 存在。
- 0.5.1 规则：丧尸追击按类型模式分发。`ZombieDef.pursuit` 取 `breach`（默认）或 `direct`（旧行为）；普通 / 狂奔 / 胖子都在定义文件显式写 `breach`。新增模式先扩 `src/data/types.ts` 的 `ZombiePursuitMode`，再到 `systems/ai.ts` 的 `pursuitModeOf()` / `retargetZombie()` / 移动分支处加分支，不改默认实现。
- 0.5.1 规则：`systems/regions.ts` 的 `RegionMap` 按体型构建连通域：完好门窗为边界，破损开口仅当净宽 ≥ 身体直径才连通；`regionAt()` O(1)，`regionNear()` 处理压墙沿，边只连“完好且体型能过”的开口。探边只查开口外侧相邻一格，避免穿过一层墙生成假边。
- 0.5.1 规则：breach 决策。同区有活人 → 沿 `World.humanFlowFor(bodyDiameter)`（活人为源、0.6s 刷新）绕墙直追，不主动破门窗；本区无活人 → 在区域邻接图上 Dijkstra（边权 = 走到开口距离 + `ceil(maxHp / buildBiteDamage) * bite * 该僵尸移速`），在所有有活人的可达区域里取总代价最小者，回溯取第一扇开口并沿 `World.openingFlow(id, bodyDiameter)` 走过去啃；无解（只剩不可破坏墙或体型过不去的窗）→ `stranded` 漫游，不贴墙顶门。全图零活人仍走原有漫游。
- 0.5.1 规则：人类与丧尸共用 `systems/collision.ts` 的 `isBlockedForBody()`。墙体与地图边界永远阻挡，完好门窗一律阻挡，已破坏开口只有净宽 ≥ 身体直径才放行；人类身体直径 = `HUMAN_DEF.radius * 2 = 12`。阻挡矩形按**碰撞半径**（`bodyDiameter / 2`，即 `Zombie.radius` / `HUMAN_DEF.radius`）外扩，单位停在身体外缘贴墙；外扩只作用于实体阻挡，**不改变开口通行口径**（净宽仍与身体直径比较），所以普通丧尸仍能过 16px 破窗、胖子仍被挡。丧尸位置的地图边界夹取也按 `z.radius`。人类移动逐轴判定（撞墙只停该轴、保留沿墙滑动），`stuck` 恢复检测用 `solidAt(x, y, 0, 0)` 纯点判定，避免贴墙单位被半径判定误判为卡住而绕过碰撞；巡逻目标点、随机出生落点与训练场点选生成统一走 `World.findFreeSpot()` / `World.solidAt()`；训练场点击墙内或钻不过的开口不生成单位。新增水域等地形时只在 `collision.ts` 登记阻挡矩形。
- 0.5.1 口径：`VISUAL_SCALE = 1.5` 只放大精灵绘制盒，**不是碰撞半径**；阻挡外扩用 `bodyDiameter / 2`。实测不透明外廓人类约 12.4、普通约 11.3、胖子约 24.8，与碰撞直径 12 / 11 / 22 基本一致，剩余差异 ≤ 1.4px。不要为了「看上去更贴墙」再把碰撞半径调大，否则 16px 窗的通行带（普通只剩约 5px）会被挤到不可通过。武器枪管等装饰不参与碰撞。
- 0.5.1 规则：`humanBounds` 只负责把人类夹在房间内，**不再替代墙体碰撞**。不能只靠夹取，否则含内部墙体的自定义地图（如 `my-map`）里人类会横穿内墙与门窗。

- 0.6.0 规则（关卡数据）：`public/levels/manifest.json` + `<id>.json` 是关卡运行时来源，结构与地图 manifest 同构；关卡只存 `id` / `name` / `mapId` / `mode: "placement"` / `humans` / `waves`（可选 `settings` 兼容块），不复制地图数据。`src/data/levels/schema.ts` 的 `validateLevelJson(raw, ctx)` 同时服务浏览器与 dev 服务端（`LevelValidationContext` 可注入地图 / 武器 / 僵尸 id 集合）。加载失败或校验不通过回退 `src/data/levels/level-1.ts`，`main.ts` 先 `await loadLevels()` 再 `refreshLevelDefs()`。
- 0.6.0 规则（人类 = 武器）：人类种类就是武器种类（`mg` / `flame` / `shotgun` / `rocket` / `tesla`），没有手枪；`humans` 每项含 `enabled` / `hp` / `initial` / `cap` / `regen`，同武器全局一档血量。`LEVEL_WEAPON_ORDER` 是编辑器与默认配置的展示顺序；新增武器要同步它。
- 0.6.0 规则（选关与解锁）：主菜单「放置抵抗」→ `#/levels`；列表按 `LEVEL_LIST` 顺序展示。玩家模式解锁条件 = 首关，或 `progress.beaten` 包含上一关 / 旧 `unlocked`；开发者模式全开且出现「新建 / 编辑 / 复制 / 删除」。进度 key 仍为 `zombieGame.progress.v1`，`recordBeaten(levelId, LEVELS.map(l => l.id))` 会按清单解锁下一关；旧存档的 `level-1` 通关记录自然沿用。`#/play?level=<id>` 未知 id 回退 `#/levels` 并提示。
- 0.6.0 规则（局内流程）：`Phase = "prepare" | "wave" | "intermission" | "victory" | "defeat"`；准备阶段渲染人类区 / 僵尸区并显示库存面板，`beginBattle()` 未放置人类返回 false。`placeHuman()` 先判 `humanZone` 再判 `world.solidAt(x, y, 0, HUMAN_BODY_DIAMETER)`，失败不扣库存；成功后 `attachPost()` 以落点即守岗点、朝向最近开口。库存每种独立计时、满仓停表，`tick` 在准备阶段也跑 AI 与恢复，暂停不跑。
- 0.6.0 规则（胜负）：胜利 = `wave >= waveCount && spawnLeft === 0 && zombies === 0`；失败 = `placedAny && humans.length === 0`（turning 仍算存在）。未放置过人类不判负，只提示「至少放置一名人类」。波次内容来自关卡 `waves`，`beginWave(n)` 把 `wave.zombies` 展开进 `waveQueue`，`spawnOne()` 按队列取 kind；生成速率与同屏上限仍读 `settings().wave` 并受关卡 `settings` 覆盖。
- 0.6.0 规则（快捷键）：play 路由 `1–5` 选择人类种类，`Space` 暂停、`R` 重开；速度只通过顶栏按钮循环（1x/2x/4x/8x），不再用数字键切速度。
- 0.6.0 规则（关卡编辑器）：`src/levelEditor/page.ts` 是整页弹层，`main.ts` 只在 `import.meta.env.DEV` 动态导入并实例化（生产构建不包含编辑器代码 / 接口路径 / 保存删除文案）。列表按钮 → `levelEditor.open("new"|"edit"|"copy", id)`；只读关只给「复制」。保存 / 删除后 `resetLevelCatalog() → loadLevels() → refreshLevelDefs() → refreshLevelsPage()` 热刷新，不整页 reload。
- 0.6.0 规则（关卡 dev 接口）：`scripts/workshop-save-plugin.ts` 在 dev 注册 `/__levels/save` 与 `/__levels/delete`，与工坊共用 loopback 限制、串行队列、原子写入与 `.bak`（每 id 最近 5 份）；服务端校验顺序 = JSON → id 白名单 → `level.id` 一致 → `validateLevelJson`（地图 id 来自地图 manifest）→ 名称全局唯一（trim、区分大小写，冲突 409 `name_taken`）→ 只读保护 → 重名确认 → 备份 → 写入 → manifest 登记。删除额外查 `getLevelReferences()`。`.bak` 与 `*.tmp` 已进 `.gitignore`，`vite.config.ts` 的 build-only 插件会从 `dist` 删除 `.bak`。
- 0.6.0 规则（名称）：关卡 `name` 去首尾空格后 1–24 字、全局唯一且区分大小写；id 由系统生成（`lv-<时间戳>-<4位随机十六进制>`），用户不填写；删除后名称释放。
- 0.6.0 规则（局内布局）：play 路由给 `body` 加 `placement`；`.frame` 改为两列 grid（画布 `1fr` + 库存 252px），`.inv-panel` 用 `grid-area: inv`，画布按剩余宽度等比缩放，不再覆盖；`max-width: 900px` 时 `.frame` 改 flex 纵向、面板 `align-self: stretch` 底部横排。`InventoryPanel.syncStartButton()` 在非准备阶段直接 `remove()`「开始」按钮，重开回到 prepare 时重建，不靠禁用或 `hidden` 类。
- 0.6.0 规则（模式差异）：开发者专属按钮一律按 `isDevModeEnabled()` 条件渲染，玩家模式整组不渲染（不是禁用变灰）。`#/levels/edit?id=<id>` 由 router 映射到 `levels` 路由：未开开发者模式 `showMapNotice` 后 `router.go("levels")`，已开启则编辑（只读关转复制 / 未知 id 转新建）。`applyRoute` 离开 `levels` 时自动 `levelEditor.close()`，`syncDevModeUI` 关闭开发者模式时也会关闭编辑器。
- 0.6.0 规则（工坊地图列表）：左栏 `#wsMapGroups` 常驻列表，分「内置地图（只读）」与「我的地图」，项只显示名称（内置图带只读标记）。`loadMapFromCatalog()` 切图前走 `confirmDiscard()`：`dirty` 在 `handleDocChange`、名称输入与门窗参数编辑时置位，切图 / 新建 / 复制 / 显式保存后清零。新建用 `createBlankDoc()`，复制用 `cloneDoc()`（内置图也可复制），副本名 `uniqueName(原名 + " 副本")` 且参与全局唯一校验；切图同时 `resetEditorState()` 清选中项与工具。原「载入内置图」下拉已合并并移除，不要重新加回。

## 已知限制（0.6.0 现状）

- 局内布局在窗口宽度 ≤ 900px 时库存面板改为底部横排；880×720 这类更小的窗口需要纵向滚动才能看到完整面板。
- 开发者 / 玩家模式差异只是界面显隐（`isDevModeEnabled()` 读 localStorage），玩家改 localStorage 仍可绕过；生产构建另外通过动态导入剥离编辑器代码与 dev 接口。
- 工坊「未保存改动」以 `dirty` 标记为准（自上次载入 / 显式保存后是否有编辑），自动写入 localStorage 的草稿不算“已保存”；切图确认后草稿会被新图覆盖。
- 人类会真实掉血，但血量归零不会立刻死亡，而是进入原有的 2.8 秒转化倒计时；训练场可调人类血量与僵尸攻击力来观察。
- 电击枪链式最多 5 只（含首个），每跳都要求视线可见：未破的门窗会挡住后续跳跃；链式半径 / 上限 / 衰减 / 单体加成只有 `src/data/weapons/tesla.ts` 一处参数，没有全局滑块。首个目标的单体加成按“96px 内是否有其他存活僵尸”判断，不检查它们是否被墙挡住。
- 僵尸攻击力目前只有训练场按单位调整，全局滑块表未登记 `damage`；默认值在 `src/data/zombies/*.ts`。
- breach 追击的区域层级只看“门窗通不通”，破拆耗时按 `maxHp / buildBiteDamage * bite` 估算，未计入多只僵尸同时啃食加速；同区追击用流场绕墙，不处理“同区但被内部墙隔开需要绕远”的额外代价。`direct` 模式仍是旧的全局最近人类直扑。
- 无 BGM；只有一次性音效，且同一事件全局限频，**没有随机音效变体**（音高/时长变化）。
- `weapon-reload`、`human-hurt` 两个事件已声明、文件已备好，但当前没有调用点。
- 内置只有 1 个关卡（`level-1`「初次尸潮」，8 波共 1186 只）与 3 张只读地图（`arena` / `test-yard` / `test-multi`）；玩家模式选关页只显示已解锁关卡，开发者模式全关解锁并在列表提供「新建 / 编辑 / 复制 / 删除」，内置教学关只能复制。新保存的关卡会直接进入选关列表，但不会自动产生新的游玩模式入口。地图 JSON 支持固定 `74×45` / `16px` 画布、任意数量门窗（至少 1 扇门）与多块人类区 / 僵尸区。工坊与关卡编辑器入口都只在开发者模式下显示；玩家模式直达 `#/workshop` 会被挡回主菜单，`#/levels` 只显示已解锁关卡。这些只是界面显隐，不是安全边界。训练场已可选图，`#/play` 仍只跑关卡绑定地图、没有对局内选图 UI，调试仍可用 `?map=<id>`。
- 正式对局的人类补充完全依赖库存恢复，不再有「每波补 1 人」；库存恢复在准备阶段也走表，暂停时不恢复。
- 胜负目前各只有一种：胜利 = 打完全部配置波次，失败 = 已放置过人类后场上无人类；「闯关模式」及其它胜负条件只预留了引用 / 进度 key，尚未实现。
- 关卡人类种类严格等于武器种类，不能自定义新职业或给同一武器多档血量；编辑器不能改关卡 id，也不能编辑教学关的 `settings` 兼容块（需手改 JSON）。
- 关卡编辑器的保存 / 删除只在 `npm run dev` 可用（`npm run preview` / `dist` 下接口 404、按钮不存在），默认只接受 loopback；`VITE_WORKSHOP_ALLOW_REMOTE=1` 同样会把关卡写接口暴露给局域网，仅限可信网络。
- 开口参数折中：`World` 按每扇门窗自身 JSON 初始化 `maxHp/passSpeed`，但玩家设置的门 / 窗覆盖仍按种类统一生效且优先级更高；`#/play` 下 `level-1` 的 `doorHp=450 / winHp=100 / winPassSpeed=0.45` 会覆盖 `test-multi` 的逐扇默认值，逐扇差异需在 `#/training` 或无关卡覆盖的场景观察。逐扇独立覆盖 UI 属于后续阶段。
- 「闯关模式」只有主菜单入口与占位说明，**尚未实现**，不会进入空页面。
- 主菜单「清空存档」只清玩法进度（放置抵抗关卡进度 + 预留的 `zombieGame.challenge.*`），保留音量偏好与参数覆盖值。
- 工坊「保存到项目 / 删除地图」只在 `npm run dev` 可用：`npm run preview` / `dist` 没有接口和按钮；默认只接受 loopback，`npm run dev --host` 暴露给局域网后保存 / 删除会 403，除非显式设 `VITE_WORKSHOP_ALLOW_REMOTE=1`（此时任何能访问 dev server 的人都能写 / 删 `public/maps` 与 `public/levels`，仅限可信网络）。
- 工坊保存只写 `public/maps/<id>.json` 与 manifest，**不创建关卡**；关卡编辑器保存只写 `public/levels/<id>.json` 与 manifest，**不创建新的模式入口**。新地图仍只在训练场下拉与 `?map=` 可选，要进正式对局需给关卡 JSON 写 `mapId`。
- 备份只在本机 `public/maps/.bak/` 与 `public/levels/.bak/`，每个 id 留最近 5 份且被 git 忽略；`vite.config.ts` 的 build-only 插件会在构建后删除 `dist` 内的 `.bak`。保存 / 删除都不 reload 当前训练会话，覆盖或删除当前训练图时要切走再切回（删除当前训练图会自动切回 `arena` 并重建 World）。
- 没有自动化测试；`npm run build` 只保证类型与打包，行为正确性依赖浏览器实跑。
- 美术只有朝上的单套帧，运行时按朝向旋转，任意角度会有轻微锯齿；特效/场景装饰仍由 Pixi 代码绘制。
- 碰撞只按躯干圆处理：人类武器枪管、丧尸头饰等装饰不参与碰撞，贴墙时可能少量越入墙面；这是美术层表现，不影响移动与通行。
- 眼睛、倒地帧等细节以实际 `src/art/sprites.ts` 为准；改帧矩阵后务必跑一次宽度校验（每行必须 32 字符）。
