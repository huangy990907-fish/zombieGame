# 音效埋点与选音清单（zombieGame）

> 扫描范围：`src/audio/`、`src/systems/`、`src/core/`、`src/main.ts`、`src/config.ts`、`public/audio/`
> 结论：**音频框架已经完整实现，只差音频文件**。把文件按下方文件名放进 `public/audio/`，刷新页面即生效，**不需要改任何代码**。

---

## 一、先看结论（速览）

| 项目 | 现状 |
| --- | --- |
| 播放器 | 已有 `src/audio/manager.ts`：纯 Web Audio API，`decodeAudioData` 预加载 + `createBufferSource` 一次性播放 |
| 事件表 | 已有 `src/audio/events.ts`：16 个 SFX 键、16 条文件路径、16 条全局限频 |
| 已接线埋点 | **14 个**（武器 5 + 僵尸 4 + 人类 1 + 场景 3 + UI 1） |
| 已声明未接线 | **2 个**：`RELOAD`（换弹）、`HUMAN_HURT`（人类被咬扣血）——放文件也不会响 |
| 目录 | `public/audio/` 已存在，目前只有 `.gitkeep`，**16 个文件全部缺失**（控制台会打印“音效缺失”） |
| BGM | **完全没有**，代码里也没有 BGM 加载/循环逻辑 |
| 循环播放 | 不支持。`play()` 只 `src.start(0)`，无 `loop`、无 `stop()` 句柄 |
| 随机变体 | 不支持。每个事件只映射 1 个文件，`play()` 也不做随机偏移 |
| 距离衰减 | `play(key, volume)` 有音量参数，但所有调用点都没传，实际等于 1.0 |
| UI 点击音 | 只接了主菜单「新游戏 / 继续游戏」两个按钮，选关节点、开始战斗、设置、重开、结算弹窗按钮都**没有声音** |
| 音量控制 | 主菜单有静音按钮；战斗顶栏**没有**静音按钮；设置面板的总音量/音效音量滑块调了即时生效 |

**建议落地顺序**

1. 先补高频战斗音（8 个）：`weapon-mg`、`weapon-flame`、`weapon-shotgun`、`weapon-rocket`、`weapon-explosion`、`zombie-hit`、`zombie-bite`、`zombie-kill`
2. 再补氛围与流程音（5 个）：`zombie-growl`、`wave-start`、`victory`、`defeat`、`ui-click`
3. 最后补低频音（3 个）：`weapon-reload`、`human-hurt`、`human-turn`
4. `weapon-reload`、`human-hurt` 即使放了文件也不会响，需要一行接线（见第四节）

---

## 二、当前音频是怎么加载和触发的

### 2.1 加载链路

```
public/audio/*.mp3
  └─ boot() → sound.init()            // src/main.ts:48
       └─ AudioManager.preloadAll()   // src/audio/manager.ts:121
            └─ fetch("audio/xxx.mp3") → resp.arrayBuffer() → ctx.decodeAudioData()
                 └─ 成功：buffers.set(key, AudioBuffer)
                 └─ 失败/404：buffers.set(key, null)，play() 时静默跳过，不报错
```

- 路径是**相对 `public/` 的根路径**，Vite dev 直接返回 `public/audio/xxx.mp3`，`vite build` 会原样拷到 `dist/audio/`。
- 文件名**大小写敏感**，必须与 [events.ts](file:///Users/huangyu/agentSpace/trae/zombieGame/src/audio/events.ts#L36-L57) 的 `SFX_MAP` 一模一样。
- 格式固定 `.mp3`（`decodeAudioData` 本身也吃 wav/ogg，但路径写死了 `.mp3`，换格式必须改代码）。
- 16 个文件在启动时**全部并发预加载**，任何一个缺失只打印 `[audio] 音效缺失：audio/xxx.mp3` 并降级为静音。

### 2.2 触发链路

```ts
import { sound, SFX } from "../audio/manager";
sound.play(SFX.MG_SHOT);   // 返回 true = 真的响了；false = 限频/暂停/缺文件
```

`play()` 内部顺序（[manager.ts:152-172](file:///Users/huangyu/agentSpace/trae/zombieGame/src/audio/manager.ts#L152-L172)）：

1. 未初始化 / 静音 / 暂停 → 直接 false
2. **全局限频**：同一事件在 `SFX_THROTTLE` 毫秒内最多响 1 次（不是按僵尸/人类个体限频，是全局）
3. 取预加载 `AudioBuffer`，没有就 false
4. `createBufferSource` 新建一个源 → `GainNode` 音量 = `传入volume × masterVol × sfxVol` → 连 `destination`
5. 每次播放都是**独立新源，天然支持并发叠加**，播完自动释放（无需手动清理）

其他行为：

- 浏览器自动播放策略：`init()` 时 AudioContext 可能 `suspended`，`sound.resume()` 在点击主菜单按钮时调用；进入战斗路由时 `resumeAudio()` 也会 resume（[main.ts:303](file:///Users/huangyu/agentSpace/trae/zombieGame/src/main.ts#L303)）。
- 路由切到 `menu` / `levels` 会 `sound.pause()`（本质 `ctx.suspend()`，全局静音），回 `play` 时 `resumeAudio()`。
- 游戏内倍速（1/2/4/8x）只加快模拟帧，**限频用的是真实时间 `performance.now()`**，所以 8x 下音效触发次数不会同比变多，只会更稀。

### 2.3 缺失的能力（只记录，不改代码）

| 能力 | 现状 | 影响 |
| --- | --- | --- |
| 循环（loop） | 无 | 火焰、BGM 这类持续音只能靠“短片段 + 限频重复”凑 |
| 随机变体 | 无（1 key = 1 文件） | 同一事件永远同一个音，密集触发会听出复读 |
| 音高/音量随机 | 无 | 同上 |
| 距离衰减 / 声像 | 无 | 远处和近处僵尸声音一样响 |
| BGM | 无 | 主菜单、战斗都没有背景音乐 |
| 单音停止 | 无（只能整体 suspend） | 长音效在切场景时无法单独掐掉 |
| 战斗中静音按钮 | 无 | 只能回主菜单按 🔇，或把音量滑块拉 0 |

---

## 三、埋点总表（可逐项打勾）

### 表 1 · 触发时机与播放特性

> 「并发」列已结合 `SFX_THROTTLE` 与武器冷却/人数估算，表示真实可能同时发声的源数量（不是理论值）。
> 「单次/循环」全部为**单次**——当前加载器不支持循环；标“单次（短）重复”表示靠限频连续触发来模拟持续音。

| ☐ | 事件 | 目标文件（public/audio/） | 触发位置 | 触发时机（战况） | 建议时长 | 单次/循环 | 随机变体 | 并发（限频上限） |
|---|---|---|---|---|---|---|---|---|
| ☐ | **机枪射击** `MG_SHOT` | `weapon-mg.mp3` | [combat.ts:42](file:///Users/huangyu/agentSpace/trae/zombieGame/src/systems/combat.ts#L42) | 任一机枪人类开火（冷却 0.1s，25 人） | 60–90 ms | 单次 | 建议要（2–3 变体） | 高：限频 40ms ≈ 25 次/秒，约 2 个源叠加 |
| ☐ | **喷火** `FLAME` | `weapon-flame.mp3` | [combat.ts:77](file:///Users/huangyu/agentSpace/trae/zombieGame/src/systems/combat.ts#L77) | 喷火人类每 0.06s 一次伤害结算；整轮 1.1s | 100–150 ms | 单次（短）重复 | 建议要（2 变体） | 高：限频 60ms ≈ 16 次/秒；10 人成簇喷火 |
| ☐ | **霰弹枪** `SHOTGUN` | `weapon-shotgun.mp3` | [combat.ts:43](file:///Users/huangyu/agentSpace/trae/zombieGame/src/systems/combat.ts#L43) | 霰弹人类扣扳机（冷却 0.8s） | 250–350 ms | 单次 | 建议要（2 变体） | 中：限频 200ms ≈ 5 次/秒 |
| ☐ | **火箭发射** `ROCKET` | `weapon-rocket.mp3` | [combat.ts:44](file:///Users/huangyu/agentSpace/trae/zombieGame/src/systems/combat.ts#L44) | 火箭人类发射（冷却 1.9s） | 300–500 ms | 单次 | 可选（1 个够） | 低：限频 300ms ≈ 3 次/秒 |
| ☐ | **火箭爆炸** `EXPLOSION` | `weapon-explosion.mp3` | [combat.ts:183](file:///Users/huangyu/agentSpace/trae/zombieGame/src/systems/combat.ts#L183) | 火箭命中/撞墙，62px 范围爆炸 | 500–800 ms | 单次 | 建议要（2–3 变体） | 中：限频 500ms ≈ 2 次/秒；尸群密集时连爆 |
| ☐ | **换弹** `RELOAD` ⚠️未接线 | `weapon-reload.mp3` | 无调用点（[events.ts:42](file:///Users/huangyu/agentSpace/trae/zombieGame/src/audio/events.ts#L42) 仅声明） | 弹匣打空进入 1.4–2.4s 换弹 | 300–500 ms | 单次 | 不需要 | 无（未接线）→ 接线后低：限频 1000ms |
| ☐ | **僵尸咆哮** `ZOMBIE_GROWL` | `zombie-growl.mp3` | [ai.ts:253](file:///Users/huangyu/agentSpace/trae/zombieGame/src/systems/ai.ts#L253) | 僵尸每 0.3–0.6s 重新索敌时调用；全局 3s 才响一次 | 800–1500 ms | 单次 | **强烈需要（3–4 变体）** | 低：限频 3000ms ≈ 0.3 次/秒；但音量/变体决定“尸群包围感” |
| ☐ | **啃咬** `ZOMBIE_BITE` | `zombie-bite.mp3` | [ai.ts:385](file:///Users/huangyu/agentSpace/trae/zombieGame/src/systems/ai.ts#L385)（咬人）、[ai.ts:409](file:///Users/huangyu/agentSpace/trae/zombieGame/src/systems/ai.ts#L409)（啃门窗） | 僵尸咬到人类（咬后 2.8s 转化）；僵尸啃门/窗 | 150–300 ms | 单次 | 建议要（3 变体，人和木头可复用） | 高：限频 400ms ≈ 2.5 次/秒；门口堆积时密集 |
| ☐ | **僵尸中弹** `ZOMBIE_HIT` | `zombie-hit.mp3` | [combat.ts:163](file:///Users/huangyu/agentSpace/trae/zombieGame/src/systems/combat.ts#L163) | 每颗子弹/火焰伤害结算命中僵尸 | 60–120 ms | 单次 | **强烈需要（3–4 变体）** | 极高：限频 80ms ≈ 12.5 次/秒；机枪+霰弹+火焰同时打 |
| ☐ | **僵尸死亡** `ZOMBIE_KILL` | `zombie-kill.mp3` | [combat.ts:167](file:///Users/huangyu/agentSpace/trae/zombieGame/src/systems/combat.ts#L167) | 僵尸血量归零倒地 | 300–500 ms | 单次 | 建议要（2–3 变体） | 高：限频 60ms ≈ 16 次/秒；后期一波数百只 |
| ☐ | **人类被咬** `HUMAN_HURT` ⚠️未接线 | `human-hurt.mp3` | 无调用点（[events.ts:49](file:///Users/huangyu/agentSpace/trae/zombieGame/src/audio/events.ts#L49) 仅声明） | 本应：人类被僵尸咬到、进入 2.8s 转化倒计时 | 200–400 ms | 单次 | 建议要（2 变体声线） | 无（未接线）→ 接线后中：限频 300ms |
| ☐ | **人类倒戈** `HUMAN_TURN` | `human-turn.mp3` | [ai.ts:99](file:///Users/huangyu/agentSpace/trae/zombieGame/src/systems/ai.ts#L99) | 转化倒计时归零，人类变丧尸 | 600–1000 ms | 单次 | 可选（1–2 变体） | 低：限频 200ms；50 人同时期倒下时最多 5 次/秒 |
| ☐ | **波次开始** `WAVE_START` | `wave-start.mp3` | [game.ts:192](file:///Users/huangyu/agentSpace/trae/zombieGame/src/core/game.ts#L192) | 每波开波（1.8s 间歇后），共 26 波 | 1.5–2.5 s | 单次 | 不需要 | 极低：每波 1 次，无人物/僵尸参与 |
| ☐ | **胜利** `VICTORY` | `victory.mp3` | [game.ts:287](file:///Users/huangyu/agentSpace/trae/zombieGame/src/core/game.ts#L287) | 最后一波清空、走完 26 波 | 3–6 s | 单次 | 不需要 | 极低：一局 1 次 |
| ☐ | **失败** `DEFEAT` | `defeat.mp3` | [game.ts:281](file:///Users/huangyu/agentSpace/trae/zombieGame/src/core/game.ts#L281) | 人类全灭，房间失守 | 3–5 s | 单次 | 不需要 | 极低：一局 1 次 |
| ☐ | **UI 点击** `UI_CLICK` | `ui-click.mp3` | [main.ts:445-446](file:///Users/huangyu/agentSpace/trae/zombieGame/src/main.ts#L445-L446) | 主菜单「新游戏」「继续游戏」（其余按钮未接） | 40–120 ms | 单次 | 不需要 | 极低：人手点击；限频 0（不限制） |

### 表 2 · 选音检索与来源

> 关键词格式：动作 + 材质 + 强度。检索时可直接把整串粘进 freesound / Kenney 搜索框，或拆词组合。

| 事件 | 英文检索关键词（2–4 个） | 推荐免费来源 | 更适合「现成下载 / 程序化生成」 | 说明 |
|---|---|---|---|---|
| `MG_SHOT` | `machine gun single shot` / `rifle shot metal light` / `gunshot short dry` / `9mm shot medium` | **Kenney Impact Sounds**、freesound (CC0)、OpenGameArt | **现成下载** | 高频触发的关键：只要“干、短、无长尾”，长混响会在 25 次/秒下糊成噪音 |
| `FLAME` | `flame burst short` / `fire whoosh low` / `jet flame hiss` / `gas burner burst` | freesound (CC0)、OpenGameArt | **现成下载**（短一次性片段）；也可程序化噪声 | 管理器不支持循环，别下 3s 长火焰；要 100ms 左右“一喷”的簇 |
| `SHOTGUN` | `shotgun blast close` / `double barrel shot` / `shell blast heavy` | Kenney Impact Sounds、freesound (CC0) | **现成下载** | 0.8s 冷却，可用 250–350ms 带一点低频冲击 |
| `ROCKET` | `rocket launch whoosh` / `missile fire short` / `projectile launch medium` | freesound (CC0)、OpenGameArt | **现成下载** | 发射声 ≠ 爆炸声，要独立的“出膛 + 尾焰”质感 |
| `EXPLOSION` | `explosion debris medium` / `grenade blast close` / `boom low heavy` | Kenney Impact Sounds、freesound (CC0) | **现成下载** | 62px 小范围爆炸，别用“核弹级”长尾 |
| `RELOAD` | `magazine reload click` / `gun reload mechanical` / `bolt action short` | **jsfxr**（程序化）、Kenney “Interface/Impact” | **程序化生成** | 就是几声金属“咔哒”，jsfxr/Chiptone 两分钟能搓出来；下载也容易找 |
| `ZOMBIE_GROWL` | `zombie growl low` / `monster groan wet` / `creature snarl medium` | freesound (CC0)、OpenGameArt | **现成下载** | 全局限频 3s，靠 3–4 个变体+音量差营造“远处一群”；程序化做不好人声质感 |
| `ZOMBIE_BITE` | `flesh bite crunch` / `bone crunch short` / `monster chew wet` | freesound (CC0)、Kenney Impact Sounds | **现成下载** | 咬人和啃木头共用一条；建议 3 变体覆盖两种场景 |
| `ZOMBIE_HIT` | `flesh impact squish` / `bullet hit meat light` / `wet thud short` | Kenney Impact Sounds、freesound (CC0) | **现成下载**（推荐）；程序化噪声可做低保真替代 | 12 次/秒的高频事件，文件必须极短（<120ms）、去混响 |
| `ZOMBIE_KILL` | `zombie death groan` / `monster collapse thud` / `body fall heavy` | freesound (CC0)、OpenGameArt | **现成下载** | 与 `ZOMBIE_HIT` 音色要拉开，否则听不出击杀 |
| `HUMAN_HURT` | `human pain grunt` / `male scream short` / `hurt breath light` | freesound (CC0，注意人声授权)、OpenGameArt | **现成下载** | 需要真人声质感，程序化不合适；2 个声线变体避免复读 |
| `HUMAN_TURN` | `human scream horror` / `transformation groan` / `monster roar transform` | freesound (CC0)、OpenGameArt | **现成下载** | 600–1000ms 的“惨叫 → 嘶吼”过渡最贴题 |
| `WAVE_START` | `siren alarm short` / `horn warning low` / `wave start stinger` | OpenGameArt、freesound (CC0)、Kenney “Sci-Fi Sounds” | **现成下载**；也可 jsfxr 合成警报音 | 每波只响一次，值得做 1.5–2.5s 的“警报 + 尸潮”短过场 |
| `VICTORY` | `victory fanfare short` / `success jingle` / `orchestral win sting` | OpenGameArt、freesound (CC0) | **现成下载** | 3–6s，一局只响一次，质量优先 |
| `DEFEAT` | `defeat sting low` / `sad violin short` / `failure drone` | OpenGameArt、freesound (CC0) | **现成下载** | 与胜利音形成明确情绪对比 |
| `UI_CLICK` | `ui click soft` / `button click light` / `menu tick` | **jsfxr**（程序化）、Kenney “Interface Sounds” | **程序化生成最佳** | 40–120ms、几十字节，jsfxr 一键导出；下载也行但常带多余尾音 |

---

## 四、已声明但不会响的两个事件（需 1 行接线，非必须）

| 事件 | 现状 | 若要启用，接线位置 |
|---|---|---|
| `RELOAD` | `SFX_MAP` / `SFX_THROTTLE` 都有，但全项目无 `sound.play(SFX.RELOAD)` | `src/systems/ai.ts` 里 `h.ammo <= 0 && h.reloadTimer <= 0` 处，或 `combat.ts` 里 `h.ammo <= 0 → h.reloadTimer = def.reload` 处，加一行 `sound.play(SFX.RELOAD)` |
| `HUMAN_HURT` | 同上，无调用 | `src/systems/ai.ts:381-386` 僵尸咬到人类、设置 `h.turning` 的分支里，加一行 `sound.play(SFX.HUMAN_HURT)` |

> 注意：这两项即便把 mp3 放好，也不会响；不要误以为文件没加载成功。控制台会显示“预加载完成 16 个音效”（含这两项）。

---

## 五、代码里没有埋点、但值得补的事件（需改代码，本次不改）

| 事件 | 应触发位置 | 说明 |
|---|---|---|
| 门/窗被啃破瞬间 | [ai.ts:421-434](file:///Users/huangyu/agentSpace/trae/zombieGame/src/systems/ai.ts#L421-L434)（`o.broken = true`） | 目前只有粒子没有声音；门破（全速涌入）和窗破（窗檐减速）应有明显反馈 |
| 波间倒计时 / 下一波预警 | [game.ts:289-295](file:///Users/huangyu/agentSpace/trae/zombieGame/src/core/game.ts#L289-L295)（`intermission`） | 1.8s 间歇可加短促提示音 |
| BGM（主菜单 / 战斗） | `manager.ts` 需先支持 loop 与独立音量通道 | 当前 `sfxVol` 注释明确“现在还没 BGM” |
| 人类中弹 / 人类死亡 | `ai.ts` / `combat.ts` 人类受伤逻辑 | 目前人类只有“被咬→倒戈”，没有独立死亡音 |
| UI 点击全覆盖 | 选关节点、开始战斗、设置开关、重开、暂停、结算弹窗按钮 | 现仅 [main.ts:445-446](file:///Users/huangyu/agentSpace/trae/zombieGame/src/main.ts#L445-L446) 两个菜单按钮接了 `UI_CLICK` |
| 战斗中静音 | 顶栏（`index.html` 的 `#topbar`） | 目前只能回主菜单按 🔇 或音量拉 0 |

---

## 六、放文件时的硬性规范（不用改代码）

1. **目录**：`/Users/huangyu/agentSpace/trae/zombieGame/public/audio/`（已存在，仅 `.gitkeep`）
2. **文件名**：严格按表 1 的 16 个名字，全小写、连字符、`.mp3` 后缀；大小写错 = 404 = 静音
3. **格式**：MP3，建议 44.1kHz、单声道、96–128kbps；单个文件建议 <100KB，16 个合计 <1.5MB（启动时全部并发预加载）
4. **时长**：严格按表 1 建议时长。超过建议时长的音在 8x 倍速 / 密集触发下会互相叠加、糊成噪音
5. **不要做循环文件**：所有事件按“单次短片段”准备；火焰靠限频重复播放来听成持续音
6. **验证方式**：打开 DevTools Console，应看到 `[audio] 预加载完成 16 个音效`；若某条仍显示 `[audio] 音效缺失：audio/xxx.mp3`，说明文件名/路径不对
7. **变体将来怎么扩**：如需随机变体，需把 `SFX_MAP` 的值改成 `string[]` 并在 `play()` 里随机取一个（属于代码改动，本次不做）；届时文件可命名 `weapon-mg-1.mp3`、`weapon-mg-2.mp3`
</content>
</invoke>
