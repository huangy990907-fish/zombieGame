# AGENTS.md —— 项目索引（给后续接手的大模型）

> 先读本文件，再按「改 X 去哪」直接打开对应文件，不需要递归扫描全仓库。

## 一句话定位

浏览器 2D 自动对抗小游戏：50 名人类守在房间内，抵御从门/窗涌入的丧尸；玩家调参数、切行为、加速度观察战局，另有独立训练场做单位与武器回归。技术栈 **PixiJS 8 + TypeScript 5.7 + Vite 6**，像素美术与音效全部内置于仓库，无外部 CDN / 在线美术依赖。

当前版本 **0.5.0**。路由只有 5 个：`#/menu`（主菜单）、`#/levels`（选关，仍可从结算返回）、`#/play`（正常对局）、`#/training`（训练场）、`#/workshop`（工坊编辑器，仅开发者模式可见，玩家模式直达会被挡回主菜单）。

## 顶层目录职责

| 目录 | 职责 | 关键约束 |
|---|---|---|
| `src/data/` | **唯一数值来源**：实体定义、地图、默认设置、滑块元数据 | 调平衡只改这里；玩家改动只存覆盖值，读取时合并 |
| `public/maps/` | **地图运行时来源**：`manifest.json` + `<id>.json` 瓦片地图（内置 `arena` / `test-yard` / `test-multi`） | 内置只读；加载失败回退 `src/data/maps/arena.ts` |
| `src/core/` | 运行时状态与流程：`world.ts` 实体/空间索引/开口，`game.ts` 波次与胜负，`storage.ts` 存档，`devMode.ts` 开发者模式开关与密码校验 | `world` 只存状态和查询；行为不放这里；`devMode` 只是界面显隐，不是权限系统 |
| `src/systems/` | 行为与规则：`ai.ts` 人类/丧尸/感染/受击减速推进，`combat.ts` 开火、命中与减速结算，`flowField.ts` BFS 寻路 | 新玩法规则优先落在这里 |
| `src/render/` | PixiJS 绘制：`renderer.ts` 场景/单位/粒子/倒地，`pixel.ts` 精灵与坐标换算 | 只读 World，不改数据 |
| `src/art/` | 32×32 像素精灵数据：`sprites.ts` 单体，`composites.ts` 人类+武器烘焙，`preview.ts` 预览页 | 不 import 游戏其它模块 |
| `src/audio/` | `events.ts` 事件/文件/限频，`manager.ts` 预加载与播放 | 音频文件在 `public/audio/`，必须登记授权 |
| `src/training/` | `session.ts` 独立沙盒 World 与统计，`panel.ts` 右侧 DOM 面板 | 复用正式玩法，不复制 AI/战斗逻辑 |
| `src/workshop/` | `doc.ts` 瓦片文档与历史快照，`editor.ts` 2D 画布，`page.ts` 整页 UI，`storage.ts` 草稿与试玩预览 | 只编辑 JSON，不直接改运行时 World；不接主菜单入口 |
| `src/ui/` | `hud.ts` 对局顶栏/底栏读数 | 只做展示 |
| `src/utils/` | `math.ts` 数学工具，`spatialHash.ts` 空间哈希 | 无游戏语义 |

根目录：`index.html`（骨架与所有覆盖层）、`src/main.ts`（启动/路由/主循环/菜单事件）、`src/style.css`、`src/levels.ts`、`src/router.ts`、`sprites.html`（仅开发期预览）、`public/audio/`、`README.md`、`CHANGELOG.md`、`TODO.md`、`AGENTS.md`。

## 改 X 去哪几个文件

| 需求 | 必改文件 | 通常还需要 |
|---|---|---|
| 新增僵尸 | `src/data/zombies/<id>.ts`（含 `damage`）、`src/data/zombies/index.ts`（注册 + `ZOMBIE_IDS`） | `src/art/sprites.ts`（精灵与倒地帧）、`src/render/pixel.ts`（缺图兜底/死亡精灵 id）、`src/audio/events.ts` + `public/audio/*` + `CREDITS.md`（专属叫声）、README/CHANGELOG |
| 改人类血量 / 撕咬伤害 | `src/systems/ai.ts`（咬人扣血→归零才 turning）、`src/core/world.ts`（`Human.hp/hurtTimer`、`Zombie.damage`）、`src/data/zombies/*.ts`（`damage`） | `src/render/renderer.ts`（头顶血条）、`src/data/settings/runtime.ts`（`damage` 覆盖值）、训练场编辑器/统计 |
| 改受击减速 | `src/systems/combat.ts`（`applyHitSlow`）、`src/systems/ai.ts`（推进/应用到移速）、`src/data/zombies/index.ts`（`ZOMBIE_SLOW`） | `src/core/world.ts`（`slowMul/slowTimer/flash`）、`src/render/renderer.ts`（受击闪白） |
| 新增武器 | `src/data/weapons/<id>.ts`、`src/data/weapons/index.ts`（注册 + `LOADOUT`） | `src/art/sprites.ts` / `src/art/composites.ts`（人类武器外观与枪口）、`src/data/settings/sliders.ts`（如要单独滑块）、训练场自动出现；电击枪类链式武器还要改 `src/systems/combat.ts`（独立 hitscan/链式，不复用 Bullet）与 `src/render/renderer.ts`（`renderArcs` 折线特效） |
| 新增地图 | `public/maps/<id>.json` + `public/maps/manifest.json`（瓦片 74×45 / 16px）、`src/data/maps/index.ts`（注册与加载） | `src/data/maps/schema.ts`（校验）、`src/data/maps/compile.ts`（编译）、`src/data/maps/arena.ts`（TS 兜底）、`src/levels.ts`（`LevelDef.mapId` 引用）、`src/render/renderer.ts`（`setMap()` 重建静态层） |
| 新增音效 | `public/audio/<name>.mp3`、`src/audio/events.ts`（`SFX` + `SFX_MAP` + `SFX_THROTTLE` 三处） | `public/audio/CREDITS.md`、调用点（`src/systems/ai.ts` / `src/systems/combat.ts` / `src/core/game.ts` / `src/main.ts`） |
| 改 AI 行为 | `src/systems/ai.ts` | `src/data/zombies/index.ts`（`WANDER_TUNING`）、`src/data/settings/runtime.ts` + `sliders.ts`（可调参数）、`src/systems/flowField.ts`（寻路规则） |
| 改渲染 / 外观 | `src/render/renderer.ts`、`src/render/pixel.ts` | `src/art/sprites.ts`（像素数据）、`sprites.html` 预览 |
| 改训练场 | `src/training/session.ts`、`src/training/panel.ts`、`index.html`（面板 DOM）、`src/style.css` | `src/audio/events.ts`（如新增操作音） |
| 改工坊编辑器 | `src/workshop/doc.ts`（瓦片/区域/实施例）、`src/workshop/editor.ts`（画布与输入）、`src/workshop/page.ts`（整页 UI 与校验/存读档）、`src/workshop/storage.ts`（草稿与试玩预览） | `src/data/maps/schema.ts`（校验规则）、`index.html` + `src/style.css`（覆盖层 DOM 与样式）、`src/router.ts` + `src/main.ts`（路由、`?map=workshop-draft` 注册、开发者模式守卫） |
| 改设置面板 | `src/data/settings/sliders.ts`、`src/data/settings/defaults.ts`、`src/data/settings/runtime.ts` | `src/main.ts`（渲染/读写滑块）、`index.html` + `src/style.css`（面板与主菜单设置弹窗）、`src/core/devMode.ts`（开发者模式区块） |
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
- **截图保留策略**：`screenshots/` 只保留 6 张长期设计图 —— `fat-normal-size-compare.png`、`fat-window-pass.png`、`fat-door-pass.png`、`fat-window-pass-wide.png`、`sprites-preview.png`、`menu-settings.png`。一次性冒烟/验证图不得提交；需要新增长期图时先替换/删除旧的，保持总数 6。
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
- 启动后控制台应出现 `[audio] 预加载完成`；若某 mp3 缺失会静默降级，不抛错。地图正常路径应出现 `[maps] 已加载「arena」1184×720` 与 `[maps] 内置地图就绪 1/1`；出现 `[maps] ... 回退 TS 定义` 说明 JSON 未加载成功（此时按 1180 / 窗 18 的旧几何运行）。
- **训练场是主要回归入口**：可自由生成僵尸/人类、破门窗、调速度、逐帧单步，验证 AI、命中、感染、倒地与窗洞通行。
- `#/play` 冒烟：主菜单「放置抵抗」直进第一关；顶栏/底栏可见、波次推进、无 console error。
- 开发者模式验收：玩家模式 `#/menu` 无「地图工坊」按钮；设置里输入 `VITE_DEV_PASSWORD`（默认 `zb9993`）后入口出现并可进 `#/workshop`；退出后入口消失、直达 `#/workshop` 被挡回主菜单。密码放 `.env.local`，不要提交。
- 像素外观改动先看 `sprites.html`；单位尺寸由 `src/render/pixel.ts` 的 `VISUAL_SCALE = 1.5` 与 `Zombie.bodyDiameter`（= 2 × 碰撞半径）决定。
- 0.4.2 规则：**开口净宽 < 单位身体直径即不可通行**（门 80、窗 16；普通 11 / 狂奔 9 / 胖子 22）。通行判定口径 = 可见体宽 = 2 × 碰撞半径；渲染盒宽 = 2r × `VISUAL_SCALE`（普通 16.5 / 狂奔 13.5 / 胖子 33），1.5 只补精灵透明留白，不要叠加到半径上。胖子只能走门，流场与移动碰撞都按该通用规则过滤，不是写死特例。
- 0.4.3 规则：**人类血量是真实生命值**（`HUMAN_DEF.hp = 100`，可被设置/训练场覆盖），丧尸每次撕咬按 `Zombie.damage` 扣血，`hp <= 0` 才设置 `turning`；turning 期间 `alive` 仍为 true（`livingHumans` 口径不变）。训练场 `invincible` 完全免疫掉血与异变。
- 0.4.3 规则：**受击减速**由 `combat.ts` 的 `applyHitSlow` 写入 `slowMul/slowTimer`，`ai.ts` 每帧线性恢复并乘到 hunt/wander 移速；每点伤害 4%、最低 40%，0.6 秒恢复，不叠加只取最强并刷新计时；大体型（`bodyDiameter >= 20`）幅度减半、最低 70%；喷火每秒最多结算一次。受击反馈是 `flash > 0` 时渲染层加法混合提亮 0.08 秒。
- 0.4.3 规则：**电击枪** `tesla` 是独立 hitscan（射线投影 + 目标半径 + 墙体/完好门窗视线），不复用 Bullet 扫掠；首个目标 96px 内无其他僵尸时 ×2.2，否则向最近可见僵尸逐只跳跃，最多 5 只（含首个），每跳衰减到 75%。参数集中在 `src/data/weapons/tesla.ts` 的 `tesla` 字段。闪电是 `EffectKind = "arc"` 的折线（`Effect.points`），每跳一段，渲染在 `renderer.ts` 的 `renderArcs()`；训练场链式读数走 `World.onTeslaVolley` 钩子，独立于 DPS 表。
- 0.5.0 规则（阶段 0）：地图运行时来源是 `public/maps/manifest.json` + `<id>.json`；`main.ts` 先 `await loadBuiltinMaps()` 再构造任何依赖地图的实例。瓦片固定 `74×45` / `16px`，加载时 `compileTilesToMapDef()` 编译回 `walls[] + openings[]`，World / 流场 / 渲染结构不变。每扇门窗有独立 `id`，玩家覆盖仍按门 / 窗种类生效。加载失败或校验不通过时回退 `src/data/maps/arena.ts`（0.4.3 的 `1180 × 720` / 窗宽 18），正常路径为 `1184 × 720` / 窗宽 16。
- 0.5.0 规则（阶段 1B）：`assignPosts()` 不依赖开口下标与方位，门岗按门洞长度分名额、窗岗按窗净宽推导、预备队按开局人数 20%，坐标由开口中心与房间几何推导；出怪只从 `spawn` / 可选 `windowSpawn.top/bottom` 按面积加权。`World` 按每扇门窗自身 JSON 的 `maxHp/passSpeed` 初始化，`setActiveMap()` 让 `settings()` / `openingTuning()` 跟随当前地图；玩家覆盖仍按门 / 窗种类优先。内置新增 `test-multi`（2 门 3 窗）。
- 0.5.0 规则（阶段 1A）：`Game` / `TrainingSession` 构造与 `TrainingSession.reset()` 接受 `MapDef | id`，`Game.start()` 优先级为「显式选择 > `LevelDef.mapId` > 当前地图」；`resolveMap()` 对不存在的 id 输出 warning 并回退 `DEFAULT_MAP`，`main.ts` 用 `.map-notice` 做可见提示。换图时 `createWorld(map)` 重建 World / 流场 / 空间索引，`Renderer.setMap()` 清空并重画地板、墙体、训练场装饰与门窗层。临时选图入口为 `?map=<id>`；内置只读地图为 `arena`、`test-yard` 与 `test-multi`。
- 0.5.0 规则（阶段 2）：工坊编辑器只在 `#/workshop` 打开，整页 DOM 覆盖层；入口由阶段 4 的开发者模式控制（玩家模式不显示）。文档用 `Uint8Array` 存瓦片，历史快照是 `serializeDoc()` 的 JSON 字符串；门窗拖拽宽度按格（16px 整数倍），默认值可逐扇改。校验共用 `validateMapJson()`，新增「门窗两侧可通行」规则；带坐标错误可点击跳格。草稿存 localStorage（`zombieGame.workshop.draft.v1`），导出 JSON 可直接进 `public/maps`；内置图只读，必须「另存为副本」。试玩把草稿存 `zombieGame.workshop.preview.v1`，`main.ts` 在 `loadBuiltinMaps()` 后用 `compileTilesToMapDef()` 编译并 `registerRuntimeMap()` 注册为 `workshop-draft`，再进 `?map=workshop-draft#/training`，不落盘。
- 0.5.0 规则（阶段 3）：训练场面板顶部「地图」下拉是唯一玩家可见的选图入口，选项由 `MAP_LIST` + `BUILTIN_MAP_IDS` 分为「内置地图」与「工坊地图」两组（当前图未注册时补一组，显示名与 id 转义）。`TrainingPanel` 新增第三参 `onMapChange`，`main.ts` 的 `switchTrainingMap()` 负责 `training.reset(id)` + `reportMapFallback()` + `renderer.setMap()`；`reset()` 会重建 World / 流场 / 空间索引并清空单位、选中、armed、tool、计时与全部读数，**换图不共用会话**（房间与人类区几何按图不同，跨图保留单位可能落墙里，读数也会混算）。`#/play` 不使用该下拉，仍按 `Game.start()` 优先级（显式选择 > `LevelDef.mapId` > 当前地图）绑定；`level-1` 的 `mapId` 仍是 `arena`，选关节点 / 详情 / 开始按钮显示地图名。
- 0.5.0 规则（阶段 4）：开发者模式是**纯界面开关，不是安全边界**。`src/core/devMode.ts` 用 localStorage key `zombieGame.devMode.v1` 持久化；密码优先读 `.env.local` 的 `VITE_DEV_PASSWORD`（该文件被 git 忽略），缺失/为空时回退 `zb9993`，明文比较。主菜单 `#btnWorkshop` 默认 `hidden`，只由 `main.ts` 的 `syncDevModeUI()` 按状态切换；`applyRoute("workshop")` 在未开启开发者模式时用 `.map-notice` 提示并 `router.go("menu")`，退出开发者模式时若仍在工坊页也会自动回主菜单。玩家模式完全看不到工坊入口，但玩家改 localStorage 或直接构造 URL 仍可绕过。

## 已知限制（0.5.0 现状）

- 人类会真实掉血，但血量归零不会立刻死亡，而是进入原有的 2.8 秒转化倒计时；训练场可调人类血量与僵尸攻击力来观察。
- 电击枪链式最多 5 只（含首个），每跳都要求视线可见：未破的门窗会挡住后续跳跃；链式半径 / 上限 / 衰减 / 单体加成只有 `src/data/weapons/tesla.ts` 一处参数，没有全局滑块。首个目标的单体加成按“96px 内是否有其他存活僵尸”判断，不检查它们是否被墙挡住。
- 僵尸攻击力目前只有训练场按单位调整，全局滑块表未登记 `damage`；默认值在 `src/data/zombies/*.ts`。
- `screenshots/` 固定只保留 6 张长期设计图，新增验证图不要提交（见强制约定）。
- 无 BGM；只有一次性音效，且同一事件全局限频，**没有随机音效变体**（音高/时长变化）。
- `weapon-reload`、`human-hurt` 两个事件已声明、文件已备好，但当前没有调用点。
- 只有一个关卡（`level-1`），内置 3 张只读地图（`arena` / `test-yard` / `test-multi`）；`#/levels` 仍保留但主菜单不再入口。地图 JSON 支持固定 `74×45` / `16px` 画布与任意数量门窗（至少 1 扇门），守岗与出怪已泛化。工坊编辑器已完成阶段 2，入口只在开发者模式下显示（阶段 4）；玩家模式直达 `#/workshop` 会被挡回主菜单，但这只是界面显隐，不是安全边界。训练场已可选图（阶段 3），`#/play` 仍只跑关卡绑定地图、没有对局内选图 UI，调试仍可用 `?map=<id>`。内置图只能另存副本；工坊草稿与试玩预览只存 localStorage，发布仍需导出 JSON 放进 `public/maps` 并更新 manifest。
- 开口参数折中：`World` 按每扇门窗自身 JSON 初始化 `maxHp/passSpeed`，但玩家设置的门 / 窗覆盖仍按种类统一生效且优先级更高；`#/play` 下 `level-1` 的 `doorHp=450 / winHp=100 / winPassSpeed=0.45` 会覆盖 `test-multi` 的逐扇默认值，逐扇差异需在 `#/training` 或无关卡覆盖的场景观察。逐扇独立覆盖 UI 属于后续阶段。
- 「闯关模式」只有主菜单入口与占位说明，**尚未实现**，不会进入空页面。
- 主菜单「清空存档」只清玩法进度（放置抵抗关卡进度 + 预留的 `zombieGame.challenge.*`），保留音量偏好与参数覆盖值。
- 没有自动化测试；`npm run build` 只保证类型与打包，行为正确性依赖浏览器实跑。
- 美术只有朝上的单套帧，运行时按朝向旋转，任意角度会有轻微锯齿；特效/场景装饰仍由 Pixi 代码绘制。
- 眼睛、倒地帧等细节以实际 `src/art/sprites.ts` 为准；改帧矩阵后务必跑一次宽度校验（每行必须 32 字符）。
