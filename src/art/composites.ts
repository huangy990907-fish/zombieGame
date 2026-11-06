/**
 * 烘焙组合精灵：人类 + 五把武器，每种 4 帧（idle / walk1 / walk2 / fire）。
 * 这里在模块加载时就把武器压进人物帧，产物是普通的 SpriteDef，
 * 接入渲染层时不需要再叠两层，也不会重复计算 overlay。
 */
import { bakeOverlay } from "./bake";
import { SPRITE_LIST } from "./sprites";
import type { SpriteDef, Vec2 } from "./types";

/** 人物帧 → 组合帧：walk 用武器 idle，fire 用人类 idle + 武器 fire */
const FRAME_PAIRS = [
  { name: "idle", base: "idle", overlay: "idle" },
  { name: "walk1", base: "walk1", overlay: "idle" },
  { name: "walk2", base: "walk2", overlay: "idle" },
  { name: "fire", base: "idle", overlay: "fire" },
];

/**
 * fire 帧枪口坐标（32×32 内）：武器枪口在局部 (16,3~5)，叠加 dx=8 / dy=2 后落到这里。
 * 霰弹枪的枪口落在左侧那根管子上（双管中间的缝是透明像素）。
 */
const MUZZLE_BY_WEAPON: Record<string, Vec2> = {
  "weapon-mg": { x: 24, y: 5 },
  "weapon-flame": { x: 24, y: 5 },
  "weapon-shotgun": { x: 22, y: 5 },
  "weapon-rocket": { x: 24, y: 5 },
  "weapon-tesla": { x: 24, y: 4 },
};

function findSprite(id: string): SpriteDef {
  const def = SPRITE_LIST.find((sprite) => sprite.id === id);
  if (!def) throw new Error(`找不到精灵 ${id}`);
  return def;
}

const human = findSprite("human");

export const COMBO_SPRITES: SpriteDef[] = SPRITE_LIST.filter((sprite) => sprite.group === "weapon").map((weapon) => {
  const { palette, frames } = bakeOverlay(human, weapon, FRAME_PAIRS);
  const muzzle = MUZZLE_BY_WEAPON[weapon.id];
  return {
    id: `human-${weapon.id.replace("weapon-", "")}`,
    name: `人类 + ${weapon.name}`,
    group: "combo",
    gameDiameter: human.gameDiameter,
    note: `烘焙精灵：${weapon.name} 已按 dx=${weapon.overlay?.dx ?? 0} / dy=${weapon.overlay?.dy ?? 0} 压进人类帧，fire 帧枪口在 (${muzzle.x},${muzzle.y})`,
    anchor: human.anchor,
    muzzle,
    footprintRadius: human.footprintRadius,
    facing: "up",
    palette,
    frames,
  };
});
