import type { WeaponDef } from "../types";

/** 喷火：锥形持续伤害，按燃料轮次消耗 */
export const flame: WeaponDef = {
  id: "flame",
  name: "喷火",
  color: 0xff6b3d,
  kind: "flame",
  range: 158,
  /** 每 0.06 秒结算一次的伤害，1.1 秒一轮约 18 次 ≈ 23 点 */
  damage: 1.3,
  /** 喷射期间两次伤害结算的间隔 */
  cooldown: 0.06,
  /** 燃料：可喷射的轮数 */
  magazine: 8,
  /** 每一轮喷完后的散热时间 */
  reload: 1.35,
  speed: 0,
  /** 锥形半角，越大火焰越散 */
  spread: 0.32,
  pellets: 1,
  blast: 0,
  /** 单轮持续喷射 1.1 秒 */
  burst: 1.1,
  blastDamage: 0,
};
