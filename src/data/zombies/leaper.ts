import type { ZombieDef } from "../types";

/**
 * 飞扑者：体型小、血量低、移速明显快过狂奔。
 * 靠近可见人类后蓄力 0.8 秒，再以 3 倍移速直线扑过去；
 * 扑中进入压制，扑空硬直 1 秒。受击不会打断蓄力，只会延长。
 */
export const leaper: ZombieDef = {
  id: "leaper",
  name: "飞扑者",
  hp: 28,
  speed: 150,
  radius: 4,
  color: 0x67e8f9,
  bite: 0.6,
  damage: 12,
  pursuit: "breach",
  leap: {
    triggerRadius: 120,
    chargeTime: 0.8,
    hitExtend: 0.12,
    chargeMax: 2,
    leapSpeedMul: 3,
    leapMinTime: 0.15,
    leapMaxTime: 0.5,
    missStun: 1,
    pinDuration: 3,
    pinMoveMul: 0.4,
    pinDps: 8,
  },
};
