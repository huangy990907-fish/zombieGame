import type { ZombieDef } from "../types";

/** 普通丧尸：慢、肉 */
export const normal: ZombieDef = {
  id: "normal",
  name: "普通",
  hp: 90,
  speed: 50,
  radius: 5.5,
  color: 0x8b5cf6,
  bite: 0.55,
};
