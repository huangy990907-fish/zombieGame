/**
 * 像素精灵的基础类型定义。
 * 注意：这些文件是独立的「美术数据层」，不 import 任何游戏现有模块（config / renderer / world 等），
 * 目的是在渲染层重构期间也能独立预览，不产生耦合。
 */

/** 一帧像素画：32 行、每行 32 个字符；"." 代表透明 */
export type PixelFrame = string[];

/** 字模 → 十六进制颜色，例如 { g: "#63a04b" } */
export type Palette = Record<string, string>;

/** 帧名 → 像素矩阵（idle / walk1 / walk2 / fire / death-1 ...） */
export type Frames = Record<string, PixelFrame>;

/** 精灵分组；combo = 人 + 枪烘焙后的组合精灵 */
export type SpriteGroup = "zombie" | "human" | "weapon" | "combo";

/** 32×32 精灵内的像素坐标 */
export interface Vec2 {
  x: number;
  y: number;
}

/** 一个单位的完整像素精灵定义 */
export interface SpriteDef {
  /** 稳定 id，后续接入渲染层时按 id 取图 */
  id: string;
  /** 中文名，用于预览页标注 */
  name: string;
  group: SpriteGroup;
  /** 游戏内实际绘制直径（px），仅用于预览页还原 1:1 大小 */
  gameDiameter: number;
  /** 美术取舍说明，展示在预览页 */
  note: string;
  /**
   * 单位中心在 32×32 精灵内的像素坐标。
   * 渲染时把纹理的这个点钉在单位逻辑坐标上（Pixi 里即 sprite.anchor = anchor/32），
   * 这样旋转、缩放、碰撞体都以同一个中心为准。
   */
  anchor: Vec2;
  /** 开火帧枪口在 32×32 内的像素坐标；没有武器的精灵为 undefined */
  muzzle?: Vec2;
  /** 建议用于碰撞 / 遮挡排序的半径（单位：游戏像素） */
  footprintRadius: number;
  /** 统一画成朝上（枪管指向 -y），游戏里由渲染器旋转 */
  facing: "up";
  /** 作为叠加层（武器叠在人身上）烘焙时的像素偏移，仅武器使用 */
  overlay?: { dx: number; dy: number };
  palette: Palette;
  frames: Frames;
}

/** 所有精灵统一 32×32 */
export const SPRITE_SIZE = 32;

/** 默认描边色（深蓝黑，和游戏 #07070d 的地板色接近） */
export const OUTLINE_COLOR = "#0a0c14";
