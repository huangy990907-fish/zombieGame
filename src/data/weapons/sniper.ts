import { mg } from "./mg";
import type { WeaponDef } from "../types";

/**
 * 狙击枪：低射速、高单发、全武器最远射程。
 * 数值全部相对机枪推导，避免出现对不上口径的魔法常量：
 *  - 射程 = 机枪 × 2（550，超过火箭的 480）
 *  - 单发伤害 = 机枪 × 7（42）
 *  - 弹速 = 机枪 × 2（1560，配合曳光拖尾看得出弹道）
 * 冷却 / 弹匣 / 换弹按 1.6s / 5 发 / 2.2s。
 *
 * 子弹命中后不消失，继续沿弹道飞行：第二个目标吃 60% 伤害，同一条弹道最多命中 2 个目标。
 * 命中减速比通用口径更强（0.75 倍），普通体型最低 30%、大体型 52.5%。
 */
export const sniper: WeaponDef = {
  id: "sniper",
  name: "狙击枪",
  color: 0x93c5fd,
  kind: "bullet",
  range: mg.range * 2,
  damage: mg.damage * 7,
  cooldown: 1.6,
  magazine: 5,
  reload: 2.2,
  speed: mg.speed * 2,
  /** 精确射击：不散布，也不惩罚移速 */
  spread: 0,
  pellets: 1,
  blast: 0,
  burst: 0,
  blastDamage: 0,
  pierce: { maxTargets: 2, falloff: 0.6 },
  /** 曳光拖尾长度（像素）：高速弹丸靠这条亮线让玩家看清弹道 */
  tracer: 28,
  hitSlowMul: 0.75,
};
