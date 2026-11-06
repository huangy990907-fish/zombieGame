import type { ZombieDef } from "../types";

/**
 * 胖子：皮厚、走得慢、体型大。
 * 碰撞半径 11（普通 5.5 的两倍），体型半径 22 —— 直径 44 > 窗洞净宽 36，
 * 所以按通用通行规则只能走门，不能钻窗。
 */
export const fat: ZombieDef = {
  id: "fat",
  name: "胖子",
  hp: 300,
  speed: 32,
  radius: 11,
  visualRadius: 22,
  color: 0xb06a7f,
  bite: 0.85,
};
