import type { HumanDef } from "./types";

/**
 * 人类基础定义。
 * 武器决定外观与战斗方式（见 data/weapons），人类本身的体型 / 移动 / 视野走这里。
 */
export const HUMAN_DEF: HumanDef = {
  id: "human",
  name: "人类",
  hp: 100,
  speed: 54,
  radius: 6,
  sight: 420,
  turnTime: 2.8,
};
