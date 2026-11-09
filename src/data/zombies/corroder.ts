import type { ZombieDef } from "../types";

/**
 * 腐蚀者：体型接近普通、血量低、移速较慢。
 * 对 200px 内可见人类远程吐毒，在落点留下一团持续伤害 + 减速的毒液；
 * 死亡时在尸体位置留下更大、稍短的一团毒液。
 */
export const corroder: ZombieDef = {
  id: "corroder",
  name: "腐蚀者",
  hp: 55,
  speed: 38,
  radius: 5.5,
  color: 0x84cc16,
  bite: 0.65,
  damage: 15,
  pursuit: "breach",
  spit: {
    range: 200,
    cooldown: 3.5,
    radius: 40,
    duration: 6,
    dps: 6,
    speedMul: 0.8,
    deathRadius: 48,
    deathDuration: 5,
  },
};
