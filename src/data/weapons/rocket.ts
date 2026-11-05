import type { WeaponDef } from "../types";

/** 火箭：弹道 + 范围爆炸 */
export const rocket: WeaponDef = {
  id: "rocket",
  name: "火箭",
  color: 0xff3d7f,
  kind: "rocket",
  range: 480,
  damage: 20,
  cooldown: 1.9,
  magazine: 4,
  reload: 2.4,
  speed: 340,
  spread: 0.02,
  pellets: 1,
  blast: 62,
  burst: 0,
  blastDamage: 44,
};
