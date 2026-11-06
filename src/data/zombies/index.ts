import type { ZombieDef } from "../types";
import { fat } from "./fat";
import { normal } from "./normal";
import { runner } from "./runner";

/**
 * 僵尸注册表：id -> 定义。
 * 新增一种僵尸：新建文件，在这里加一行；训练场按钮与统计列会自动出现。
 */
export const ZOMBIE_DEFS: Record<string, ZombieDef> = {
  normal,
  runner,
  fat,
};

/** 有序列表（插入顺序）—— 只影响默认展示顺序，身份始终用 id */
export const ZOMBIE_LIST: ZombieDef[] = Object.values(ZOMBIE_DEFS);

/** 全部僵尸里最大的物理碰撞半径 —— 空间查询边距按它推导，避免写死常量 */
export const MAX_ZOMBIE_RADIUS = Math.max(...ZOMBIE_LIST.map((z) => z.radius));

/**
 * 通行判定用的身体直径 = 可见体宽 = 2 × 碰撞半径。
 * 开口净宽小于它时不可通过；渲染盒宽再乘 VISUAL_SCALE（见 render/pixel.ts），
 * 1.5 只是精灵透明留白的视觉补偿，不参与通行 / 碰撞。
 */
export function zombieBodyDiameter(def: ZombieDef): number {
  return def.radius * 2;
}

/**
 * 受击减速参数（战斗层 systems/combat.ts 写入，行为层 systems/ai.ts 读取）。
 *
 * 每次受击按伤害量换算成一次减速：倍率 = 1 - damage * perDamage，
 * 最低压到 floorMul；随后 duration 秒内线性恢复到 100%。
 * 多次受击不叠加，只保留当前最强的一次并刷新恢复计时。
 * 大体型（身体直径达到 heavyDiameter）减速幅度减半，最低只到 heavyFloorMul。
 */
export const ZOMBIE_SLOW = {
  /** 线性恢复到满速所需的时间（秒） */
  duration: 0.6,
  /** 每 1 点伤害造成的减速比例 */
  perDamage: 0.04,
  /** 普通体型的最低移速倍率 */
  floorMul: 0.4,
  /** 大体型单位（胖子等）的最低移速倍率 */
  heavyFloorMul: 0.7,
  /** 大体型的减速幅度乘数（0.5 = 减半） */
  heavyScale: 0.5,
  /** 身体直径达到该值即视为大体型（胖子 22） */
  heavyDiameter: 20,
  /** 喷火这类持续伤害最多每秒结算一次减速（秒） */
  flameInterval: 1,
} as const;

/**
 * 零人类时丧尸的漫游参数（行为层 systems/ai.ts 读取）。
 * 以后若要做不同索敌机制的僵尸，可把这份参数扩展成 ZombieDef 的可选字段，
 * 按类型覆盖而不必改行为逻辑。
 */
export const WANDER_TUNING = {
  /** 漫游移速相对正常移速的比例 */
  speedScale: 0.55,
  /** 朝同一方向持续移动的时长下限 / 上限（秒） */
  moveMin: 1.5,
  moveMax: 3,
  /** 两次移动之间的停顿下限 / 上限（秒） */
  restMin: 0.4,
  restMax: 1.2,
} as const;

/** 常用 id 常量，避免在玩法代码里散落字符串字面量 */
export const ZOMBIE_IDS = {
  normal: normal.id,
  runner: runner.id,
  fat: fat.id,
} as const;

/** 按 id 取定义；未知 id 回落到普通丧尸，保证旧存档 / 脏数据不崩溃 */
export function getZombieDef(id: string): ZombieDef {
  return ZOMBIE_DEFS[id] ?? normal;
}
