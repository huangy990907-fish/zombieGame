import type { ZombieDef } from "../types";
import { normal } from "./normal";
import { runner } from "./runner";

/**
 * 僵尸注册表：id -> 定义。
 * 新增一种僵尸：新建文件，在这里加一行；训练场按钮与统计列会自动出现。
 */
export const ZOMBIE_DEFS: Record<string, ZombieDef> = {
  normal,
  runner,
};

/** 有序列表（插入顺序）—— 只影响默认展示顺序，身份始终用 id */
export const ZOMBIE_LIST: ZombieDef[] = Object.values(ZOMBIE_DEFS);

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
} as const;

/** 按 id 取定义；未知 id 回落到普通丧尸，保证旧存档 / 脏数据不崩溃 */
export function getZombieDef(id: string): ZombieDef {
  return ZOMBIE_DEFS[id] ?? normal;
}
