import type { ZombieDef } from "../types";

/**
 * 胖子：皮厚、走得慢、体型大。
 * 碰撞半径 11（普通 5.5 的两倍），身体直径 22（可见体宽与通行口径一致），
 * 绘制盒宽 = 22 × VISUAL_SCALE 1.5 = 33px。22 > 窗净宽 18，所以只能走门、不能钻窗。
 * 体型只影响通行判定与显示，碰撞半径、命中与咬人距离仍按 11 推导。
 */
export const fat: ZombieDef = {
  id: "fat",
  name: "胖子",
  hp: 300,
  speed: 32,
  radius: 11,
  color: 0xb06a7f,
  bite: 0.85,
  damage: 40,
  pursuit: "breach",
};
