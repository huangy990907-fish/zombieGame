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

/** 常用 id 常量，避免在玩法代码里散落字符串字面量 */
export const ZOMBIE_IDS = {
  normal: normal.id,
  runner: runner.id,
} as const;

/** 按 id 取定义；未知 id 回落到普通丧尸，保证旧存档 / 脏数据不崩溃 */
export function getZombieDef(id: string): ZombieDef {
  return ZOMBIE_DEFS[id] ?? normal;
}
