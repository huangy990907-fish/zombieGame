/**
 * 内置教学关「初次尸潮」的 TS 兜底定义。
 *
 * 运行时优先读取 `public/levels/level-1.json`；manifest 或 JSON 加载失败时
 * 用这里的定义保证游戏仍能进入，不白屏。两份内容必须保持一致。
 *
 * 波次数量沿用 0.5.1：8 波，总量 120 → 180，狂奔占比 0.25 + n × 0.015。
 * `settings` 是旧版节奏兼容块，第 3 阶段由 `waves` 接管后仍保留僵尸血量微调。
 */
import type { LevelJson } from "./schema";

export const level1: LevelJson = {
  schemaVersion: 1,
  id: "level-1",
  name: "初次尸潮",
  mapId: "arena",
  mode: "placement",
  humans: [
    { id: "mg", enabled: true, hp: 100, initial: 20, cap: 20, regen: 25 },
    { id: "flame", enabled: true, hp: 100, initial: 8, cap: 8, regen: 40 },
    { id: "shotgun", enabled: true, hp: 100, initial: 8, cap: 8, regen: 35 },
    { id: "rocket", enabled: true, hp: 100, initial: 4, cap: 4, regen: 90 },
    { id: "tesla", enabled: true, hp: 100, initial: 10, cap: 10, regen: 50 },
  ],
  waves: [
    { interval: 1.8, zombies: [{ kind: "normal", count: 88 }, { kind: "runner", count: 32 }] },
    { interval: 1.8, zombies: [{ kind: "normal", count: 91 }, { kind: "runner", count: 36 }] },
    { interval: 1.8, zombies: [{ kind: "normal", count: 95 }, { kind: "runner", count: 40 }] },
    { interval: 1.8, zombies: [{ kind: "normal", count: 99 }, { kind: "runner", count: 44 }] },
    { interval: 1.8, zombies: [{ kind: "normal", count: 102 }, { kind: "runner", count: 49 }] },
    { interval: 1.8, zombies: [{ kind: "normal", count: 106 }, { kind: "runner", count: 54 }] },
    { interval: 1.8, zombies: [{ kind: "normal", count: 110 }, { kind: "runner", count: 60 }] },
    { interval: 1.8, zombies: [{ kind: "normal", count: 113 }, { kind: "runner", count: 67 }] },
  ],
  settings: {
    wave: {
      count: 8,
      base: 120,
      growth: 1.06,
      spawnBase: 12,
      spawnPerWave: 2,
      spawnMax: 80,
      maxAlive: 400,
      reinforce: 1,
    },
    human: { start: 50, cap: 50, hp: 100, speed: 54, sight: 420, turnTime: 2.8 },
    zombie: {
      jitter: 0.2,
      types: {
        normal: { hp: 80, speed: 48, bite: 0.55 },
        runner: { hp: 40, speed: 85, bite: 0.7 },
      },
    },
    opening: { doorHp: 450, winHp: 100, winPassSpeed: 0.45, buildBiteDamage: 4, buildBiteSlow: 1.5 },
  },
};
