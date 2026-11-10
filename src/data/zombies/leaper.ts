import type { ZombieDef } from "../types";

/**
 * 飞扑者：体型小、血量低、移速明显快过狂奔。
 * 靠近可见人类后蓄力 0.8 秒，再以 3 倍移速直线扑过去；
 * 扑中附在人类身上压制（不能移动 / 开火，持续掉血），
 * 扑空或挣脱后冷却 3 秒，期间只移动、不攻击。
 * 攻击方式只有飞扑：不撕咬人类（damage 0 + noAttack），但仍会啃门窗。
 */
export const leaper: ZombieDef = {
  id: "leaper",
  name: "飞扑者",
  hp: 30,
  speed: 150,
  // 身体直径 11（半径 5.5）：插图按新体型重画，通行净宽 / 区域图都按它推导
  radius: 5.5,
  color: 0x67e8f9,
  bite: 0.6,
  damage: 0,
  pursuit: "breach",
  noAttack: true,
  leap: {
    triggerRadius: 120,
    chargeTime: 0.8,
    hitExtend: 0.12,
    chargeMax: 2,
    leapSpeedMul: 3,
    leapMinTime: 0.15,
    leapMaxTime: 0.5,
    missStun: 3,
    pinDuration: 5,
    // 0 = 附身期间完全不能移动；开火在 ai.ts 里由 pinned 统一禁用
    pinMoveMul: 0,
    pinDps: 4,
    pinKnockback: 18,
  },
};
