import type { WaveSettings, AudioSettings } from "../types";

/**
 * 场景级默认值（不属于任何实体定义）。
 * 玩家滑块只写入覆盖值，读取时用 `覆盖值 ?? 这里的默认值`。
 */
export const DEFAULT_BASE_SETTINGS: {
  wave: WaveSettings;
  human: { start: number; cap: number };
  zombie: { jitter: number };
  audio: AudioSettings;
} = {
  wave: {
    count: 26,
    base: 260,
    growth: 1.09,
    spawnBase: 26,
    spawnPerWave: 2,
    spawnMax: 90,
    maxAlive: 2200,
    reinforce: 1,
  },
  human: {
    start: 50,
    cap: 50,
  },
  zombie: {
    /** 个体随机幅度，正态分布 ±jitter，0 = 完全不随机 */
    jitter: 0.25,
  },
  audio: {
    /** 总音量 0~1 */
    master: 1,
    /** 音效音量 0~1 */
    sfx: 1,
  },
};
