# TODO

按优先级记录待办事项。完成一项后把对应内容挪到文末「已完成」，并在提交里同步 `CHANGELOG.md`。

## 交付约定

新增**僵尸 / 武器 / 地图 / 关卡**时必须同时交付以下内容，缺一不算完成：

- 代码：实体定义 + 注册表登记（僵尸 `src/data/zombies/`、武器 `src/data/weapons/`、地图 `public/maps/` + manifest、关卡 `public/levels/` + manifest）。
- 求生池：新增僵尸登记 `src/data/survival/config.ts` 的 `SURVIVAL_ZOMBIE_WEIGHTS`（按需加 `SURVIVAL_ZOMBIE_OVERRIDES`），新增武器登记 `SURVIVAL_WEAPON_POOL`；漏登记会被回归的求生池守卫判失败。
- 精灵：`src/art/` 里的 32×32 像素精灵与全部动画帧，并在 `sprites.html` 核对 anchor / muzzle / footprintRadius。
- 音效：`public/audio/` 文件 + `src/audio/events.ts` 三处登记 + `public/audio/CREDITS.md` 授权台账。
- 文档：同步更新 `README.md`、`CHANGELOG.md`、`AGENTS.md`。
- 验证：`npx tsc --noEmit`、`npm run build`、`npm run regression`，并在训练场 / 选关页实跑。

## 待办

### 高优先级

（暂无）

### 中优先级

（暂无）

### 低优先级

（暂无）

## 已完成

- **0.8.3 僵尸行为重做**：飞扑者改为纯飞扑 + 附身压制（5 秒 / 4 DPS，可被击杀或计时挣脱，求生连点方向键可压到 1.5 秒），碰撞体放大到直径 11；腐蚀者改为抛物线毒液弹（0.6–0.8 秒飞行，落地才生成毒液）；腐蚀者 / 尖叫者 / 母体改为距离维持（200 / 250 / 350），母体退到地图边缘就地停下继续产卵。
- **0.8.1 桌面版打包（Electron）**：`electron/main.cjs` 在 `127.0.0.1` 随机端口起只读静态服务指向 `dist`（不用 `file://`，保证地图 / 关卡 JSON 的 fetch 正常），窗口 1280×720 / 最小 960×600、关闭即退出；`electron-builder` 配置 macOS dmg 与 Windows NSIS，产物在 `release/`；`npm run app:build` / `app:build:win`；应用图标 `build/icon.png` / `.icns` / `.ico`。不签名、不公证，不包含桌面版工坊保存。
- **0.8.0 地形系统**：新增草丛 / 水池瓦片与 `MapDef.grassTiles / waterTiles / waterBlockers`；草丛移速 ×0.8、人类索敌 ×0.5，喷火点燃 1.5 秒后效果失效，熄灭 10 秒后 1 秒渐隐重生；水池阻挡单位与寻路但不挡子弹与视线；工坊与训练场新增地形画笔与擦除。
- **0.8.0 尸潮求生升级扩展**：新增「获得新武器」二段选择（最多同时持有 2 把，独立冷却与同帧开火）、额外投射物最多 4 层、暴击率 / 暴击伤害 / 击杀吸血 / 经验拾取范围，并上调出怪同屏上限与僵尸血量成长。
- **0.8.0 回归脚本**：`scripts/regression/`（Node + esbuild 加载真实模块）与 `npm run regression`，10 个场景覆盖开口通行、人类碰撞、breach 破门、求生经验与目标、地图 / 关卡 JSON 校验、草丛与水池、双武器与额外投射物。
- **0.8.0 音效替换**：`zombie-growl-fat` → freesound 643766 / SnowFightStudios，`weapon-tesla` → freesound 488664 / Nodgez，18 个音效全部为 CC0 实录（提交 `6d2279d`）。
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
