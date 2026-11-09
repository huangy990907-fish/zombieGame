# 音效授权台账（public/audio）

本目录 26 个 mp3 均来自 **CC0 实录素材**（检索时用 `license:"Creative Commons 0"` 过滤，逐条核对 API 返回的 license 字段），不再包含程序化合成或自制派生文件。`zombie-growl-fat.mp3` 与 `weapon-tesla.mp3` 在 0.4.2 / 0.4.3 曾是派生成品，现已各自替换为独立的 CC0 实录；历史派生关系见 CHANGELOG 对应版本，不代表当前来源。

- 许可证：**CC0 1.0（Creative Commons Zero）**，可复制、修改、商用，无需署名。
  官方文本：<https://creativecommons.org/publicdomain/zero/1.0/>
- 素材获取方式：freesound API v2 搜索 + 官方 preview-hq-mp3 下载，原始文件可能是 wav/flac，最终统一转码。
- 统一后处理：44.1kHz / 单声道 / MP3 128kbps / 峰值约 -3dB / 去静音头 / 按埋点建议时长裁剪并加淡入淡出。
- 每个事件在 CC0 池里至少比较了 3 个候选（按评分与下载量排序，结合标题/标签/时长筛选），下表记录最终采用项。

| 文件 | 时长 | 大小 | freesound id | 原始标题 | 作者 | 许可证 | 链接 | 处理说明 |
|---|---|---|---|---|---|---|---|---|
| `weapon-mg.mp3` | 0.10s | 2.1 KB | 162396 | M16 Single Shot 3.flac | qubodup | CC0 1.0 | https://freesound.org/s/162396/ | 真实 M16 单发，取前 60ms 干声瞬态，15ms 淡出 |
| `weapon-flame.mp3` | 0.13s | 2.5 KB | 739469 | WD-40 quarter Full - Flame thrower 3 | Sadiquecat | CC0 1.0 | https://freesound.org/s/739469/ | 真实喷火/火炬声，截取 0.08–0.18s 稳定段，100ms 级 |
| `weapon-shotgun.mp3` | 0.34s | 5.8 KB | 702672 | Remington 870 | areniporgen | CC0 1.0 | https://freesound.org/s/702672/ | 真实 12 号霰弹枪近距录音，保留 0.30s 冲击主体 |
| `weapon-rocket.mp3` | 0.47s | 7.8 KB | 521377 | Rocket Launch | Jarusca | CC0 1.0 | https://freesound.org/s/521377/ | 游戏用火箭发射声，保留出膛 + 尾焰 0.44s |
| `weapon-tesla.mp3` | 0.16s | 2.9 KB | 488664 | Shock_Three.wav | Nodgez | CC0 1.0 | https://freesound.org/s/488664/ | 截取源文件 0.60–0.72s 的单次放电（0.12s 内容），保留尖锐起音，首 2ms 淡入 / 末 20ms 淡出；响度对齐旧文件（mean -27.8dB / peak -8.9dB，实测 -28.2 / -9.2）；44.1kHz mono 128kbps。此前的 0.4.3 派生关系（曾由 `zombie-growl-fat.mp3` / 754441 升调得到）**已替换**，历史来源见 CHANGELOG 0.4.3 |
| `weapon-explosion.mp3` | 0.57s | 9.4 KB | 67469 | Fragmentation Grenade Explosion Military M67 1.flac | qubodup | CC0 1.0 | https://freesound.org/s/67469/ | 真实 M67 破片手雷爆炸，完整 0.54s，无长尾 |
| `weapon-reload.mp3` | 0.47s | 7.8 KB | 455921 | Pistol (magazine reload only) | bolkmar | CC0 1.0 | https://freesound.org/s/455921/ | 弹匣拔出/插入两声金属咔哒，截取 0.44s。**仍未被游戏代码调用** |
| `zombie-growl.mp3` | 0.73s | 11.9 KB | 754441 | Zombie Groan 3 | OwNathan | CC0 1.0 | https://freesound.org/s/754441/ | 僵尸低吼，去掉 0.12s 静音头后的完整 0.73s（略低于清单 0.8s 下限） |
| `zombie-growl-fat.mp3` | 1.15s | 18.4 KB | 643766 | Monster Moan Groan Growl.mp3 | SnowFightStudios | CC0 1.0 | https://freesound.org/s/643766/ | 截取源文件 0.20–1.30s 最连续的低吼段（1.10s 内容），**不做升调/降调/变速**；首 120ms 淡入、末 150ms 淡出；mean 对齐旧文件 -21.1dB（实测 -21.1dB），peak -9.0dB（低于旧 -2.1dB，因新素材动态较小，保持响度对齐不额外增益）；44.1kHz mono 128kbps。此前的 0.4.2 派生关系（曾由 `zombie-growl.mp3` / 754441 降调得到）**已替换**，历史来源见 CHANGELOG 0.4.2 |
| `zombie-growl-leaper.mp3` | 0.91s | 14.7 KB | 483771 | Creepy Creature Screeching 1_2 | Joao_Janz | CC0 1.0 | https://freesound.org/s/483771/ | 截取源文件 0.08–0.96s 的双段嘶叫（0.88s 内容），首 30ms 淡入 / 末 120ms 淡出；mean 对齐 `zombie-growl-fat` 的 -21.1dB（实测 -21.3），末段峰值用限幅保护到 -2.8dB；44.1kHz mono 128kbps |
| `zombie-growl-corroder.mp3` | 1.07s | 17.2 KB | 205754 | Surge Leech 2 | scorpion67890 | CC0 1.0 | https://freesound.org/s/205754/ | 截取源文件 0.06–1.10s 的湿黏低吼（1.04s 内容），首 60ms 淡入 / 末 120ms 淡出；mean 对齐 -21.1dB（实测 -21.3），未额外增益；44.1kHz mono 128kbps |
| `zombie-growl-matriarch.mp3` | 2.01s | 31.9 KB | 607201 | Defeated_Ogre.wav | TomRonaldmusic | CC0 1.0 | https://freesound.org/s/607201/ | 作者在隔离间用 Cm414 实录音色低沉的兽吼/呻吟，**纯录音、无升降调**；截取源文件 0.16–2.14s（1.98s 内容），首 40ms 淡入 / 末 200ms 淡出，整体衰减 6.4dB；mean 对齐 `zombie-growl-fat` 的 -21.1dB（实测 -21.1），peak -4.0dB；44.1kHz mono 128kbps |
| `zombie-spawn.mp3` | 0.60s | 9.8 KB | 429226 | 17 - Carne 2.wav | MichaelGillighan | CC0 1.0 | https://freesound.org/s/429226/ | 真实内脏被翻动的单次 Foley；截取完整 0.00–0.57s（0.57s 内容），首 15ms 淡入 / 末 80ms 淡出；源素材录制电平很低（mean -46.6dB），为对齐短音口径提升 18.0dB，实测 mean -26.2 / peak -5.1，静音段底噪约 -42dB（信噪比约 17dB），属素材本身特性；44.1kHz mono 128kbps |
| `zombie-matriarch-death.mp3` | 1.88s | 29.8 KB | 151710 | Rotten Zombie Death | scorpion67890 | CC0 1.0 | https://freesound.org/s/151710/ | 高度腐败躯体的死亡喉音，湿重并带自然尾音；截取 0.06–1.90s（1.84s 内容），首 40ms 淡入 / 末 250ms 淡出，整体衰减 4.3dB；作为 BOSS 重头戏按约定略响，mean -19.0dB（比其它叫声高约 2dB），peak -5.0dB；44.1kHz mono 128kbps |
| `zombie-leap.mp3` | 0.34s | 5.8 KB | 669714 | single big impact, large creature jumping down.wav | vestibule-door | CC0 1.0 | https://freesound.org/s/669714/ | 截取源文件 0.08–0.38s 的大型生物落地冲击段（0.30s 内容），首 15ms 淡入 / 末 60ms 淡出；mean 对齐 `zombie-bite` 的 -26.1dB（实测 -26.0）；44.1kHz mono 128kbps |
| `zombie-spit.mp3` | 0.55s | 9.0 KB | 445117 | Cartoon Splat | Breviceps | CC0 1.0 | https://freesound.org/s/445117/ | 截取完整 0.00–0.52s 的粘稠泼溅（0.52s 内容），首 12ms 淡入 / 末 60ms 淡出，整体衰减 8.1dB；mean 对齐短音口径 -27.0dB（介于 `zombie-bite` 与 `weapon-tesla` 之间）；44.1kHz mono 128kbps |
| `zombie-scream.mp3` | 1.57s | 24.9 KB | 844112 | scream_female_dry | perspektywa_tn | CC0 1.0 | https://freesound.org/s/844112/ | 作者标注 raw / dry 的高音女声尖叫（无混响、人声特质清晰）；截取源文件 0.20–1.72s（1.52s 内容），首 20ms 淡入 / 末 120ms 淡出，整体衰减 4.3dB；mean 对齐 `zombie-growl-fat` 的 -21.1dB（实测 -21.1），peak -9.3dB；44.1kHz mono 128kbps |
| `zombie-bite.mp3` | 0.26s | 4.5 KB | 682094 | Bite 1.wav | HenKonen | CC0 1.0 | https://freesound.org/s/682094/ | 脆咬声（咀嚼水果），0.22s，卡通化的“咔嚓”质感 |
| `zombie-hit.mp3` | 0.10s | 2.1 KB | 877027 | Meat Slime Hit Layer 3 | qubodup | CC0 1.0 | https://freesound.org/s/877027/ | 肉感史莱姆受击层，取前 60ms 瞬态，极短去混响 |
| `zombie-kill.mp3` | 0.50s | 8.2 KB | 555412 | Zombie Death 1.wav | tonsil5 | CC0 1.0 | https://freesound.org/s/555412/ | 僵尸死亡/倒地呻吟，0.02–0.47s，与中弹音色区分 |
| `human-hurt.mp3` | 0.39s | 6.6 KB | 369003 | Getting hit - Eeeh 01 (Mouth Fx) man voice | Flying_Deer_Fx | CC0 1.0 | https://freesound.org/s/369003/ | 真人男性“哎”痛呼，完整 0.35s。**仍未被游戏代码调用** |
| `human-turn.mp3` | 0.94s | 15.1 KB | 243376 + 754441 | human male scream 2 + Zombie Groan 3 | JohnsonBrandEditing + OwNathan | CC0 1.0 | https://freesound.org/s/243376/ · https://freesound.org/s/754441/ | 0.45s 人声惨叫 → 0.55s 僵尸低吼，10ms 交叉淡化，总 0.90s |
| `wave-start.mp3` | 1.59s | 25.3 KB | 686859 | Alarm1.wav | Rotaredom | CC0 1.0 | https://freesound.org/s/686859/ | 警报音一整个周期，1.55s，尾部淡出 |
| `victory.mp3` | 3.74s | 58.8 KB | 521646 | WinMutedGuitar.wav | Fupicat | CC0 1.0 | https://freesound.org/s/521646/ | 游戏过关短铃音，3.70s 完整保留 |
| `defeat.mp3` | 4.05s | 63.7 KB | 362205 | horn_fail_wahwah_2.wav | TaranP | CC0 1.0 | https://freesound.org/s/362205/ | 失败 wah-wah 号角，裁到 4.00s，尾部淡出 |
| `ui-click.mp3` | 0.10s | 2.1 KB | 220197 | Click - Basic | GameAudio | CC0 1.0 | https://freesound.org/s/220197/ | UI 单击，取前 70ms，短促无尾音 |

## 许可证说明

- 所有条目均为 **CC0 1.0**，API 返回的 `license` 字段均为 `http://creativecommons.org/publicdomain/zero/1.0/`；未使用 CC-BY、NC 或来源不明的素材。
- 使用的是 freesound 官方 preview-hq-mp3 预览文件（由 CC0 原始素材转码），版权状态与原始素材一致。
- 合计 **26 个文件、约 398 KB（407,807 字节）**；单文件最大 63.7 KB（`defeat.mp3`），均小于 100 KB，总量远低于 1.5 MB。
- `zombie-growl-fat.mp3` 与 `weapon-tesla.mp3` 现为独立 CC0 实录（freesound 643766 / 488664）；0.4.2 / 0.4.3 的旧派生关系已废弃，历史记录见 CHANGELOG 对应版本，不代表当前来源。

## 备注

- `weapon-reload`、`human-hurt` 两个事件在 [events.ts](file:///Users/huangyu/agentSpace/trae/zombieGame/src/audio/events.ts) 已声明，但游戏代码仍无调用点；文件已备好，接线后即可发声（本次未改游戏逻辑）。
- 文件名统一按 `src/audio/events.ts` 的 `SFX_MAP` 命名规则（小写、连字符、`.mp3`）。以下 8 个文件尚待开发会话在 `events.ts` 登记事件，登记后即随预加载生效：`zombie-growl-leaper`、`zombie-leap`、`zombie-growl-corroder`、`zombie-spit`、`zombie-growl-matriarch`、`zombie-spawn`、`zombie-matriarch-death`、`zombie-scream`；本次未改该文件。
- 本次没有“未替换”项：26 个文件全部来自 CC0 实录；两条历史派生物（`zombie-growl-fat`、`weapon-tesla`）已替换为独立来源。
