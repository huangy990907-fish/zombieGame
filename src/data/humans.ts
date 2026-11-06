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

/** 通行 / 碰撞口径：身体直径 = 可见体宽 = 2 × 碰撞半径（与丧尸同一口径） */
export const HUMAN_BODY_DIAMETER = HUMAN_DEF.radius * 2;
