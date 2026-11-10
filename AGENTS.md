# AGENTS.md —— 项目索引（给后续接手的大模型）

> 先读本文件，再按「改 X 去哪」直接打开对应文件，不需要递归扫描全仓库。

## 一句话定位

浏览器 2D 关卡制自动对抗小游戏：玩家在关卡里的人类区放置不同武器的人类（各自有库存与恢复），抵御从门/窗涌入的丧尸；开发者可在选关页新建 / 编辑关卡。玩家不直接操控单位，通过放置、切行为模式与速度观察战局；「尸潮求生」则是单角色 Roguelike 生存，玩家自己移动、自动开火、吃经验升级，只计失败；另有独立训练场做单位与武器回归。技术栈 **PixiJS 8 + TypeScript 5.7 + Vite 6**，像素美术与音效全部内置于仓库，无外部 CDN / 在线美术依赖。

当前版本 **0.8.3**。路由只有 7 个：`#/menu`（主菜单）、`#/levels`（选关与关卡编辑入口，`?level=<id>` 进关；`#/levels/edit?id=<id>` 是编辑器直达别名，映射到本路由且仅开发者模式可打开）、`#/play`（对局）、`#/survival`（尸潮求生，单角色 Roguelike 生存）、`#/training`（训练场）、`#/workshop`（工坊编辑器，仅开发者模式可见，玩家模式直达会被挡回主菜单）、`#/tuning`（数值调参，仅开发者模式可见，玩家模式直达会被挡回主菜单）。**数值调整统一走独立的 `#/tuning` 栏目，游玩界面不再提供设置入口。**

## 顶层目录职责

| 目录 | 职责 | 关键约束 |
|---|---|---|
| `src/data/` | **唯一数值来源**：实体定义、地图、关卡、地形、默认设置、滑块元数据 | 调平衡只改这里；玩家改动只存覆盖值，读取时合并 |
| `public/maps/` | **地图运行时来源**：`manifest.json` + `<id>.json` 瓦片地图（内置图只读，另有 dev 期保存的工坊图） | 内置只读；加载失败回退 `src/data/maps/arena.ts` |
| `public/levels/` | **关卡运行时来源**：`manifest.json` + `<id>.json`（内置 `level-1` / `level-2` 只读） | 关卡只引用 `mapId`，不复制地图数据；加载失败回退 `src/data/levels/level-1.ts` |
| `src/core/` | 运行时状态与流程：`world.ts` 实体/空间索引/开口/母体产卵落点/全局 BOSS 血条数据，`game.ts` 准备/放置/库存/波次/胜负，`storage.ts` 存档与逐关解锁，`devMode.ts` 开发者模式开关与密码校验 | `world` 只存状态和查询；行为不放这里 |
| `src/systems/` | 行为与规则：`ai.ts` 人类/丧尸/感染/受击减速推进与追击模式分发（含草丛减速与索敌、母体产卵、尖叫者强化），`collision.ts` 人类/丧尸/生成落点共用的阻挡判定，`combat.ts` 开火、命中、减速、暴击与死亡产卵结算，`flowField.ts` BFS 寻路（支持显式多源），`regions.ts` 按体型的连通区域图与区域邻接边 | 新玩法规则优先落在这里 |
| `src/render/` | PixiJS 绘制：`renderer.ts` 场景/单位/粒子/倒地/准备区标记/强化标识/DOM BOSS 血条，`pixel.ts` 精灵与坐标换算（按 `SpriteDef.grid` 推导缩放与锚点） | 只读 World，不改数据 |
| `src/art/` | 像素精灵数据：`sprites.ts` 单体（`SpriteDef.grid` 决定网格尺寸，默认 32×32、母体 64×64），`composites.ts` 人类+武器烘焙，`preview.ts` 预览页 | 不 import 游戏其它模块 |
| `src/audio/` | `events.ts` 事件/文件/限频，`manager.ts` 预加载与播放 | 音频文件在 `public/audio/`，必须登记授权 |
| `src/training/` | `session.ts` 独立沙盒 World 与统计，`panel.ts` 右侧 DOM 面板 | 复用正式玩法，不复制 AI/战斗逻辑 |
| `src/survival/` | `session.ts` 单角色生存会话（输入移动、自动战斗、经验/升级、出怪、失败），`ui.ts` 选图/HUD/三选一/结算，`storage.ts` 最佳记录 | 复用 world/ai/combat/collision，不复制战斗逻辑 |
| `src/levelEditor/` | `page.ts` 开发者关卡编辑器弹层，`devSave.ts` / `devDelete.ts` 开发态请求封装 | 只编辑 JSON，不直接改运行时数据 |
| `src/workshop/` | `doc.ts` 瓦片文档与历史快照，`editor.ts` 2D 画布，`page.ts` 整页 UI，`devSave.ts` 开发态保存请求，`storage.ts` 草稿与试玩预览 | 只编辑 JSON，不直接改运行时 World |
| `scripts/` | `workshop-save-plugin.ts`：地图 / 关卡「保存、删除」Vite dev 中间件（只读保护 / 名称唯一 / 备份 / manifest 登记与移除 / `/maps/*.json`、`/levels/*.json` 即时读取）；`make-dmg.mjs`：macOS 桌面版 dmg 封装（electron-builder 出 `.app` 后调 `hdiutil`）；`regression/run.mjs` + `suite.ts`：Node + esbuild 加载真实模块的回归脚本 | 保存插件只在 dev 注册、不进入构建产物；回归脚本只读仓库、不写盘；dmg 脚本在非 macOS 平台直接跳过 |
| `src/ui/` | `hud.ts` 对局顶栏读数，`inventory.ts` 准备阶段库存卡片与开始按钮 | 只做展示 |
| `src/utils/` | `math.ts` 数学工具，`spatialHash.ts` 空间哈希 | 无游戏语义 |
| `electron/` | `main.cjs` 桌面版主进程：`127.0.0.1` 随机端口只读静态服务指向 `dist`、BrowserWindow、安全策略 | 只服务打包内的 `dist`，不加载 dev server；不引入游戏代码依赖 |
| `build/` | 桌面版图标源资产：`icon.png`（1024）、`icon.icns`、`icon.ico` | 源码资产随仓库提交；打包产物在 `release/`（已 gitignore） |

根目录：`index.html`（骨架与所有覆盖层）、`src/main.ts`（启动/路由/主循环/菜单事件/选关与编辑器接线）、`src/style.css`、`src/levels.ts`（关卡展示投影与地图 / 关卡引用登记）、`src/router.ts`、`vite.config.ts`（注册 dev 保存插件 + 构建期清理 `.bak`）、`sprites.html`（仅开发期预览）、`electron/main.cjs`（桌面版主进程）、`build/`（桌面版图标）、`release/`（桌面版打包产物，不提交）、`public/audio/`、`public/maps/`、`public/levels/`、`README.md`、`CHANGELOG.md`、`TODO.md`、`AGENTS.md`。

## 改 X 去哪几个文件

| 需求 | 必改文件 | 通常还需要 |
|---|---|---|
| 新增僵尸 | `src/data/zombies/<id>.ts`（含 `damage`，可选 `pursuit` / `leap` / `spit` / `boss` / `noAttack` / `spawner` / `scream`）、`src/data/zombies/index.ts`（注册 + `ZOMBIE_IDS`）、`src/data/survival/config.ts`（`SURVIVAL_ZOMBIE_WEIGHTS` 普通出怪权重或 `SURVIVAL_BOSS_POOL` BOSS 投放，按需 `SURVIVAL_ZOMBIE_OVERRIDES`、`SURVIVAL_XP_BY_KIND`） | `src/render/pixel.ts`（缺图兜底 / 死亡精灵 id）；精灵、专属叫声、授权台账、文档与训练场验收按「新增实体三件套」 |
| 改人类血量 / 撕咬伤害 | `src/systems/ai.ts`（咬人扣血→归零才 turning）、`src/core/world.ts`（`Human.hp/hurtTimer`、`Zombie.damage`）、`src/data/zombies/*.ts`（`damage`） | `src/render/renderer.ts`（头顶血条）、`src/data/settings/runtime.ts`（`damage` 覆盖值）、训练场编辑器/统计；飞扑者不撕咬人类（伤害来自 `leap.pinDps`），腐蚀者为 15 |
| 改受击减速 | `src/systems/combat.ts`（`applyHitSlow`）、`src/systems/ai.ts`（推进/应用到移速）、`src/data/zombies/index.ts`（`ZOMBIE_SLOW`） | `src/core/world.ts`（`slowMul/slowTimer/flash`）、`src/render/renderer.ts`（受击闪白） |
| 改飞扑者蓄力 / 扑击 / 附身 | `src/data/zombies/leaper.ts`（`leap` 参数）、`src/systems/ai.ts`（`tickLeaper` 状态机、`releasePin` 的弹开与冷却）、`src/core/world.ts`（`Human.pinTimer/pinBy`、`Zombie.leapPhase/leapTimer/leapCooldown/leapTargetId/leapDX/leapDY/pinTargetId`） | `src/systems/combat.ts`（`applyHitSlow` 内蓄力延长 +0.12s、上限 `chargeMax`）、`src/survival/session.ts`（`tapEscape` 连点缩短）、`src/render/renderer.ts`（紫红染色 + 紫环爪痕）、音效 `zombie-leap` |
| 改腐蚀毒液 | `src/data/zombies/corroder.ts`（`spit` 参数）、`src/core/world.ts`（`PoisonShot` / `World.poisonShots` / `spitPoison` / `tickPoisonShots` / `PoisonPool` / `World.poison` / `addPoison` / `poisonEffectAt` / `tickPoison`，由 `tickTerrain` 调用）、`src/systems/ai.ts`（射程内吐毒弹、死亡留毒在 `combat.ts` 的 `damageZombie`） | `src/systems/ai.ts`（毒液减速进入人类移速）、`src/render/renderer.ts`（`poisonShotLayer` 飞行轨迹 + `poisonLayer` 毒圈）、训练场「清场」清空 `world.poison` / `world.poisonShots`、回归场景 |
| 改母体产卵 / 死亡产卵 | `src/data/zombies/matriarch.ts`（`spawner` 参数）、`src/systems/ai.ts`（`tickMatriarch`）、`src/systems/combat.ts`（`damageZombie` 死亡产卵）、`src/core/world.ts`（`spawnChild` / `Zombie.spawnedBy` / `xpMul`）、`src/data/survival/config.ts`（`rollMatriarchChildKind`、`SURVIVAL_BOSS_POOL`、子体经验） | `src/render/renderer.ts` + `src/style.css`（顶部 BOSS 血条）、`src/data/settings/runtime.ts`（`spawner` 按模式浅合并）、回归场景 |
| 改尖叫强化 | `src/data/zombies/screamer.ts`（`scream` 参数）、`src/systems/ai.ts`（`tickScreamer` / `tickZombieBuff`）、`src/core/world.ts`（`Zombie.screamTimer/buffTimer/buffSpeedMul/buffDamageMul/buffTakenMul`） | `src/systems/ai.ts`（移速与撕咬读倍率）、`src/render/renderer.ts`（粉紫染色 + 脚下脉动粉环）、`src/data/types.ts`（`ZombieScreamConfig`）、`src/data/settings/runtime.ts`（`scream` 按模式浅合并）、回归场景 |
| 新增武器 | `src/data/weapons/<id>.ts`、`src/data/weapons/index.ts`（注册 + `WEAPON_IDS` / `WEAPON_LIST`）、`src/data/survival/config.ts`（`SURVIVAL_WEAPON_POOL` 武器池） | 精灵外观与训练场自动出现按「新增实体三件套」；`src/data/levels/schema.ts`（`LEVEL_WEAPON_ORDER`）、`src/data/settings/sliders.ts`（如要单独滑块）；电击枪类链式武器还要改 `src/systems/combat.ts`（独立 hitscan/链式，不复用 Bullet）与 `src/render/renderer.ts`（`renderArcs` 电弧特效） |
| 新增地图 | `public/maps/<id>.json` + `public/maps/manifest.json`（瓦片 74×45 / 16px）、`src/data/maps/index.ts`（注册与加载） | `src/data/maps/schema.ts`（校验）、`src/data/maps/compile.ts`（编译）、`src/data/maps/arena.ts`（TS 兜底）、`src/levels.ts`（`LevelDef.mapId` 引用）、`src/render/renderer.ts`（`setMap()` 重建静态层） |
| 新增音效 | `public/audio/<name>.mp3`、`src/audio/events.ts`（`SFX` + `SFX_MAP` + `SFX_THROTTLE` 三处） | 调用点（`src/systems/ai.ts` / `src/systems/combat.ts` / `src/core/game.ts` / `src/main.ts`）；授权台账按「新增实体三件套」第 4 步。0.8.2 新增事件：`zombie-growl-leaper` / `zombie-leap`（飞扑者索敌与起跳）、`zombie-growl-corroder` / `zombie-spit`（腐蚀者索敌与吐毒）、`zombie-growl-matriarch` / `zombie-spawn` / `zombie-matriarch-death`（母体索敌 / 产卵 / 死亡）、`zombie-scream`（尖叫者） |
| 改地形（草丛 / 水池） | `src/data/terrain.ts`（数值）、`src/data/maps/schema.ts`（瓦片字符与校验）、`src/data/maps/compile.ts`（编译 `grassTiles` / `waterTiles` / `waterBlockers`）、`src/core/world.ts`（草地状态 / `grassEffectAt` / `igniteGrassAt` / `tickTerrain` / `blockers`） | `src/systems/ai.ts`（减速与索敌）、`src/systems/combat.ts`（喷火点燃）、`src/systems/flowField.ts` + `regions.ts`（水池阻挡）、`src/render/renderer.ts`（地表与草地层）、`src/workshop/` + `src/training/`（画笔）、`src/data/types.ts`（`MapDef` 字段） |
| 改求生升级 / 双武器 | `src/data/survival/config.ts`（奖励池 / 上限 / 难度）、`src/survival/session.ts`（`ownedWeapons` / `extraProjectiles` / `crit` / `lifesteal` / `pickupMul` / `rollChoices` / `chooseWeapon`） | `src/core/world.ts`（`Human.weapon2/ammo2/fire2...` 与 `extraProjectiles/critChance/critMul`）、`src/systems/combat.ts`（`slotState` / `tryFire(...,slot)` / `updateFlame(...,slot)` / 暴击）、`src/systems/ai.ts`（副武器同帧开火）、`src/survival/ui.ts` + `index.html` + `src/style.css`（二段选武器与 HUD 芯片） |
| 改回归脚本 | `scripts/regression/suite.ts`（场景与断言）、`scripts/regression/run.mjs`（esbuild 打包与退出码）、`package.json`（`regression` 脚本与 `esbuild` devDependency） | 新增场景时用 `scenario()` 注册并保持失败信息包含场景名；不要 import 会触碰 DOM / Pixi 的模块（`main.ts` / `renderer.ts` / `workshop/page.ts`） |
| 改 AI 行为 | `src/systems/ai.ts`（含 `breach` / `direct` 分发、`tickLeaper` 飞扑状态机、`tickMatriarch` 产卵、`tickScreamer` / `tickZombieBuff` 强化、`nearestVisibleHuman` 吐毒索敌） | `src/data/zombies/<id>.ts`（`pursuit` / `leap` / `spit` / `spawner` / `scream` / `noAttack`）、`src/data/types.ts`（`ZombiePursuitMode` / `ZombieLeapConfig` / `ZombieSpitConfig` / `ZombieSpawnerConfig` / `ZombieScreamConfig`）、`src/systems/regions.ts`（连通区域图）、`src/systems/flowField.ts`（寻路规则）、`src/core/world.ts`（区域 / 流场缓存与 `invalidateNavigation`、毒液池、`spawnChild`、`bossBarInfo`）、`src/data/zombies/index.ts`（`WANDER_TUNING`）、`src/data/settings/runtime.ts` + `sliders.ts`（可调参数） |
| 改尸潮求生数值 / 奖励池 / 出怪 | `src/data/survival/config.ts`（`spawn` / `difficulty` / `SURVIVAL_ZOMBIE_WEIGHTS` / `SURVIVAL_BOSS_POOL` / `SURVIVAL_ZOMBIE_OVERRIDES` / `SURVIVAL_WEAPON_POOL` / `SURVIVAL_XP_BY_KIND`） | `src/survival/session.ts`（升级应用 `syncPlayerStats` / `syncWeaponStats`、`bossTick`）、`src/survival/ui.ts`（卡片文案与副武器芯片） |
| 改尸潮求生流程 / 出怪 / 经验 | `src/survival/session.ts` | `src/data/survival/config.ts`、`src/core/world.ts`（`findFreeSpot` / `onKill`）、`src/main.ts`（ticker 与键盘输入） |
| 改求生 HUD / 升级 / 结算界面 | `src/survival/ui.ts`、`index.html`、`src/style.css` | `src/main.ts`（路由、镜头、快捷键）、`src/survival/storage.ts`（记录展示） |
| 改移动 / 碰撞判定 | `src/systems/collision.ts`（`isBlockedForBody` / `findFreePoint`） | `src/core/world.ts`（`solidAt` / `findFreeSpot`）、`src/systems/ai.ts`（人类逐轴移动）、`src/core/game.ts`（随机出生落点）、`src/training/session.ts`（点选生成）、`src/data/humans.ts`（`HUMAN_BODY_DIAMETER`） |
| 改渲染 / 外观 | `src/render/renderer.ts`、`src/render/pixel.ts` | `src/art/sprites.ts`（像素数据，`SpriteDef.grid` 可大于 32×32）、`sprites.html` 预览；缩放置换一律走 `spriteScale(diameter, def)` / `spriteAnchor(def)`，不要写死 `SPRITE_SIZE` |
| 改训练场 | `src/training/session.ts`、`src/training/panel.ts`、`index.html`（面板 DOM）、`src/style.css` | `src/audio/events.ts`（如新增操作音） |
| 改工坊编辑器 | `src/workshop/doc.ts`（瓦片/区域/实施例）、`src/workshop/editor.ts`（画布与输入）、`src/workshop/page.ts`（整页 UI 与校验/存读档）、`src/workshop/storage.ts`（草稿与试玩预览） | `src/data/maps/schema.ts`（校验规则）、`index.html` + `src/style.css`（覆盖层 DOM 与样式）、`src/router.ts` + `src/main.ts`（路由、`?map=workshop-draft` 注册、开发者模式守卫） |
| 工坊「保存到项目 / 删除地图」 | `scripts/workshop-save-plugin.ts`（dev 中间件）、`src/workshop/devSave.ts` / `src/workshop/devDelete.ts`（请求封装）、`src/workshop/page.ts`（dev-only 按钮与流程）、`src/levels.ts`（`getMapReferences()` 引用保护与未来模式登记点） | `vite.config.ts`（注册插件）、`.gitignore`（`.bak/` 与 `*.tmp`）、`src/workshop/storage.ts`（`resetWorkshopCatalog`）、`src/main.ts` + `src/training/panel.ts`（热刷新下拉 / 删除当前训练图回退 `arena`） |
| 改地图名称 / id | `src/workshop/doc.ts`（`generateWorkshopId`、名称回退）、`src/workshop/page.ts`（名称输入）、`scripts/workshop-save-plugin.ts`（服务端二次校验）、`src/workshop/storage.ts`（目录显示名 / `hasName`） | `src/data/maps/schema.ts`（name 校验）、`src/data/maps/compile.ts`（无 name 回退 id）、`src/training/panel.ts`（下拉显示名称） |
| 改数值调参页 | `src/data/settings/sliders.ts`（滑块清单，含僵尸子配置与武器扩展字段）、`src/data/settings/defaults.ts`、`src/data/settings/runtime.ts`（覆盖值 / 本局关卡值 / 模式值三层合并与路径读写） | `src/main.ts`（`#/tuning` 渲染与读写）、`index.html` + `src/style.css`（调参页 DOM / 样式）、`src/router.ts`（路由）、`src/core/devMode.ts`（开发者入口显隐与守卫） |
| 新增 / 改关卡数据 | `public/levels/<id>.json` + `public/levels/manifest.json`、`src/data/levels/schema.ts`（结构与校验）、`src/data/levels/index.ts`（加载 / 回退 / 注册表） | `src/data/levels/level-1.ts`（TS 兜底）、`src/levels.ts`（展示投影与引用登记）、`src/main.ts`（启动 `loadLevels()`）、README/CHANGELOG |
| 改选关 / 解锁 | `src/main.ts`（`refreshLevelsPage` / `isLevelUnlocked` / `#/play?level=`）、`src/core/storage.ts`（`recordBeaten` / `loadProgress`） | `src/data/levels/index.ts`（顺序与只读集合）、`src/router.ts`（查询串）、`index.html` + `src/style.css`（列表与锁定态） |
| 改放置 / 库存 / 胜负 | `src/core/game.ts`（`PlacementResult` / `placeHuman` / `beginBattle` / `regenInventory` / 胜负判定）、`src/ui/inventory.ts`、`src/render/renderer.ts`（`setPlacementZones`） | `src/core/world.ts`（`spawnHuman` 血量覆盖、`solidAt` / `findFreeSpot`）、`index.html` + `src/style.css`（库存面板）、`src/ui/hud.ts`（波次 / 人数读数） |
| 改关卡编辑器 | `src/levelEditor/page.ts`（表单 / 波次 / 校验 / 保存删除流程）、`scripts/workshop-save-plugin.ts`（`/__levels/save` / `/__levels/delete` 与 `/levels/*.json` 静态服务） | `src/levelEditor/devSave.ts` / `devDelete.ts`（请求封装）、`src/data/levels/schema.ts`（`LevelValidationContext`）、`src/levels.ts`（`getLevelReferences`）、`src/main.ts`（列表按钮与热刷新）、`src/style.css`（`.le-*`）、`vite.config.ts`（build 清理 `.bak`） |
| 改主菜单 / 路由 | `index.html`、`src/main.ts`、`src/style.css` | `src/router.ts`（含 `#/levels/edit` 别名映射）、`src/levels.ts`、`src/core/devMode.ts`（工坊入口显隐、`#/workshop` 与 `#/levels/edit` 的开发者模式守卫） |
| 改桌面版 / 打包 | `electron/main.cjs`（静态服务 / 窗口 / 安全策略）、`package.json`（`main` 入口、`app:build` 脚本、`build` 配置）、`build/icon.*`、`scripts/make-dmg.mjs` | `README.md` 桌面版章节、`CHANGELOG.md`、`.gitignore`（`release/`）、`electron-builder` 的 mac / win / nsis 配置 |

## 新增实体「三件套」流程（缺一项视为未完成）

1. **数据注册**：新建定义文件并在注册表登记。数值只写定义文件，不在设置里重复；僵尸必须写 `damage`（每次撕咬对人类的伤害）。训练场按钮、统计行、HUD 会自动跟随注册表。
2. **登记求生池（0.8.2 起的硬性要求）**：新增僵尸必须同步登记到 `src/data/survival/config.ts` 的 `SURVIVAL_ZOMBIE_WEIGHTS`（普通出怪权重表）或 `SURVIVAL_BOSS_POOL`（BOSS 独立投放），并在 `SURVIVAL_XP_BY_KIND` 登记经验值；需要独立平衡时再加 `SURVIVAL_ZOMBIE_OVERRIDES`；新增武器必须加入 `SURVIVAL_WEAPON_POOL`。漏登记会被 `npm run regression` 的「求生池守卫」场景直接判失败，视为未完成。
3. **精灵与动画帧**：`src/art/sprites.ts` 增加 `SpriteDef`（默认 32 行 × 32 字符，`.` 透明；大体型可用 `grid` 声明更大网格，如母体 64×64）；僵尸 id 为 `zombie-<kind>`，倒地帧用 `zombie-<kind>-death`；同步 `sprites.html` 预览（1× / 游戏内尺寸 / 8×）。细节以实际 `src/art/sprites.ts` 为准。
4. **音效与 events**：文件放 `public/audio/`，`src/audio/events.ts` 登记事件、映射、限频；无新素材时优先从现有 CC0 派生，避免新增授权。
5. **授权台账**：`public/audio/CREDITS.md` 记录来源、许可证、作者与处理方式；派生物注明原文件。
6. **文档**：按「强制约定」同步 `README.md` 与 `CHANGELOG.md`。
7. **训练场验收**：单位库出现按钮、可生成、可选中、统计行有数值；再跑 `npx tsc --noEmit`、`npm run build`，实跑 `#/play`、`#/training` 无 console error。

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
npm run regression # Node + esbuild 回归脚本（29 个场景，失败返回非零退出码）
npx tsc --noEmit  # 单项类型检查
npm run app:build # 先 build，再按当前平台打包桌面版（macOS 出 .app 后用 hdiutil 封 dmg，产物在 release/）
npm run app:build:win # 在 Windows 上先 build，再出 NSIS 安装包
```

- **必须走 HTTP 服务**：不能双击 `index.html`，`file://` 下模块与资源会加载失败。
- 启动后控制台应出现 `[audio] 预加载完成`；若某 mp3 缺失会静默降级，不抛错。地图正常路径应出现 `[maps] 已加载「arena」1184×720` 与 `[maps] 内置地图就绪 N/N（默认「arena」）`（N 为 manifest 条目数，就绪数与 manifest 一致）；关卡正常路径应出现 `[levels] 关卡就绪 N 个（清单 N 项）`。出现 `[maps] ... 回退 TS 定义` 或 `[levels] ... 使用 TS 兜底关卡` 说明 JSON / 校验失败，选关页顶部会有 `.map-notice` 提示。
- **训练场是主要回归入口**：可自由生成僵尸/人类、破门窗、调速度、逐帧单步，验证 AI、命中、感染、倒地与窗洞通行。
- `#/play` 冒烟：主菜单「放置抵抗」→ `#/levels` → 点已解锁关 → 准备阶段可见人类区 / 僵尸区与库存面板 → 放置人类 → 开始 → 波次推进 → 无 console error。未放置人类点「开始」应只提示、不判负。
- `#/survival` 冒烟：主菜单「尸潮求生」→ 选图卡片默认「空旷地」→ 开始求生 → HUD 血量 / 经验 / 计时 / 击杀正常 → `WASD` 移动且镜头跟随 → 击杀掉经验、靠近吸附、满经验弹出三选一 → 选择后继续 → 血量归零出现结算并能重开 / 回主菜单 → 无 console error。调数值后建议静置观察击杀 / 掉血节奏，再移动吃经验验证升级。
- 开发者模式验收：玩家模式 `#/menu` 无「地图工坊」按钮；设置里输入 `VITE_DEV_PASSWORD`（默认 `zb9993`）后入口出现并可进 `#/workshop`；退出后入口消失，直达 `#/workshop` 被挡回主菜单、直达 `#/levels/edit?id=<id>` 被挡回 `#/levels` 并提示。开发者模式下 `#/levels` 全解锁并出现「新建 / 编辑 / 复制 / 删除」，内置教学关只能「复制」，`#/levels/edit?id=<id>` 可直接打开编辑器。密码放 `.env.local`，不要提交。
- 关卡编辑器验收：新建关 → 填名称 → 保存 → 列表热刷新出现新关；重名被拦截；删除后 manifest 与列表恢复；`npm run build` 后 `dist` 搜不到 `__levels/save` / `__levels/delete` / `保存到项目（dev）` / `删除关卡`，`npm run preview` 下接口 404。
- 改行为 / 数值后至少跑 `npm run regression`；新增回归场景用 `scenario()` 注册在 `scripts/regression/suite.ts`，不要 import 会触碰 DOM / Pixi 的模块。
- 像素外观改动先看 `sprites.html`；单位尺寸由 `src/render/pixel.ts` 的 `VISUAL_SCALE = 1.5` 与 `Zombie.bodyDiameter`（= 2 × 碰撞半径）决定。

## 规则

- 规则（碰撞与开口通行）：**开口净宽 < 单位身体直径即不可通行**（门 80、窗 16；普通 11 / 狂奔 9 / 胖子 22）。人类与丧尸共用 `systems/collision.ts` 的 `isBlockedForBody()`：墙体与地图边界永远阻挡，完好门窗一律阻挡，已破坏开口只有净宽 ≥ 身体直径才放行；人类身体直径 = `HUMAN_DEF.radius * 2 = 12`。阻挡矩形按**碰撞半径**（`bodyDiameter / 2`，即 `Zombie.radius` / `HUMAN_DEF.radius`）外扩，单位停在身体外缘贴墙；外扩只作用于实体阻挡，**不改变开口通行口径**（净宽仍与身体直径比较），所以普通丧尸仍能过 16px 破窗、胖子仍被挡。丧尸位置的地图边界夹取也按 `z.radius`。人类移动逐轴判定（撞墙只停该轴、保留沿墙滑动），`stuck` 恢复检测用 `solidAt(x, y, 0, 0)` 纯点判定，避免贴墙单位被半径判定误判为卡住而绕过碰撞；巡逻目标点、随机出生落点与训练场点选生成统一走 `World.findFreeSpot()` / `World.solidAt()`；训练场点击墙内或钻不过的开口不生成单位。水池已在 `MapDef.waterBlockers` 登记阻挡矩形（不写入 `map.walls`，因此不挡子弹与视线）；新增其它地形时沿用同一套阻挡登记。胖子只能走门，流场与移动碰撞都按该通用规则过滤，不是写死特例。`humanBounds` 只负责把人类夹在房间内，**不再替代墙体碰撞**；不能只靠夹取，否则含内部墙体的自定义地图（如 `my-map`）里人类会横穿内墙与门窗。
- 口径（尺寸）：`VISUAL_SCALE = 1.5` 只放大精灵绘制盒，**不是碰撞半径**；渲染盒宽 = 2r × `VISUAL_SCALE`（普通 16.5 / 狂奔 13.5 / 胖子 33），1.5 只补精灵透明留白，不要叠加到半径上；阻挡外扩用 `bodyDiameter / 2`。实测不透明外廓人类约 12.4、普通约 11.3、胖子约 24.8，与碰撞直径 12 / 11 / 22 基本一致，剩余差异 ≤ 1.4px。不要为了「看上去更贴墙」再把碰撞半径调大，否则 16px 窗的通行带（普通只剩约 5px）会被挤到不可通过。
- 规则（地形瓦片）：地图瓦片字符在 `schema.ts` 的 `TILE_CHARS` 登记，当前为 `.` 空地 / `#` 墙 / `w` 窗 / `d` 门 / `g` 草丛 / `~` 水池；`compileTilesToMapDef()` 额外输出 `grassTiles` / `waterTiles` / `waterBlockers`。**水池只进 `waterBlockers` / `World.blockers` / 流场 / 连通区域图，绝不写入 `map.walls`**，否则 `computeBulletWalls()` 与 `sightBlocked()` 会误挡子弹与视线。草丛可通行：`World.grass` 逐格保存 `phase`（0 正常 / 1 燃烧 / 2 休眠 / 3 重生）与 `timer`，`grassEffectAt()` 返回 0..1 有效度，人类与丧尸移速按 `(1 - (1 - speedMul) * effect)` 折减，人类索敌同理按 `humanSightMul`；喷火覆盖草地格时 `igniteGrassAt()`，`tickTerrain(dt)` 推进「燃烧 1.5s → 休眠 10s → 渐隐重生 1s」。数值集中在 `src/data/terrain.ts`，工坊与训练场画笔通过 `applyTerrainMap()` 换图 / 改图。
- 规则：**人类血量是真实生命值**（`HUMAN_DEF.hp = 100`，可被设置/训练场覆盖），丧尸每次撕咬按 `Zombie.damage` 扣血，`hp <= 0` 才设置 `turning`；turning 期间 `alive` 仍为 true（`livingHumans` 口径不变）。训练场 `invincible` 完全免疫掉血与异变。
- 规则：**受击减速**由 `combat.ts` 的 `applyHitSlow` 写入 `slowMul/slowTimer`，`ai.ts` 每帧线性恢复并乘到 hunt/wander 移速；每点伤害 4%、最低 40%，0.6 秒恢复，不叠加只取最强并刷新计时；大体型（`bodyDiameter >= 20`）幅度减半、最低 70%；武器的 `hitSlowMul` 会在最后再乘一档（狙击枪 0.75 → 普通 30% / 大体型 52.5%）；喷火每秒最多结算一次。受击反馈是 `flash > 0` 时渲染层加法混合提亮 0.08 秒。
- 规则：**电击枪** `tesla` 是独立 hitscan（射线投影 + 目标半径 + 墙体/完好门窗视线），不复用 Bullet 扫掠；首个目标 96px 内无其他僵尸时 ×2.2，否则向最近可见僵尸逐只跳跃，最多 5 只（含首个），每跳衰减到 75%。参数集中在 `src/data/weapons/tesla.ts` 的 `tesla` 字段。电弧是 `EffectKind = "arc"` 的 8–12 段高频低振幅抖动曲线（`Effect.points`，两端精确落在枪口 / 目标上），线宽与亮度按每跳视觉强度（`Effect.strength`，跟随链式衰减）递减；命中处另画 `EffectKind = "ring"` 的扩散光环，单体加成的强白闪、电火花与轻微尺寸脉冲只作用在被击中的僵尸身上，不体现在电弧上。渲染在 `renderer.ts` 的 `renderArcs()`；训练场链式读数走 `World.onTeslaVolley` 钩子，独立于 DPS 表。
- 规则（地图运行时来源）：地图运行时来源是 `public/maps/manifest.json` + `<id>.json`；`main.ts` 先 `await loadBuiltinMaps()` 再构造任何依赖地图的实例。瓦片固定 `74×45` / `16px`，加载时 `compileTilesToMapDef()` 编译回 `walls[] + openings[]`。每扇门窗有独立 `id`，玩家覆盖仍按门 / 窗种类生效。加载失败或校验不通过时回退 `src/data/maps/arena.ts` 的 TS 定义。
- 规则（出怪与逐扇参数）：出怪只从多块 `spawn` / 可选 `windowSpawn.top/bottom` 按面积加权。`World` 按每扇门窗自身 JSON 的 `maxHp/passSpeed` 初始化，`setActiveMap()` 让 `settings()` / `openingTuning()` 跟随当前地图；玩家设置的门 / 窗覆盖仍按种类统一生效且优先级更高。
- 规则（换图与地图解析）：`Game` / `TrainingSession` 构造与 `TrainingSession.reset()` 接受 `MapDef | id`，`Game.start()` 优先级为「显式选择 > `LevelDef.mapId` > 当前地图」；`resolveMap()` 对不存在的 id 输出 warning 并回退 `DEFAULT_MAP`，`main.ts` 用 `.map-notice` 做可见提示。换图时 `createWorld(map)` 重建 World / 流场 / 空间索引，`Renderer.setMap()` 清空并重画地板、墙体、训练场装饰与门窗层。临时选图入口为 `?map=<id>`。
- 规则（工坊编辑器）：工坊编辑器只在 `#/workshop` 打开，整页 DOM 覆盖层；入口由开发者模式控制（玩家模式不显示）。文档用 `Uint8Array` 存瓦片，历史快照是 `serializeDoc()` 的 JSON 字符串；门窗拖拽宽度按格（16px 整数倍），默认值可逐扇改。校验共用 `validateMapJson()`，新增「门窗两侧可通行」规则；带坐标错误可点击跳格。草稿存 localStorage（`zombieGame.workshop.draft.v1`），导出 JSON 可直接进 `public/maps`；内置图只读，必须用「复制当前地图」得到副本再编辑。试玩把草稿存 `zombieGame.workshop.preview.v1`，`main.ts` 在 `loadBuiltinMaps()` 后用 `compileTilesToMapDef()` 编译并 `registerRuntimeMap()` 注册为 `workshop-draft`，再进 `?map=workshop-draft#/training`，不落盘。
- 规则（训练场选图）：训练场面板顶部「地图」下拉是唯一玩家可见的选图入口，选项由 `MAP_LIST` + `BUILTIN_MAP_IDS` 分为「内置地图」与「工坊地图」两组（当前图未注册时补一组，显示名与 id 转义）。`TrainingPanel` 新增第三参 `onMapChange`，`main.ts` 的 `switchTrainingMap()` 负责 `training.reset(id)` + `reportMapFallback()` + `renderer.setMap()`；`reset()` 会重建 World / 流场 / 空间索引并清空单位、选中、armed、tool、计时与全部读数，**换图不共用会话**（房间与人类区几何按图不同，跨图保留单位可能落墙里，读数也会混算）。`#/play` 不使用该下拉，仍按 `Game.start()` 优先级（显式选择 > `LevelDef.mapId` > 当前地图）绑定；`level-1` 的 `mapId` 仍是 `arena`，选关节点 / 详情 / 开始按钮显示地图名。
- 规则（开发者模式）：开发者模式是**纯界面开关，不是安全边界**。`src/core/devMode.ts` 用 localStorage key `zombieGame.devMode.v1` 持久化；密码优先读 `.env.local` 的 `VITE_DEV_PASSWORD`（该文件被 git 忽略），缺失/为空时回退 `zb9993`，明文比较。主菜单 `#btnWorkshop` 默认 `hidden`，只由 `main.ts` 的 `syncDevModeUI()` 按状态切换；`applyRoute("workshop")` 在未开启开发者模式时用 `.map-notice` 提示并 `router.go("menu")`，退出开发者模式时若仍在工坊页也会自动回主菜单。玩家模式完全看不到工坊入口，但玩家改 localStorage 或直接构造 URL 仍可绕过。
- 规则（工坊保存只在开发态）：`vite.config.ts` 注册 `scripts/workshop-save-plugin.ts`（`apply: "serve"`），只在 `configureServer` 挂 `POST /__workshop/save`；接口只在 `npm run dev` 存在，loopback 限制与远程开关见「已知限制」中的工坊写接口条目。
- 规则（工坊保存的服务端校验）：服务端二次校验顺序 = JSON body → id 白名单（`^[a-z0-9][a-z0-9_-]{0,31}$`、保留 id `workshop-draft`）→ `map.id` 与请求 id 一致 → `validateMapJson()` + `schemaVersion === MAP_SCHEMA_VERSION` → manifest 读取与结构 → **名称全局唯一（trim、区分大小写，遍历 manifest 下所有地图 JSON 的 `name`，排除自身 id；冲突 409 `name_taken`）** → 内置只读图 403（`entry.readOnly !== false`）→ 重名未确认 409 → 备份 → 原子写入 → manifest 登记。写入失败用备份回滚（无备份则删新文件），进程内串行队列避免并发互相覆盖；manifest 已有条目只更新 `file` / `readOnly:false`，不追加重复项。备份路径与保留份数见「已知限制」中的备份策略。
- 规则（工坊按钮的空占位与剥离）：工坊编辑器按钮是**空占位 HTML** `<button id="wsSaveProject" hidden disabled>` / `<button id="wsDeleteMap" hidden disabled>`，只在 `import.meta.env.DEV` 下动态 `import("./devSave")` / `import("./devDelete")` 后设置文案 / 显示 / 绑定；生产构建不加载这两个模块，`dist` 里不应出现 `__workshop/save`、`__workshop/delete`、「保存到项目」与「删除当前地图」。
- 规则（保存 / 删除后的热刷新）：保存成功后 `resetWorkshopCatalog()` 清 manifest / 地图 JSON 缓存 → 工坊左侧地图列表重载 → `main.ts` 回调 `await loadBuiltinMaps()` 后 `trainingPanel.reloadMaps(savedId)`，不整页 reload；若 `savedId` 正是当前训练图，面板提示「切到其它地图再切回」（World 不会因保存自动重建）。删除成功后 `resetWorkshopCatalog()` + `loadBuiltinCatalog()` 重载工坊左侧地图列表，`main.ts` 的 `onDeleted` 重新 `await loadBuiltinMaps()`（会把已删 id 从 `MAPS` / `BUILTIN_MAP_IDS` / `READONLY_MAP_IDS` 移除）并刷新训练场下拉；若删的是当前训练图，立即 `switchTrainingMap("arena")` 重建 World / 流场 / 静态层，不整页 reload。
- 规则（工坊地图删除）：工坊地图删除只在开发态。`scripts/workshop-save-plugin.ts` 额外挂 `POST /__workshop/delete`（同样 loopback 限制、同一串行队列）：id 白名单 → 未知 id 404 → `entry.readOnly !== false` 403 → `getMapReferences()` 命中 409（当前 `level-1` → `arena`，未来新模式通过 `registerMapReference()` 登记）→ 备份到 `.bak/`（与保存共用每 id 最近 5 份）→ 移除 manifest 条目（2 空格缩进 + 末尾换行）→ 删除文件；写 manifest 失败会回滚。`src/workshop/devDelete.ts` 只在 DEV 动态加载，删除按钮在右侧面板（`#wsDeleteMap`，位于地图列表 / 画笔左栏之外）；客户端也会用同一 `getMapReferences()` 禁用删除并显示原因。
- 规则（名称规则）：地图 `name` 与关卡 `name` 都要求去首尾空格后 1–24 字、全局唯一且区分大小写；id 由系统生成，用户不填写，删除后名称释放。地图 id 为 `ws-<时间戳>-<4位随机十六进制>`（冲突自动换一个），客户端用已加载目录预校验（`validationErrors()`），服务端再读 manifest 下所有 JSON 二次校验；关卡 id 为 `lv-<时间戳>-<4位随机十六进制>`，服务端保存前同样做全局唯一校验。旧地图 JSON 没有 `name` 时显示 id，不阻断加载。
- 规则（多块人类区 / 僵尸区）：人类活动区 `humanZone` 与僵尸区 `spawn` 都支持**多块矩形**（JSON 数组；读取兼容旧版单个对象，保存统一写数组，`schemaVersion` 仍为 1）。语义按并集：僵尸区沿用面积加权出怪；人类活动区只决定出生点（按面积加权落在并集内），不限制后续活动范围，移动夹取仍用 `humanBounds`（由 `room` 内缩推导）。工坊用人类 / 僵尸画笔新增矩形，点选已有矩形后拖动可调整位置，选中后 `Delete` / `Backspace` 删除；画布与区域列表选中联动。
- 规则（dev 静态服务缺口）：Vite 只在启动时把已有 public 文件收进 `publicFiles`，之后新建的 `public/maps/*.json` 会被内部静态中间件跳过并落到 SPA fallback（返回 index.html）。插件在 `configureServer` 里**前置**一个只读中间件，直接从磁盘返回 `/maps/*.json`（`Content-Type: application/json; charset=utf-8`、`Cache-Control: no-cache`），这是「保存后立刻可读 / 热刷新」的前提；该中间件同样只在 dev 存在。
- 规则（追击模式分发）：丧尸追击按类型模式分发。`ZombieDef.pursuit` 取 `breach`（默认）或 `direct`（旧行为）；现有七种僵尸（普通 / 狂奔 / 胖子 / 飞扑者 / 腐蚀者 / 尖叫者 / 母体）都在定义文件显式写 `breach`。新增模式先扩 `src/data/types.ts` 的 `ZombiePursuitMode`，再到 `systems/ai.ts` 的 `pursuitModeOf()` / `retargetZombie()` / 移动分支处加分支，不改默认实现。
- 规则（按体型连通区域）：`systems/regions.ts` 的 `RegionMap` 按体型构建连通域：完好门窗为边界，破损开口仅当净宽 ≥ 身体直径才连通；`regionAt()` O(1)，`regionNear()` 处理压墙沿，边只连“完好且体型能过”的开口。探边只查开口外侧相邻一格，避免穿过一层墙生成假边。
- 规则（breach 决策）：每只僵尸以自身位置为起点独立比较两条候选——①不破东西直接过去：`World.humanFlowFor(bodyDiameter)`（活人为源、0.6s 刷新）的网格距离，等价“同连通域内绕墙追人”；②破门窗：区域邻接图 Dijkstra，边权 = 区域内绕墙走到门口的距离（`RegionMap.distanceFrom` / `distanceToOpening`，按体型缓存且随破口失效）+ `ceil(剩余hp / buildBiteDamage) * bite * 该僵尸移速`。两候选取小，回溯取第一扇开口并沿 `World.openingFlow(id, bodyDiameter)` 走过去啃。已有目标时按“到门口距离 + 剩余破拆时间折算 + 后续接近（`Zombie.goalOnward`）”实时重算，新路线需便宜 30% 以上（`GOAL_SWITCH_RATIO = 0.7`）才换；目标破碎 / 体型过不去 / 无路可走时立刻重选。无解（只剩不可破坏墙或体型过不去的窗）→ `stranded` 漫游，不贴墙顶门。全图零活人仍走原有漫游。
- 规则（飞扑者）：参数在 `leaper.ts` 的 `leap` 字段。`ai.ts` 的 `tickLeaper()` 用 `leapPhase` 推进 0 待机 / 1 蓄力 / 2 飞扑 / 3 硬直；蓄力只在 `hunt` 且非 `stranded` 时索敌 `nearestVisibleHuman(triggerRadius=120)`，原地不动；受击延长写在 `combat.ts` 的 `applyHitSlow()`（`leapTimer += hitExtend`，夹 `chargeMax=2.0`，不打断）；蓄力完成按目标当前位置锁定 `leapDX/leapDY`，以 `speed × leapSpeedMul(3)` 直线冲刺，飞行时间 = `clamp(dist / (speed×3), leapMinTime, leapMaxTime)`；撞墙 / 超时 → 硬直 `missStun=1s`。扑中写 `Human.pinTimer/pinBy` 与 `Zombie.pinTargetId`：目标 3 秒不能开火、移速 ×0.4、每秒 8 血，飞扑者原地不动；`updateHumans` 每帧校验压制者存活，死亡 / 超时 / 目标归零即 `releasePin()`。同一人类只允许 1 只压制（已压制目标按扑空处理）。飞扑者不撕咬人类，但仍可啃门窗。
- 规则（腐蚀毒液）：参数在 `corroder.ts` 的 `spit` 字段。`ai.ts` 在冷却就绪且 `range=200` 内有可见人类时调 `World.addPoison()`（落点半径 40 / 6 秒 / 6 DPS / 移速 0.8），并播 `zombie-spit`；`damageZombie` 在 `z.hp<=0` 时按 `deathRadius=48` / `deathDuration=5` 在尸体位置再补一团。毒液是 `World.poison: PoisonPool[]` 世界状态，`tickPoison(dt)` 由 `tickTerrain(dt)` 末尾统一调用：只伤害非无敌人类（`hp<=0` 才写 turning），不伤害丧尸；同点中心 ≤8px 的更强毒液替换 / 刷新弱团，`poisonEffectAt()` 对多团重叠取最大 DPS 与最小 speedMul（不叠加）；人类移速在 `updateHumans` 乘 `poisonEffectAt().speedMul`。毒液不写 `walls` / `blockers` / `bulletWalls`，因此可通行、不挡子弹与视线。训练场「清场」会清空 `world.poison`；渲染由 `renderer.ts` 的 `poisonLayer` 绘制。
- 规则（母体）：参数在 `matriarch.ts` 的 `spawner` 字段（`interval=6` / `count=2` / `cap=10` / `deathCount=12` / `childXpMul=0.7`），并置 `boss: true` / `noAttack: true`；半径 20（直径 40）只走门、过不了 16px 窗，血量 4000、移速 22。`ai.ts` 的 `tickMatriarch()` 按固定节拍推进 `spawnerTimer`，统计 `spawnedBy === z.id` 的存活子体，本轮可产 `min(count, cap - alive)` 只；每只走 `World.spawnChild()` 的 4 圈 ×16 角度环形采样（地图边界内、`solidAt` 为空、中心距 ≥ `mother.radius + 子体半径 + 4`），找不到空位就跳过、等下一轮。子体种类由 `rollMatriarchChildKind()` 从 `SURVIVAL_ZOMBIE_WEIGHTS` 的非 BOSS 项按 `base` 权重抽取；子体记 `xpMul = childXpMul`，经验由 `survivalXpFor(kind, xpMul)` 折算。死亡在 `combat.ts` 的 `damageZombie()` 里一次性产 `deathCount` 只，不受 cap 限制，并播 `zombie-spawn` / `zombie-matriarch-death`。母体不进入撕咬分支（`noAttack`，`damage=0` 双保险），但仍参与 breach 破门窗。
- 规则（尖叫者）：参数在 `screamer.ts` 的 `scream` 字段（`interval=8` / `radius=200` / `duration=6` / `speedMul=1.3` / `damageMul=1.5` / `damageTakenMul=0.7`），`noAttack: true`、`damage=0`。`ai.ts` 的 `tickScreamer()` 到点后遍历半径内其他僵尸，排除自身与 `effectiveZombie(o.kind).boss`，把移速 / 攻击 / 承伤倍率写成快照并刷新 `buffTimer`；`tickZombieBuff()` 每帧倒计时，归零后三项倍率重置为 1。多只尖叫者只取最强倍率并刷新计时，不叠加。倍率进入 `updateZombies` 的移速、撕咬伤害 `z.damage * z.buffDamageMul` 与 `damageZombie` 的承伤 `dmg * z.buffTakenMul`；被强化单位由渲染层加粉紫染色与脚下脉动粉环（`Zombie.buffTimer > 0`）。
- 规则（全局 BOSS 血条）：`World.bossBarInfo()` 遍历存活僵尸中 `getZombieDef(kind).boss === true` 的单位，取当前血量最高的一只并返回存活总数；`Renderer.render()` 末尾调 `renderBossBar()` 更新 DOM 覆盖层（`.boss-bar`，绝对定位在画面顶部，不随 Pixi 镜头缩放）。菜单 / 选关的冻结渲染通过 `RenderExtra.hideBossBar` 隐藏；求生模式复用同一血条作为 BOSS 进度条。
- 规则（精灵网格与缩放）：`SpriteDef.grid` 声明网格尺寸（默认 32×32，母体 64×64）。`pixel.ts` 的 `spriteScale(diameter, def)` 以 `Math.max(grid.w, grid.h)` 为基准，`spriteAnchor(def)` 用 `anchor / grid` 归一化；`renderer.ts` 的贴图池、死亡帧与 `muzzleWorld()` 都按对应 `def` 取锚点与缩放，禁止写死 `SPRITE_SIZE` / 32，否则大网格精灵会被放大且锚点偏移。
- 规则（关卡数据）：`public/levels/manifest.json` + `<id>.json` 是关卡运行时来源，结构与地图 manifest 同构；关卡只存 `id` / `name` / `mapId` / `mode: "placement"` / `humans` / `waves`（可选 `settings` 兼容块），不复制地图数据。`src/data/levels/schema.ts` 的 `validateLevelJson(raw, ctx)` 同时服务浏览器与 dev 服务端（`LevelValidationContext` 可注入地图 / 武器 / 僵尸 id 集合）。加载失败或校验不通过回退 `src/data/levels/level-1.ts`，`main.ts` 先 `await loadLevels()` 再 `refreshLevelDefs()`。
- 规则（人类 = 武器）：人类种类就是武器种类（`mg` / `flame` / `shotgun` / `rocket` / `tesla` / `sniper`），没有手枪；`humans` 每项含 `enabled` / `hp` / `initial` / `cap` / `regen`，同武器全局一档血量。`LEVEL_WEAPON_ORDER` 是编辑器与默认配置的展示顺序；新增武器要同步它。
- 规则（选关与解锁）：主菜单「放置抵抗」→ `#/levels`；列表按 `LEVEL_LIST` 顺序展示。玩家模式解锁条件 = 首关，或 `progress.beaten` 包含上一关 / 旧 `unlocked`；开发者模式全开且出现「新建 / 编辑 / 复制 / 删除」。进度 key 仍为 `zombieGame.progress.v1`，`recordBeaten(levelId, LEVELS.map(l => l.id))` 会按清单解锁下一关；旧存档的 `level-1` 通关记录自然沿用。`#/play?level=<id>` 未知 id 回退 `#/levels` 并提示。
- 规则（局内流程）：`Phase = "prepare" | "wave" | "intermission" | "victory" | "defeat"`；准备阶段渲染人类区 / 僵尸区并显示库存面板，`beginBattle()` 未放置人类返回 false。`placeHuman()` 先判 `humanZone` 再判 `world.solidAt(x, y, 0, HUMAN_BODY_DIAMETER)`，失败不扣库存；成功后 `attachPost()` 以落点即守岗点、朝向最近开口。库存每种独立计时、满仓停表，`tick` 在准备阶段也跑 AI 与恢复，暂停不跑。
- 规则（人类两种模式 + 躲毒液）：`World.mode` 由 `Game` 每帧同步，顶栏「防守 / 进攻」切换；`Human.post >= 0` 时 `updateHumans` 走守岗分支。防守 = 站岗，僵尸进 60px 或岗位点 48px 内有僵尸才全速后撤，脱身归岗；进攻 = 向最近可见僵尸推进到 `range × 0.85`，贴到 `range × 0.4` 才后撤。两种模式都先判脚下的 `poisonEffectAt()`：中毒时用 `findPoisonEscape()` 找 24–120px 内最近的可站立、无毒落点（`Human.safeX/safeY/safeTimer`），躲开即恢复原行为。除这三类（躲毒 / 进攻推进 / 岗位被占）外不移动；`guard` 只有类型定义，行为回落防守。求生模式 `manual` 玩家不自动躲。
- 规则（胜负）：胜利 = `wave >= waveCount && spawnLeft === 0 && zombies === 0`；失败 = `placedAny && humans.length === 0`（turning 仍算存在）。未放置过人类不判负，只提示「至少放置一名人类」。波次内容来自关卡 `waves`，`beginWave(n)` 把 `wave.zombies` 展开进 `waveQueue`，`spawnOne()` 按队列取 kind；生成速率与同屏上限仍读 `settings().wave` 并受关卡 `settings` 覆盖。
- 规则（快捷键）：play 路由 `1–6` 选择人类种类，`Space` 暂停、`R` 重开；速度只用顶栏按钮循环（1x/2x/4x/8x）。
- 规则（关卡编辑器）：`src/levelEditor/page.ts` 是整页弹层，`main.ts` 只在 `import.meta.env.DEV` 动态导入并实例化（生产构建不包含编辑器代码 / 接口路径 / 保存删除文案）。列表按钮 → `levelEditor.open("new"|"edit"|"copy", id)`；只读关只给「复制」。保存 / 删除后 `resetLevelCatalog() → loadLevels() → refreshLevelDefs() → refreshLevelsPage()` 热刷新，不整页 reload。
- 规则（关卡 dev 接口）：`scripts/workshop-save-plugin.ts` 在 dev 注册 `/__levels/save` 与 `/__levels/delete`，与工坊共用 loopback 限制、串行队列、原子写入与备份；服务端校验顺序 = JSON → id 白名单 → `level.id` 一致 → `validateLevelJson`（地图 id 来自地图 manifest）→ 名称全局唯一（trim、区分大小写，冲突 409 `name_taken`）→ 只读保护 → 重名确认 → 备份 → 写入 → manifest 登记。删除额外查 `getLevelReferences()`。
- 规则（局内布局）：play 路由给 `body` 加 `placement`；`.frame` 改为两列 grid（画布 `1fr` + 库存 252px），`.inv-panel` 用 `grid-area: inv`，画布按剩余宽度等比缩放，不再覆盖；`max-width: 900px` 时 `.frame` 改 flex 纵向、面板 `align-self: stretch` 底部横排。`InventoryPanel.syncStartButton()` 在非准备阶段直接 `remove()`「开始」按钮，重开回到 prepare 时重建，不靠禁用或 `hidden` 类。
- 规则（模式差异）：开发者专属按钮一律按 `isDevModeEnabled()` 条件渲染，玩家模式整组不渲染（不是禁用变灰）。`#/levels/edit?id=<id>` 由 router 映射到 `levels` 路由：未开开发者模式 `showMapNotice` 后 `router.go("levels")`，已开启则编辑（只读关转复制 / 未知 id 转新建）。`applyRoute` 离开 `levels` 时自动 `levelEditor.close()`，`syncDevModeUI` 关闭开发者模式时也会关闭编辑器。
- 规则（工坊地图列表）：左栏 `#wsMapGroups` 常驻列表，分「内置地图（只读）」与「我的地图」，项只显示名称（内置图带只读标记）。`loadMapFromCatalog()` 切图前走 `confirmDiscard()`：`dirty` 在 `handleDocChange`、名称输入与门窗参数编辑时置位，切图 / 新建 / 复制 / 显式保存后清零。新建用 `createBlankDoc()`，复制用 `cloneDoc()`（内置图也可复制），副本名 `uniqueName(原名 + " 副本")` 且参与全局唯一校验；切图同时 `resetEditorState()` 清选中项与工具。
- 规则（尸潮求生）：独立路由 `#/survival`，会话在 `src/survival/session.ts`，拥有自己的 `World`，不复用 `Game` / `TrainingSession`。进入后先选地图（`SurvivalUi.showSelect()`），默认 `open-field`；玩家模式可玩所有已注册地图，开发者模式额外显示「打开地图工坊」。`main.ts` 的 ticker 在 `survival` 路由下持续跑固定步长并 `renderer.setCamera(player.x, player.y, SURVIVAL.cameraZoom)`，离开路由时 `survival.stop()`、`renderer.setCamera(null)`、清空 `heldKeys`。
- 规则（玩家单位）：单个人类，初始武器 `mg`，最多同时持有 2 把（`SURVIVAL.maxWeapons`），血量 / 移速沿用 `HUMAN_DEF`；`Human.manual = true` 让 `ai.ts` 跳过闲逛 / 归岗 / 进攻走位，直接按 `moveX/moveY` 走逐轴碰撞，并用身体半径夹在地图边界（`freeBounds`）。自动索敌与开火仍走 `updateHumans` → `nearestZombie` → `tryFire`，朝向跟随目标。只额外覆盖 `spreadOverride`（收窄散布）与 `damageTakenMul`（降承伤），不复制战斗逻辑。
- 规则（双武器与额外投射物）：副武器存 `Human.weapon2 / ammo2 / reload2 / fire2 / burst2`，与主武器各自独立计时；`tryFire(world,h,angle,slot)` 与 `updateFlame(world,h,dt,slot)` 的 `slot` 取 0/1，`slotState()` 返回读写闭包。`Human.extraProjectiles`（0..4）在 `tryFire` 内展开：机枪 / 火箭 `1+extra` 条弹道（角度间隔 0.05），霰弹 `pellets+extra` 颗，电击枪 `1+extra` 道弧线且每道独立 `findTeslaFirst`、起始角度抖动 ±0.09 弧度，链式仍受 5 跳上限。暴击由 `critRoll()` 读 `critChance / critMul`，在弹丸、电弧首目标与火焰每 tick 结算。升级池与上限集中在 `src/data/survival/config.ts`（`extraProjectileMax = 4`、`baseCritMul = 1.5`、`basePickupMul = 1`）。
- 规则（穿透 / 曳光 / 换弹音效）：`WeaponDef` 的可选 `pierce`（`maxTargets` / `falloff`）、`tracer`（拖尾像素）、`hitSlowMul`（减速加深倍率）由 `combat.ts` 统一消费。穿透弹在 `updateCombat` 中按线段命中顺序结算：`hitIds` 防止同一目标跨帧重复结算，`pierceLeft` 用尽即消失（狙击枪最多 2 个目标，第二个 ×0.6）。曳光只在 `Renderer.renderTracers()` 里按 `Bullet.tracer` 画线；血雾是 `kind: "blood"` 特效。所有实际换弹入口（弹匣打空 / 待机空仓 / 电击枪打空）统一调 `beginReload(h, slot, def)`，`weapon-reload` 在此触发并受 `SFX_THROTTLE.RELOAD`（1000ms）限频；喷火枪打空是散热，不播换弹音效。
- 规则（经验与升级）：击杀经 `World.onKill` 掉经验球（`SURVIVAL.xp.dropChance`），玩家 `48 × pickupMul` 内吸附；`addXp` 满 `xpNeedFor(level)` 时 `pendingLevelUps++`，tick 末尾 `beginChoice()` 把状态切到 `choosing` 并暂停世界。`rollChoices()` 随机抽 3 个不重复项，武器满级 / 已持有 2 把时过滤武器项，`maxStacks` 已满时过滤（如额外投射物 4 层）。选择后 `syncPlayerStats()` 重算 `dmgMul = attackMul × 武器倍率 × baseDamageMul`、`cdMul = fireRateMul × 武器冷却倍率`、`speedOverride`、`maxHp`、`critChance / critMul / lifesteal / pickupMul`；「获得新武器」走二段选择 `chooseWeapon()` / `consumeChoice()`。奖励可重复、永久累乘。
- 规则（出怪与难度）：`spawnOne()` 只从可通行落点里抽（`World.findFreeSpot`），要求离玩家 ≥320px 且屏幕外（`|dx| > viewW/2 + 24 || |dy| > viewH/2 + 24`）；每 30 秒一档，出怪间隔、同屏上限与僵尸血量倍率（每档 +8%，封顶 2.5 倍）按 `SURVIVAL.spawn` / `difficulty` 推导；僵尸种类权重由 `SURVIVAL_ZOMBIE_WEIGHTS` 按玩家等级驱动（权重 = `base + perLevel × (等级 - startLevel)`，未到 `startLevel` 不出现）。飞扑者 2 级起（权重略低于同级狂奔），尖叫者 3 级起，腐蚀者 4 级起（权重最低）。BOSS 不进入普通权重，由 `SURVIVAL_BOSS_POOL` 单独投放（母体 8 级首次出现、之后每 180 秒尝试、同屏最多 1 只；存活时计时停在 0，死亡后重新计时）。忽略地图的人类区 / 僵尸区语义。
- 规则（求生池与模式覆盖表）：求生与其他模式的平衡互相独立。僵尸普通出怪权重表 `SURVIVAL_ZOMBIE_WEIGHTS`、BOSS 投放表 `SURVIVAL_BOSS_POOL`、武器池 `SURVIVAL_WEAPON_POOL`、按模式数值覆盖表 `SURVIVAL_ZOMBIE_OVERRIDES` 与经验表 `SURVIVAL_XP_BY_KIND` 都在 `src/data/survival/config.ts`；**不改基础僵尸 / 武器定义文件**。`SurvivalSession.start()` 调 `setZombieModeOverrides(SURVIVAL_ZOMBIE_OVERRIDES)` 启用，`stop()` 传 `null` 回退基础定义（`effectiveZombie()` 的优先级：玩家覆盖值 > 模式覆盖表 > 基础定义，`leap` / `spit` / `spawner` / `scream` 只合并定义里已存在的字段）。求生当前取值：飞扑者压制 1.5s / 4 DPS，腐蚀者毒液 4 DPS；母体产卵与尖叫强化沿用基础定义。新增模式只需再提供一份 `ZombieModeOverrideTable`。
- 规则（空地地图与校验）：`open-field` 是 74×45 全空地，`openings: []`。`validateMapJson()` 仅在「整张画布无墙且无任何门窗」时豁免「至少 1 扇门 / 至少 1 格墙体」，其余地图规则不变；`openingTuning()` 对空 openings 返回 `doorHp = 0`、`winHp = 0`、`winPassSpeed = 1` 兜底。
- 规则（渲染与记录）：经验球通过 `RenderExtra.orbs` 传入 `Renderer.render()`，由新增的 `pickupLayer` 画呼吸光晕；`Renderer.setCamera()` 变换舞台并在渲染时按地图边界夹取。最佳记录 key 为 `zombieGame.survival.v1`，只存 `bestTime` / `bestLevel`。
- 规则（快捷键与焦点）：survival 路由 `WASD` / 方向键写 `heldKeys`，`Space` 暂停 / 继续（同时识别 `code === "Space"` 与 `key === " "`），`R` 重开，`choosing` 时 `1–3` 选卡；点击「开始求生」与升级卡后 `document.activeElement.blur()`，并在 survival 路由对 `Space` keyup `preventDefault()`，避免残留焦点按钮被空格再次激活。

## 已知限制

- 重开与重新进入完全清零；玩家被墙围住或经验球落到不可达区域时没有补救机制。
- 求生模式没有对局内数值滑块；升级三选一不可刷新 / 跳过。双武器最多 2 把，副武器只显示在 HUD 芯片、不体现在角色精灵上；额外投射物最多 4 层，电击枪每层只多一道弧线且链式仍受 5 跳上限。
- 地形只在地图瓦片层生效：草丛 / 水池需在地图 JSON 或工坊 / 训练场画出，正式对局不能运行时新增；草丛燃烧 / 休眠 / 重生计时全局统一（1.5 / 10 / 1 秒），没有逐格差异。水池按设计不挡子弹与视线，只阻挡单位与寻路。
- 飞扑者只按「看得见」判断蓄力与扑击，不做区域路径规划：目标隔完整门窗时仍可能起跳，撞墙即扑空并硬直 1 秒；扑击途中不绕路。同一人类同时只能被 1 只压制，第二名飞扑者扑到已压制目标按扑空处理。飞扑者不撕咬人类，但仍会啃门窗。
- 压制伤害与毒液伤害不计入训练场「人类被咬次数 / 掉血」统计（该口径只统计丧尸撕咬与人类武器输出）；观察时以头顶血条与实际掉血为准。
- 飞扑者 / 腐蚀者的专属参数在 `#/tuning` 的「僵尸·飞扑者 / 腐蚀者」分区可调（蓄力时长、扑击倍率、压制时长与 DPS、毒液半径 / 持续 / DPS / 减速等），基础默认值仍在 `src/data/zombies/leaper.ts` / `corroder.ts`；求生模式的差异值在 `src/data/survival/config.ts` 的 `SURVIVAL_ZOMBIE_OVERRIDES`（优先级高于基础定义）。训练场只能逐单位调血量 / 移速 / 咬人间隔 / 攻击力。腐蚀者 `damage=15` 只用于它自己的撕咬。
- 毒液按连续伤害结算（每帧 `dps × dt`），没有逐秒跳字；不伤害丧尸、不影响僵尸寻路与索敌；不能在对局运行时手动添加（只能由腐蚀者吐毒 / 死亡或调试代码产生）。求生出怪池已接入飞扑者（2 级起）与腐蚀者（4 级起），求生的压制 / 毒液数值走 `SURVIVAL_ZOMBIE_OVERRIDES`。
- 母体 / 尖叫者的专属参数在 `#/tuning` 的对应分区可调（产卵间隔 / 数量 / 上限 / 死亡产卵 / 子体经验、尖叫间隔 / 半径 / 持续 / 三项倍率），基础默认值仍在 `src/data/zombies/matriarch.ts` / `screamer.ts`，求生差异走 `SURVIVAL_ZOMBIE_OVERRIDES`；训练场只能逐单位调血量 / 移速 / 咬人间隔 / 攻击力。两者 `damage=0` 且 `noAttack`，训练场观察不到它们撕咬人类。
- 母体产卵受落点限制：环形 4 圈 ×16 角度全部被墙 / 单位占满时本轮一只都不产，不会叠在墙里或母体身上。子体上限只统计「由该母体产出且存活」的个体，死亡产卵的 12 只不受该上限约束；多只母体各自独立计时与计数。母体半径 20 只走门，16px 窗即使破损也过不去。
- 多只母体时顶部血条只展示当前血量最高的一只并在名称后标总数，不并列显示多条；血条是 DOM 覆盖层，不随 Pixi 镜头缩放，也不响应点击。菜单 / 选关的冻结渲染通过 `hideBossBar` 隐藏。
- 尖叫强化是快照倍率、不叠加：多只尖叫者只取最强的一组并刷新 6 秒计时；不强化 BOSS 与自身；离开半径不会立刻失效，会持续到 6 秒结束。强化标识是粉紫染色 + 脚下脉动粉环，没有数字 / 图标提示。
- 求生 BOSS 投放是「达到 8 级后开始计时、每 180 秒尝试一次、同屏最多 1 只」：首只可能因找不到屏幕外落点而推迟到下一轮；BOSS 存活时计时停在 0，死亡后重新开始 180 秒计时。母体产出的子体同样按 70% 经验折算（求生经验球读 `Zombie.xpMul`）。
- 地图若没有人类区，出生点取地图中心，仍走 `findFreeSpot`。
- 局内布局在窗口宽度 ≤ 900px 时库存面板改为底部横排；880×720 这类更小的窗口需要纵向滚动才能看到完整面板。
- 工坊「未保存改动」以 `dirty` 标记为准（自上次载入 / 显式保存后是否有编辑），自动写入 localStorage 的草稿不算“已保存”；切图确认后草稿会被新图覆盖。
- 人类会真实掉血，但血量归零不会立刻死亡，而是进入约 2.8 秒的转化倒计时；训练场可调人类血量与僵尸攻击力来观察。
- 电击枪首个目标的单体加成按“96px 内是否有其他存活僵尸”判断，不检查它们是否被墙挡住；链式参数默认值只在 `src/data/weapons/tesla.ts`，可在 `#/tuning` 的「武器·电击枪」分区覆盖。
- 僵尸血量 / 移速 / 啃咬间隔 / 攻击力全部在 `#/tuning` 的 7 个僵尸分区可调，默认值在 `src/data/zombies/*.ts`；僵尸碰撞半径只读展示，避免影响碰撞、区域图与开口净宽。
- breach 追击的区域层级只看“门窗通不通”，破拆耗时按 `剩余hp / buildBiteDamage * bite` 估算，未计入多只僵尸同时啃食加速，也没有“拥挤排队”惩罚（多只僵尸仍可能同时选到同一扇最便宜的门）；区域内距离用 4 邻域网格步长近似，斜向会略高估。`direct` 模式仍是旧的全局最近人类直扑。
- 无 BGM；只有一次性音效，且同一事件全局限频，**没有随机音效变体**（音高/时长变化）。
- `weapon-reload` 已接入 `beginReload()`（弹匣打空 / 待机空仓 / 电击枪打空）；`human-hurt` 已声明、文件已备好，但当前没有调用点。
- 内置 2 关（`level-1`「初次尸潮」，8 波共 1186 只；`level-2`「全面沦陷」，12 波共 1936 只，含第 11 / 12 波母体）与 5 张只读地图（`arena` / `corrupted-block` / `test-yard` / `test-multi` / `open-field`），另有 dev 期保存的工坊图（如 `my-map`）。开发者可在 dev 下新增关卡 / 地图，保存后直接进入对应列表；内置关卡只能复制。地图 JSON 支持固定 `74×45` / `16px` 画布、任意数量门窗（完全空白的画布允许 0 扇门）与多块人类区 / 僵尸区。
- 正式对局的人类补充完全依赖库存恢复，不再有「每波补 1 人」；库存恢复在准备阶段也走表，暂停时不恢复。
- 胜负：放置模式胜利 = 打完全部配置波次，失败 = 已放置过人类后场上无人类；尸潮求生只有失败（玩家血量归零），没有胜利条件。其它模式的胜负规则只预留了引用 / 进度 key。
- 编辑器不能改关卡 id，也不能编辑内置关卡的 `settings` 兼容块（需手改 JSON）。
- 关卡编辑器的保存 / 删除在 `npm run preview` / `dist` 下接口 404、按钮不存在；`VITE_WORKSHOP_ALLOW_REMOTE=1` 会把关卡写接口暴露给局域网，仅限可信网络。
- 开口参数优先级：玩家在 `#/tuning` 的覆盖值 > 本局关卡 `settings` > 每扇门窗 JSON 自身的 `maxHp / passSpeed`。关卡值走独立的 `levelOverrides` 层，`Game.start()` 写入、离开 `#/play` 时由 `clearLevelOverrides()` 清空，不会残留到数值面板或下一关。逐扇独立覆盖 UI 属于后续阶段。
- 求生页不提供地图编辑器：新建 / 编辑地图仍要回工坊。
- 主菜单「清空存档」只清玩法进度（放置抵抗关卡进度、尸潮求生最佳记录、预留的 `zombieGame.challenge.*`），保留音量偏好与参数覆盖值。
- 工坊「保存到项目 / 删除地图」只在 `npm run dev` 可用：`npm run preview` / `dist` 没有接口和按钮；默认只接受 loopback，`npm run dev --host` 暴露给局域网后保存 / 删除会 403，除非显式设 `VITE_WORKSHOP_ALLOW_REMOTE=1`（此时任何能访问 dev server 的人都能写 / 删 `public/maps` 与 `public/levels`，仅限可信网络）。
- 工坊保存只写 `public/maps/<id>.json` 与 manifest，**不创建关卡**；关卡编辑器保存只写 `public/levels/<id>.json` 与 manifest，**不创建新的模式入口**。新地图要进正式对局需给关卡 JSON 写 `mapId`。
- 备份只在本机 `public/maps/.bak/` 与 `public/levels/.bak/`，每个 id 留最近 5 份且被 git 忽略；`vite.config.ts` 的 build-only 插件会在构建后删除 `dist` 内的 `.bak`。保存 / 删除都不 reload 当前训练会话，覆盖或删除当前训练图时要切走再切回（删除当前训练图会自动切回 `arena` 并重建 World）。
- `npm run regression` 覆盖 29 个逻辑场景（开口通行 / 碰撞 / breach / 求生经验与目标 / JSON 校验 / 地形 / 双武器 / 额外投射物 / 狙击穿透与减速 / 飞扑蓄力与压制 / 腐蚀毒液 / 腐蚀者吐毒与死亡留毒 / 母体产卵节奏与上限与不撕咬 / 母体死亡产卵与子体经验折算 / 尖叫强化与不强化 BOSS 与自身 / 求生池守卫 / 覆盖层提升后基础值不变 / 子配置与武器扩展字段可覆盖 / 关卡覆盖只作用于本局 / 非开发者默认无权进入 / 求生 ESC 暂停 / 暂停菜单退出不结算），但不覆盖渲染、输入与 DOM；`npm run build` 只保证类型与打包，行为正确性仍需浏览器实跑。
- 美术只有朝上的单套帧，运行时按朝向旋转，任意角度会有轻微锯齿；特效/场景装饰仍由 Pixi 代码绘制。
- 碰撞只按躯干圆处理：人类武器枪管、丧尸头饰等装饰不参与碰撞，贴墙时可能少量越入墙面；这是美术层表现，不影响移动与通行。
- 桌面版（Electron）产物未签名、未公证，macOS 首次启动需 Control + 打开或到「隐私与安全性 → 仍要打开」，Windows 需 SmartScreen「仍要运行」；正式分发前必须签名 + 公证。
- 桌面版不包含地图工坊保存 / 删除（生产构建已剥离 dev 接口），也不加载 dev server；改地图仍需在 `npm run dev` 的工坊里保存后重新打包。桌面版用户地图目录（`app.getPath("userData")/maps`）仍在待评估。
- 桌面版主进程只在 `127.0.0.1` 随机端口服务打包内的 `dist`，不对外提供 HTTP；窗口 1280×720 / 最小 960×600，关闭窗口即退出（所有平台一致），没有托盘驻留与自动更新。产物 `release/` 已 gitignore，图标源资产在 `build/`。
