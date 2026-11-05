import type { SliderDef } from "../types";

/**
 * 滑块元数据（供 UI 生成面板）。顺序 = 面板显示顺序。
 * path 指向"覆盖值 ?? 定义默认值"的统一读取入口，不要求 SETTINGS 里再存一份同名数值。
 */
export const SLIDERS: SliderDef[] = [
  // 波次 / 规模
  { key: "waveCount", label: "总波数", group: "wave", min: 5, max: 50, step: 1, path: "wave.count" },
  { key: "waveBase", label: "首波尸数", group: "wave", min: 50, max: 800, step: 10, path: "wave.base" },
  { key: "waveGrowth", label: "波次增长", group: "wave", min: 1.02, max: 1.2, step: 0.01, path: "wave.growth" },
  { key: "spawnMax", label: "每秒最大生速", group: "wave", min: 10, max: 300, step: 10, path: "wave.spawnMax" },
  { key: "maxAlive", label: "同屏僵尸上限", group: "wave", min: 300, max: 4000, step: 100, path: "wave.maxAlive" },

  // 人类
  { key: "humanStart", label: "初始人数", group: "human", min: 20, max: 120, step: 1, path: "human.start" },
  { key: "humanHp", label: "人类血量", group: "human", min: 30, max: 200, step: 5, path: "human.hp" },
  { key: "humanSpeed", label: "人类移速", group: "human", min: 25, max: 100, step: 1, path: "human.speed" },
  { key: "humanSight", label: "人类视野", group: "human", min: 150, max: 700, step: 10, path: "human.sight" },
  { key: "humanTurnTime", label: "转化倒计时(秒)", group: "human", min: 1.5, max: 6, step: 0.1, path: "human.turnTime" },

  // 僵尸
  { key: "zombieJitter", label: "属性随机幅度", group: "zombie", min: 0, max: 0.5, step: 0.02, path: "zombie.jitter" },
  { key: "zNormHp", label: "普通·血量均值", group: "zombie", min: 20, max: 250, step: 5, path: "zombie.normal.hp" },
  { key: "zNormSpeed", label: "普通·移速均值", group: "zombie", min: 25, max: 100, step: 1, path: "zombie.normal.speed" },
  { key: "zRunHp", label: "狂奔·血量均值", group: "zombie", min: 15, max: 150, step: 5, path: "zombie.runner.hp" },
  { key: "zRunSpeed", label: "狂奔·移速均值", group: "zombie", min: 50, max: 180, step: 2, path: "zombie.runner.speed" },

  // 门窗
  { key: "doorHp", label: "门血量", group: "opening", min: 100, max: 1200, step: 50, path: "opening.doorHp" },
  { key: "winHp", label: "窗血量", group: "opening", min: 30, max: 400, step: 10, path: "opening.winHp" },
  { key: "winPass", label: "窗破后穿窗速度", group: "opening", min: 0.15, max: 1, step: 0.05, path: "opening.winPassSpeed" },
  { key: "biteDmg", label: "啃建筑每口伤害", group: "opening", min: 1, max: 20, step: 1, path: "opening.buildBiteDamage" },
  { key: "biteSlow", label: "啃建筑减速倍率", group: "opening", min: 1, max: 3, step: 0.1, path: "opening.buildBiteSlow" },

  // 音频
  { key: "audioMaster", label: "总音量", group: "audio", min: 0, max: 1, step: 0.05, path: "audio.master" },
  { key: "audioSfx", label: "音效音量", group: "audio", min: 0, max: 1, step: 0.05, path: "audio.sfx" },
];

/** 给 UI 一个按分组查的版本 */
export const SLIDER_GROUPS: Record<string, SliderDef[]> = SLIDERS.reduce<Record<string, SliderDef[]>>(
  (acc, s) => {
    (acc[s.group] ??= []).push(s);
    return acc;
  },
  {},
);
