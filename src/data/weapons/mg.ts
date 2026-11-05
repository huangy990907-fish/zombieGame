import type { WeaponDef } from "../types";

/** 机枪：射速高，直线子弹 */
export const mg: WeaponDef = {
  id: "mg",
  name: "机枪",
  color: 0xffe14d,
  kind: "bullet",
  range: 275,
  damage: 6,
  cooldown: 0.1,
  magazine: 60,
  reload: 1.4,
  speed: 780,
  spread: 0.05,
  pellets: 1,
  blast: 0,
  burst: 0,
  blastDamage: 0,
};
