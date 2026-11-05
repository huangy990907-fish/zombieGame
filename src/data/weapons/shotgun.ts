import type { WeaponDef } from "../types";

/** 霰弹：一发多颗弹丸 */
export const shotgun: WeaponDef = {
  id: "shotgun",
  name: "霰弹",
  color: 0xffa34d,
  kind: "pellet",
  range: 190,
  damage: 5.5,
  cooldown: 0.8,
  magazine: 7,
  reload: 1.6,
  speed: 560,
  spread: 0.24,
  pellets: 5,
  blast: 0,
  burst: 0,
  blastDamage: 0,
};
