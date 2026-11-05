# 音效授权台账（public/audio）

本目录 16 个 mp3 已**全部替换为 freesound.org 的 CC0 素材**（检索时用 `license:"Creative Commons 0"` 过滤，逐条核对 API 返回的 license 字段），不再包含程序化合成文件。

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
| `weapon-explosion.mp3` | 0.57s | 9.4 KB | 67469 | Fragmentation Grenade Explosion Military M67 1.flac | qubodup | CC0 1.0 | https://freesound.org/s/67469/ | 真实 M67 破片手雷爆炸，完整 0.54s，无长尾 |
| `weapon-reload.mp3` | 0.47s | 7.8 KB | 455921 | Pistol (magazine reload only) | bolkmar | CC0 1.0 | https://freesound.org/s/455921/ | 弹匣拔出/插入两声金属咔哒，截取 0.44s。**仍未被游戏代码调用** |
| `zombie-growl.mp3` | 0.73s | 11.9 KB | 754441 | Zombie Groan 3 | OwNathan | CC0 1.0 | https://freesound.org/s/754441/ | 僵尸低吼，去掉 0.12s 静音头后的完整 0.73s（略低于清单 0.8s 下限） |
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
- 合计 **16 个文件、约 234 KB**；单文件最大 63.7 KB（`defeat.mp3`），均小于 100 KB，总量远低于 1.5 MB。

## 备注

- `weapon-reload`、`human-hurt` 两个事件在 [events.ts](file:///Users/huangyu/agentSpace/trae/zombieGame/src/audio/events.ts) 已声明，但游戏代码仍无调用点；文件已备好，接线后即可发声（本次未改游戏逻辑）。
- 所有文件按 `src/audio/events.ts` 的 `SFX_MAP` 命名，小写、连字符、`.mp3`，放入本目录即被预加载。
- 本次没有“未替换”项：16 个事件都在 CC0 池里找到了合格素材。
