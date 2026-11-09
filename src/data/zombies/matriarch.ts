import type { ZombieDef } from "../types";

/**
 * BOSS「母体」：慢、极肉、体型巨大（半径 20，身体直径 40，只能走门）。
 * 不主动攻击人类，但会周期性从体内产出求生池里的非 BOSS 僵尸；
 * 被击杀时再一次性产出一波作为最后反扑。
 * 数值全部集中在这里；求生需要独立平衡时走 SURVIVAL_ZOMBIE_OVERRIDES。
 */
export const matriarch: ZombieDef = {
  id: "matriarch",
  name: "母体",
  hp: 4000,
  speed: 22,
  radius: 20,
  color: 0x9f1239,
  bite: 1.2,
  damage: 0,
  pursuit: "breach",
  boss: true,
  noAttack: true,
  spawner: {
    interval: 6,
    count: 2,
    cap: 10,
    deathCount: 12,
    childXpMul: 0.7,
  },
};
