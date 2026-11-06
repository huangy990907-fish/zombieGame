import type { WeaponDef } from "../types";

/**
 * 电击枪：瞬时命中（hitscan），无飞行物。
 * 首个目标 96px 内没有其他僵尸时伤害 ×2.2；
 * 否则从首个目标开始向最近的可见僵尸跳跃，最多命中 5 只（含首个），每跳衰减 25%。
 */
export const tesla: WeaponDef = {
  id: "tesla",
  name: "电击枪",
  color: 0x2dd4bf,
  kind: "tesla",
  range: 200,
  damage: 34,
  cooldown: 0.9,
  magazine: 10,
  reload: 1.8,
  speed: 0,
  spread: 0,
  pellets: 1,
  blast: 0,
  burst: 0,
  blastDamage: 0,
  tesla: {
    chainRadius: 96,
    chainMaxTargets: 5,
    chainFalloff: 0.75,
    singleBonus: 2.2,
    singleRadius: 96,
  },
};
