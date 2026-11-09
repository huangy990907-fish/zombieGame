/**
 * 像素精灵接入游戏的适配层（纯函数，不依赖 PixiJS）。
 *
 * 美术精灵统一画成「朝上」（枪管指向局部 -y），而引擎角度 0 指向 +x；
 * 朝向换算、锚点缩放、枪口世界坐标都在这里定义一次，渲染层和战斗层共用。
 */
import { SPRITE_SIZE, getSprite, spriteGrid, type SpriteDef, type Vec2 } from "../art";
import { HUMAN_DEF } from "../data/humans";

/**
 * 纯视觉放大倍数：只作用于精灵缩放，不参与碰撞 / 分离 / 寻路等物理判定。
 * 32px 精灵四周有透明留白，1.5 倍后人类可见宽度约 12.4px，接近 12px 碰撞直径。
 */
export const VISUAL_SCALE = 1.5;

/** 人类精灵直径（碰撞半径 6 → 逻辑 12px，视觉 18px） */
export const HUMAN_DIAMETER = HUMAN_DEF.radius * 2 * VISUAL_SCALE;

/**
 * 精灵朝上、引擎 0 朝右 → 渲染旋转角 = 逻辑角 + 90°。
 * 全项目只在这里写一次换算。
 */
export function spriteRotation(angle: number): number {
  return angle + Math.PI / 2;
}

/** 精灵定义缓存：渲染每帧会按 id 取图，避免每次调用都重新拼表 / 线性查找 */
const defCache = new Map<string, SpriteDef>();
const humanIdCache = new Map<string, string>();
const zombieIdCache = new Map<string, string>();

/** 按 id 取精灵定义（带缓存），找不到时退回人类素体 */
export function spriteDef(id: string): SpriteDef {
  let def = defCache.get(id);
  if (!def) {
    def = getSprite(id) ?? getSprite("human")!;
    defCache.set(id, def);
  }
  return def;
}

/** 人类按武器 id 取烘焙组合精灵（human-mg / human-flame / ...），缺图时退回素体 */
export function humanSpriteId(weapon: string): string {
  let id = humanIdCache.get(weapon);
  if (!id) {
    id = getSprite(`human-${weapon}`) ? `human-${weapon}` : "human";
    humanIdCache.set(weapon, id);
  }
  return id;
}

/** 僵尸按类型 id 取精灵（zombie-normal / zombie-runner / ...），缺图时退回普通僵尸 */
export function zombieSpriteId(kind: string): string {
  let id = zombieIdCache.get(kind);
  if (!id) {
    id = getSprite(`zombie-${kind}`) ? `zombie-${kind}` : "zombie-normal";
    zombieIdCache.set(kind, id);
  }
  return id;
}

/** 倒地精灵按类型 id 取（zombie-fat-death / ...），缺图时退回通用倒地帧 */
export function zombieDeathSpriteId(kind: string): string {
  const id = `zombie-${kind}-death`;
  return getSprite(id) ? id : "zombie-death";
}

/**
 * 缩放系数：单位直径 / 精灵实际网格边长。
 * 不假设固定 32：巨体型单位（如母体）用更大的网格时，按声明的 grid 推导，
 * 32×32 与 64×64 等任意网格都能得到一致的视觉直径。
 * 渲染时 anchor 已用 spriteAnchor() 对齐躯干中心。
 */
export function spriteScale(diameter: number, def?: SpriteDef): number {
  const side = def ? Math.max(spriteGrid(def).w, spriteGrid(def).h) : SPRITE_SIZE;
  return diameter / side;
}

/** 精灵锚点的归一化坐标（0..1）：按实际网格宽高换算，供 Pixi 的 anchor 使用 */
export function spriteAnchor(def: SpriteDef): Vec2 {
  const grid = spriteGrid(def);
  return { x: def.anchor.x / grid.w, y: def.anchor.y / grid.h };
}

/**
 * 枪口世界坐标：把精灵网格里的 (muzzle - anchor) 按朝向旋转、再按缩放折算成游戏像素。
 * 没有 muzzle 的精灵沿正前方取 12px（局部 -y），保证总有一个合理的出膛点。
 */
export function muzzleWorld(def: SpriteDef, x: number, y: number, angle: number, diameter: number): Vec2 {
  const scale = spriteScale(diameter, def);
  const lx = (def.muzzle?.x ?? def.anchor.x) - def.anchor.x;
  const ly = (def.muzzle?.y ?? def.anchor.y - 12) - def.anchor.y;
  const r = spriteRotation(angle);
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return {
    x: x + (lx * cos - ly * sin) * scale,
    y: y + (lx * sin + ly * cos) * scale,
  };
}

/** 人类枪口世界坐标；子弹与火舌都从这里出膛 */
export function humanMuzzle(weapon: string, x: number, y: number, angle: number): Vec2 {
  return muzzleWorld(spriteDef(humanSpriteId(weapon)), x, y, angle, HUMAN_DIAMETER);
}
