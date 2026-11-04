# 音效授权台账（public/audio）

本目录 16 个 mp3 全部为 **CC0 公共领域** 或 **程序化生成**，可商用、无需授权费用。
下载素材均来自 [Kenney](https://kenney.nl) 的 CC0 音效包（原作者 Kenney，署名非强制，但建议在致谢中保留）。

统一处理：44.1kHz / 单声道 / MP3 128kbps / 峰值约 -3dB / 去掉静音头 / 按埋点建议时长裁剪。

| 文件 | 时长 | 来源 | 许可证 | 原始素材 | 链接 | 处理说明 |
|---|---|---|---|---|---|---|
| `weapon-mg.mp3` | 0.08s | 程序生成，无外部版权 | — | — | — | 噪声瞬态 + 低频冲击，指数衰减，模拟单发枪响 |
| `weapon-flame.mp3` | 0.12s | 程序生成，无外部版权 | — | — | — | 带通噪声 + 随机“噼啪”调制，100ms 级短促喷射簇 |
| `weapon-shotgun.mp3` | 0.32s | Kenney | CC0 1.0 | Impact Sounds `impactPunch_heavy_000.ogg` + Sci-Fi Sounds `explosionCrunch_000.ogg` | https://kenney.nl/assets/impact-sounds · https://kenney.nl/assets/sci-fi-sounds | 两段等权混合，裁到 0.32s，尾部淡出 |
| `weapon-rocket.mp3` | 0.42s | Kenney | CC0 1.0 | Sci-Fi Sounds `spaceEngineLow_000.ogg` + `forceField_000.ogg` | https://kenney.nl/assets/sci-fi-sounds | 引擎低频 + 科幻能量层混合，模拟发射与尾焰 |
| `weapon-explosion.mp3` | 0.70s | Kenney | CC0 1.0 | Sci-Fi Sounds `explosionCrunch_000.ogg` | https://kenney.nl/assets/sci-fi-sounds | 原素材 0.78s，裁到 0.70s，保留爆破主体 |
| `weapon-reload.mp3` | 0.42s | 程序生成，无外部版权 | — | — | — | 三声金属“咔哒”（噪声瞬态 + 双共振）+ 拉枪机低通噪声。**当前未接线，放文件不会响** |
| `zombie-growl.mp3` | 1.20s | 程序生成，无外部版权 | — | — | — | 谐波叠加低频吼叫 + 5Hz 颤音 + 呼吸噪声 + 缓慢下滑 |
| `zombie-bite.mp3` | 0.20s | Kenney | CC0 1.0 | Sci-Fi Sounds `slime_000.ogg` | https://kenney.nl/assets/sci-fi-sounds | 原素材 0.50s，裁前 0.20s 湿滑啃咬段 |
| `zombie-hit.mp3` | 0.09s | Kenney | CC0 1.0 | Impact Sounds `impactSoft_medium_000.ogg` | https://kenney.nl/assets/impact-sounds | 原素材 0.12s，裁到 0.09s 的软组织撞击 |
| `zombie-kill.mp3` | 0.45s | Kenney | CC0 1.0 | Impact Sounds `impactSoft_heavy_000.ogg` + Sci-Fi Sounds `slime_000.ogg` | https://kenney.nl/assets/impact-sounds · https://kenney.nl/assets/sci-fi-sounds | 重物倒地 + 湿滑层混合，裁到 0.45s |
| `human-hurt.mp3` | 0.30s | 程序生成，无外部版权 | — | — | — | 共振峰式短促惨叫（谐波 + 高频呼吸噪声）。**当前未接线，放文件不会响**；人声质感有限 |
| `human-turn.mp3` | 0.80s | 程序生成，无外部版权 | — | — | — | 前 0.34s 人声惨叫，后段交叉淡入低频咆哮 |
| `wave-start.mp3` | 2.00s | 程序生成，无外部版权 | — | — | — | 0.5s 周期警报扫频（320–680Hz）+ 110Hz 底音 + 噪声 |
| `victory.mp3` | 4.00s | 程序生成，无外部版权 | — | — | — | C-E-G-C 上行钟音 + 大三和弦尾奏 + 高频闪光 |
| `defeat.mp3` | 3.50s | 程序生成，无外部版权 | — | — | — | A-F-D 下行钟音 + 98Hz 低沉叹息 + 暗噪 |
| `ui-click.mp3` | 0.08s | Kenney | CC0 1.0 | Interface Sounds `click_001.ogg` | https://kenney.nl/assets/interface-sounds | 原素材 0.10s，裁到 0.08s，去掉静音头 |

## 许可证说明

- **CC0 1.0（Creative Commons Zero）**：作者放弃版权，可自由复制、修改、商用，无需署名。
  官方文本：https://creativecommons.org/publicdomain/zero/1.0/
- 各 Kenney 包内附带的 `License.txt` 原文均声明 CC0，可与本台账对应核查。
- 程序生成文件由本地脚本用 FFmpeg/Python 合成，不含任何第三方采样，无版权归属问题。

## 备注

- `weapon-reload`、`human-hurt` 两个事件在 `src/audio/events.ts` 已声明，但游戏代码里没有调用点，文件已备好、接线后即可发声。
- 所有文件均按 `src/audio/events.ts` 的 `SFX_MAP` 命名，大小写完全一致，放入本目录即被预加载。
- 合计 16 个文件、约 272 KB。
