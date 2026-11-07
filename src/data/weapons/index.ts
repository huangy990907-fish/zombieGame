import type { WeaponDef } from "../types";
import { flame } from "./flame";
import { mg } from "./mg";
import { rocket } from "./rocket";
import { shotgun } from "./shotgun";
import { tesla } from "./tesla";

/**
 * 武器注册表：id -> 定义。
 * 新增一种武器：新建文件，在这里加一行；训练场按钮、HUD 兵种栏与统计列会自动出现。
 */
export const WEAPONS: Record<string, WeaponDef> = {
  mg,
  flame,
  shotgun,
  rocket,
  tesla,
};

/** 有序列表（插入顺序）—— 仅用于默认展示与配比，身份始终用 id */
export const WEAPON_LIST: WeaponDef[] = Object.values(WEAPONS);

/** 常用 id 常量 */
export const WEAPON_IDS = {
  mg: mg.id,
  flame: flame.id,
  shotgun: shotgun.id,
  rocket: rocket.id,
  tesla: tesla.id,
} as const;

/** 按 id 取定义；未知 id 回落到机枪，保证旧存档 / 脏数据不崩溃 */
export function getWeaponDef(id: string): WeaponDef {
  return WEAPONS[id] ?? mg;
}
