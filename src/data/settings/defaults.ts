import type { WaveSettings, AudioSettings } from "../types";

/**
 * 场景级默认值（不属于任何实体定义）。
 * 玩家滑块只写入覆盖值，读取时用 `覆盖值 ?? 这里的默认值`。
 */
export const DEFAULT_BASE_SETTINGS: {
  wave: WaveSettings;
  human: { cap: number };
  zombie: { jitter: number };
  audio: AudioSettings;
} = {
  wave: {
    spawnBase: 26,
    spawnPerWave: 2,
    spawnMax: 90,
    maxAlive: 2200,
  },
  human: {
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
