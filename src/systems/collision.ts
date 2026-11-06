/**
 * 共享的移动阻挡判定 —— 人类与丧尸都走这一处，避免各处复制条件。
 *
 * 判定口径（与开口通行规则一致）：
 *  - 墙体（含地图边界墙）永远阻挡；
 *  - 完好的门窗一律阻挡；
 *  - 已破坏的开口：净宽 < 身体直径时仍按实体墙处理（胖子钻不过 16px 窗）；
 *  - bodyDiameter <= 0 表示不做体型过滤（只判墙体与完好开口）。
 *
 * 以后接入水域 / 其它新地形时，只需在这里登记新的阻挡矩形，
 * 人类、丧尸与生成落点会同时生效。
 */
import type { Rect, SpawnRegion } from "../data/types";
import { clamp, insideRect } from "../utils/math";
import { openingNetWidth } from "./flowField";

/** 阻挡判定只关心开口的矩形与破损状态，不依赖运行时 Opening 的其它字段 */
export interface OpeningBlocker {
  rect: Rect;
  broken: boolean;
}

export function isBlockedForBody(
  bodyDiameter: number,
  x: number,
  y: number,
  walls: readonly Rect[],
  openings: readonly OpeningBlocker[],
  pad = 0,
): boolean {
  for (const w of walls) {
    if (insideRect(x, y, w, pad)) return true;
  }
  for (const o of openings) {
    const tooNarrow = bodyDiameter > 0 && openingNetWidth(o.rect) < bodyDiameter;
    if ((!o.broken || tooNarrow) && insideRect(x, y, o.rect, pad)) return true;
  }
  return false;
}

/**
 * 在指定区域内找一个不被阻挡的落点：先试给定点，再按 8px 递增向外找，
 * 最后按 16px 网格兜底。随机出生 / 巡逻目标点用它，避免把单位放进墙里。
 */
export function findFreePoint(
  bodyDiameter: number,
  x: number,
  y: number,
  walls: readonly Rect[],
  openings: readonly OpeningBlocker[],
  area: SpawnRegion,
  pad = 0,
): { x: number; y: number } | null {
  const cx = clamp(x, area.x0, area.x1);
  const cy = clamp(y, area.y0, area.y1);
  if (!isBlockedForBody(bodyDiameter, cx, cy, walls, openings, pad)) {
    return { x: cx, y: cy };
  }

  const maxRadius = Math.max(area.x1 - area.x0, area.y1 - area.y0);
  for (let r = 8; r <= maxRadius; r += 8) {
    const steps = Math.max(8, Math.ceil(r / 2));
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      const px = clamp(cx + Math.cos(a) * r, area.x0, area.x1);
      const py = clamp(cy + Math.sin(a) * r, area.y0, area.y1);
      if (!isBlockedForBody(bodyDiameter, px, py, walls, openings, pad)) {
        return { x: px, y: py };
      }
    }
  }

  // 兜底：区域整体网格扫描（窄区域 / 环形区域也能找到空隙）
  for (let py = area.y0; py <= area.y1; py += 16) {
    for (let px = area.x0; px <= area.x1; px += 16) {
      if (!isBlockedForBody(bodyDiameter, px, py, walls, openings, pad)) {
        return { x: px, y: py };
      }
    }
  }
  return null;
}
