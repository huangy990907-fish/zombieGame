import type { ZombieDef } from "../types";

/** 狂奔丧尸：快、脆 */
export const runner: ZombieDef = {
  id: "runner",
  name: "狂奔",
  hp: 62,
  speed: 90,
  radius: 4.5,
  color: 0xc77dff,
  bite: 0.7,
  damage: 18,
  pursuit: "breach",
};
