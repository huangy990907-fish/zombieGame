/**
 * 伤害飘字的共享实现。
 *
 * 训练场（Pixi Text）和调参页预览（2D canvas）共用同一份数据与节奏：
 *  - 生成规则：位置抖动 ±5px、起点上移 8px、寿命 0.55s、上飘 34px/s
 *  - 透明度：前 65% 保持不透明，之后线性淡出
 *  - 缩放：从 1 放大到 1.22
 *  - 样式：monospace 14px / 700 字重 / 3px 黑描边、颜色跟随武器
 * 渲染层只负责把字段画出来（Pixi Text 或 canvas fillText），不另算一套公式。
 */

export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: number;
  age: number;
  life: number;
  /** 每秒上飘速度（像素/秒） */
  vy: number;
  /** 额外缩放（默认 1；换弹提示用它画得小一点） */
  scale?: number;
}

export const MAX_FLOATERS = 160;
export const FLOATING_LIFE = 0.55;
export const FLOATING_VY = -34;
export const FLOATING_FONT_FAMILY = "monospace";
export const FLOATING_FONT_SIZE = 14;
export const FLOATING_FONT_WEIGHT = "700";
export const FLOATING_STROKE_WIDTH = 3;

/** 压入一条伤害飘字（被训练场与调参预览共用） */
export function pushFloating(
  list: FloatingText[],
  x: number,
  y: number,
  text: string,
  color: number,
  scale?: number,
): void {
  if (list.length >= MAX_FLOATERS) return;
  list.push({
    x: x + (Math.random() - 0.5) * 10,
    y: y - 8,
    text,
    color,
    age: 0,
    life: FLOATING_LIFE,
    vy: FLOATING_VY,
    scale,
  });
}

/** 推进飘字生命周期（训练场与预览共用同一套计时/位移） */
export function ageFloating(list: FloatingText[], dt: number): void {
  let w = 0;
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    f.age += dt;
    f.y += f.vy * dt;
    if (f.age < f.life) list[w++] = f;
  }
  list.length = w;
}

/** 0..1 的生命进度 */
export function floatingProgress(f: FloatingText): number {
  return Math.min(1, f.age / f.life);
}

/** 透明度：前 65% 不透明，之后淡出 */
export function floatingAlpha(f: FloatingText): number {
  const p = floatingProgress(f);
  return p < 0.65 ? 1 : (1 - p) / 0.35;
}

/** 缩放：1 → 1.22 */
export function floatingScale(f: FloatingText): number {
  return 1 + floatingProgress(f) * 0.22;
}

/** 数字颜色转 CSS（canvas 用） */
export function floatingColorCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}
