/**
 * 纯函数数学工具 —— 不依赖游戏状态，可独立测试。
 */
import type { Rect } from "../data/types";

/** 把 v 限制在 [lo, hi] 区间 */
export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 两点距离的平方（不开根号，比较大小用，性能更好） */
export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** 从 from 到 to 的最小角度差，结果落在 (-PI, PI] */
export function angDiff(from: number, to: number): number {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** 朝向 target 旋转，每步最多转 maxStep 弧度（让转身平滑而不是瞬间完成） */
export function turnToward(cur: number, target: number, maxStep: number): number {
  const d = angDiff(cur, target);
  if (Math.abs(d) <= maxStep) return target;
  return cur + Math.sign(d) * maxStep;
}

/**
 * 点 P 到线段 AB 距离的平方。
 * 子弹碰撞用：把“上一帧位置 -> 当前位置”当线段，避免高速子弹穿透丧尸。
 */
export function pointSegDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? (apx * abx + apy * aby) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = apx - abx * t;
  const dy = apy - aby * t;
  return dx * dx + dy * dy;
}

/** 点是否落在矩形内（pad 向外扩一圈） */
export function insideRect(x: number, y: number, r: Rect, pad = 0): boolean {
  return (
    x >= r.x - pad &&
    x <= r.x + r.w + pad &&
    y >= r.y - pad &&
    y <= r.y + r.h + pad
  );
}

/**
 * 线段 (ax,ay)-(bx,by) 是否与矩形 r 相交（slab 法）。
 * 视线 / 子弹的“被墙挡住”判定用：把线段在矩形上的投影区间
 * 和线段自身参数区间 [0,1] 求交，两个轴都有交集才算撞上。
 */
export function segRectHit(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  r: Rect,
): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  // X 轴投影区间
  if (dx === 0) {
    if (ax < r.x || ax > r.x + r.w) return false;
  } else {
    let ta = (r.x - ax) / dx;
    let tb = (r.x + r.w - ax) / dx;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
    }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  // Y 轴投影区间
  if (dy === 0) {
    if (ay < r.y || ay > r.y + r.h) return false;
  } else {
    let ta = (r.y - ay) / dy;
    let tb = (r.y + r.h - ay) / dy;
    if (ta > tb) {
      const tmp = ta;
      ta = tb;
      tb = tmp;
    }
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

/** 点到矩形的最近距离（点在矩形内部时为 0），丧尸“贴上门窗”判定用 */
export function pointRectDist(x: number, y: number, r: Rect): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  return Math.hypot(dx, dy);
}

/** 两个 0xRRGGBB 颜色按 t(0~1) 插值 */
export function mixColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Box-Muller 正态采样，返回标准正态样本 N(0,1)。
 * 成对生成，第二个缓存起来下次直接返回，避免重复算。
 */
let _gaussSpare = 0;
let _gaussHasSpare = false;
export function gaussNorm(): number {
  if (_gaussHasSpare) {
    _gaussHasSpare = false;
    return _gaussSpare;
  }
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const r = Math.sqrt(-2 * Math.log(u));
  const theta = 2 * Math.PI * v;
  _gaussSpare = r * Math.cos(theta);
  _gaussHasSpare = true;
  return r * Math.sin(theta);
}

/**
 * 正态采样 around mean，范围夹在 [min, max] 内。
 * jitter 是相对均值的系数（0.25 = ±25%），用 Box-Muller 采：
 *   sample = mean + N(0,1) * mean * jitter
 * 夹一下防止极端值（3σ 外的偶发个体不会炸数值平衡）。
 */
export function gaussClamped(mean: number, jitter: number, min: number, max: number): number {
  if (jitter <= 0) return mean;
  const raw = mean + gaussNorm() * mean * jitter;
  return Math.max(min, Math.min(max, raw));
}

/** [lo, hi) 均匀随机数 */
export function randRange(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}
