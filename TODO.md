# TODO

按优先级记录待办事项。完成一项后把「状态」改为「已完成」，并在对应提交里同步 `CHANGELOG.md`。

## 交付约定

新增**僵尸 / 武器 / 地图**时必须同时交付以下内容，缺一不算完成：

- 代码：实体定义文件 + 注册表登记（僵尸 `src/data/zombies/`、武器 `src/data/weapons/`、地图 `public/maps/<id>.json` + `public/maps/manifest.json`，并在 `src/data/maps/index.ts` 注册）。
- 精灵：`src/art/` 里的 32×32 像素精灵与全部动画帧（含死亡/开火等），并在预览页核对 anchor / muzzle / footprintRadius。
- 音效：`public/audio/` 的音频文件 + `src/audio/events.ts` 的事件、`SFX_MAP`、`SFX_THROTTLE` 登记，并在 `public/audio/CREDITS.md` 补授权台账。
- 文档：同步更新 `README.md` 与 `CHANGELOG.md`。
- 训练场：确认新实体在训练场单位库自动出现、可生成、统计列正常。

## 高优先级

### 0.5.0 地图工坊阶段 2：工坊编辑器（本体已完成）

- 优先级：高
- 状态：编辑器本体已完成（`#/workshop` 直达）；剩余主菜单入口 / 开发者模式（阶段 4）与放置模式选图（阶段 3）
- 说明：独立 `#/workshop` 整页 UI，按 16px 网格绘制空地 / 墙 / 门 / 窗 / 人类区 / 出生区，设置每扇门窗的血量 / 通行速度；草稿 localStorage、导入导出 JSON、另存副本、强校验与错误定位、`compileTilesToMapDef()` 即时编译与 `?map=workshop-draft` 试玩均已实现。
- 约束：`arena` 内置只读；加载期非法地图回退默认图；错误要能定位到格子；画布固定 74×45，不做自定义尺寸。
- 涉及模块：`src/workshop/`、`src/data/maps/schema.ts`、`src/data/maps/index.ts`、`index.html`、`src/style.css`、`src/router.ts`、`src/main.ts`。

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
- 状态：部分具备（地图 JSON 加载、`LevelDef.mapId`、`Game` / `TrainingSession` 地图注入已完成；玩家可见的选图 UI 未做）
- 说明：注册表已能从 manifest 加载多张地图，`level-1` 通过 `mapId` 指向 `arena`，调试可用 `?map=<id>`；正式选图界面、地图解锁与 HUD 展示仍未实现。
- 涉及模块：`src/data/maps/`、`src/levels.ts`、`src/router.ts`、选关与 HUD。

### 地图工坊（瓦片地图编辑器）

- 优先级：待定
- 状态：进行中（阶段 0 地图 JSON 化、阶段 1A 地图注入、阶段 2 工坊编辑器本体已完成；剩余阶段 3 选图与阶段 4 开发者模式入口）
- 分层定位：工坊是**内容生产工具**，不是玩家功能。开发者模式可见并可新增地图；玩家模式只提供已发布地图的游玩，界面不出现工坊入口。
- 权限边界：纯浏览器游戏没有后端账号，开发者模式只能做到「界面隐藏」，**不是安全边界**——玩家改 localStorage 或直接访问 URL 仍可进入。若未来需要真隔离，得走服务端发布或维护两套构建产物；文档里写明这一点，避免后来者误以为有权限校验。
- 数据形态：瓦片 JSON 只作编辑 / 存储格式，加载时编译回 `walls[] + openings[]` 的 `MapDef`；运行时读 `public/maps/*.json` + manifest。开发者产出走「导出 JSON → 进仓库 `public/maps/` + 更新 manifest → 随版本发布」；localStorage 只作草稿，不能当成发布。
- 校验：编辑期提示 + 保存前强校验 + 加载期非法回退默认图，错误尽量定位到格子。
- 已确认决策（照此执行，不再回头确认）：
  1. **数据**：瓦片 JSON 只作编辑与存储格式，加载时编译成现有 `walls[] + openings[]`；`World` / 流场 / 渲染结构不动。
  2. **网格**：16px 一格，画布固定 `74 × 45 = 1184 × 720`，不做自定义尺寸。门窗宽度必须落在 16 的整数倍：门 80 = 5 格；窗取 16 = 1 格（原 18）。通行规则「净宽 < 体宽不可通行」不变，胖子仍过不去。
  3. **开口**：每扇门窗有独立 `id`、宽度、默认血量、通行速度；玩家全局覆盖仍按「门 / 窗」种类生效。
  4. **区域**：地图显式标记出生点与人类可行区，不推断哪边是外侧；出生点不要求墙外，但必须落在可通行格且不与人类区冲突。
  5. **存储**：`public/maps/*.json` + manifest，运行时加载；localStorage 只作草稿（后续阶段用）。
  6. **校验**：编辑期提示 + 保存前强校验 + 加载期非法回退默认图，错误能定位到格子。
  7. **只读内置图**：`arena` 作为内置只读地图，工坊只能另存副本。
  8. **开发者模式**：设置里输入密码切换；密码明文可接受；放 gitignore 文件（可用 `.env.local` 的 `VITE_` 前缀）；默认密码 `zb9993`。密码与切换 UI 属后续阶段，本轮只记录决定。
- 开发顺序：①地图 JSON 化（阶段 0，已完成）→ ①.5 地图注入（阶段 1A，已完成）→ ②工坊编辑器（阶段 2，已完成）→ ③放置模式选图 → ④开发者模式入口 / 闯关模式（关卡 = 地图 + 波次 + 目标，工坊只管前半段）。
- 涉及模块：`src/data/maps/schema.ts`、`src/data/maps/compile.ts`、`src/data/maps/index.ts`、`src/core/world.ts`、`src/systems/flowField.ts`、`src/core/game.ts`、`src/render/renderer.ts`、`src/training/`、`src/levels.ts`、`src/main.ts`、`index.html`、`src/style.css`。

### 建筑模组：草丛与水池（0.5.1，整块推迟但需求已确认）

- 优先级：待定（排在工坊编辑器之后）
- 状态：待办
- 说明：作为新的瓦片类型加入 schema（字符待定），编辑器可绘制；实现时通行、视线、射线、流场、渲染与训练场都要接入，不能只改一格判定。
- **草丛**：
  - 绿色，可通行。
  - 人类 AI 索敌半径按原视野的某个比例缩短（比例在实现阶段给建议值）；玩家视角不变；僵尸索敌不受限。
  - 双方在草丛中通行都会略微减速（幅度在实现阶段给建议值）。
  - 喷火器灼烧 1–2 秒后草丛暂时失效：颜色变浅；隔一段时间重新长出并恢复颜色（重生时长在实现阶段给建议值）。
- **水池**：
  - 蓝色；人类与僵尸均不可通行（暂时等同墙体）。
  - 子弹与闪电射线可穿过。
  - 不影响视野。
- 涉及模块：`src/data/maps/schema.ts`、`src/data/maps/compile.ts`、`src/core/world.ts`（通行与实心判定）、`src/systems/ai.ts`（人类索敌 / 移速）、`src/systems/combat.ts`（喷火清草、子弹与射线放行）、`src/systems/flowField.ts`、`src/render/renderer.ts`、`src/training/`。

### 开发者模式（密码切换，后续阶段）

- 优先级：待定（阶段 4；工坊编辑器本体已在阶段 2 完成）
- 状态：待办
- 说明：设置面板增加开发者模式开关；玩家模式输入密码后切换。密码明文可接受，默认 `zb9993`；优先放 `.env.local` 的 `VITE_DEV_PASSWORD`（`.env.local` 已在 gitignore 中，打包后仍会出现在产物里，属于已接受的取舍）。
- 边界：仅 UI 隐藏，不构成安全边界；不对外宣传密码。
- 涉及模块：`src/main.ts`、`index.html`、`src/style.css`、`src/data/settings/`。
