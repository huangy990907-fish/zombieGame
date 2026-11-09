import type { ZombieDef } from "../types";

/**
 * 「尖叫者」：中等移速、低血量、不主动攻击人类。
 * 每隔一段时间尖叫，强化半径内的其他僵尸（移速 / 攻击力 / 受伤减免）；
 * 不强化 BOSS，也不强化自己。
 */
export const screamer: ZombieDef = {
  id: "screamer",
  name: "尖叫者",
  hp: 40,
  speed: 60,
  radius: 5.5,
  color: 0xf472b6,
  bite: 0.8,
  damage: 0,
  pursuit: "breach",
  noAttack: true,
  scream: {
    interval: 8,
    radius: 200,
    duration: 6,
    speedMul: 1.3,
    damageMul: 1.5,
    damageTakenMul: 0.7,
  },
};
