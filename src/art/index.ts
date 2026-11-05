/**
 * 美术数据层的统一出口。
 * 只依赖同目录下的 types / sprites / bake / composites / render，不依赖游戏其它模块。
 */
import { COMBO_SPRITES } from "./composites";
import { SPRITE_LIST } from "./sprites";

export { SPRITE_LIST } from "./sprites";
export { COMBO_SPRITES } from "./composites";
export { bakeOverlay } from "./bake";
export * from "./types";
export * from "./render";

/** 按 id 取精灵定义（单体 + 组合），找不到返回 undefined */
export function getSprite(id: string) {
  return [...SPRITE_LIST, ...COMBO_SPRITES].find((sprite) => sprite.id === id);
}
