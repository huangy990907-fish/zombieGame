/**
 * 连通区域图 —— breach 追击的导航基础。
 *
 * 按 16px 网格把地图划成若干连通域：
 *  - 墙体不可穿越；
 *  - 完好的门窗一律视为边界（可以破坏，但暂时过不去）；
 *  - 已破坏的开口只有净宽 ≥ 僵尸身体直径时才可穿（胖子钻不过破窗）。
 * 因此同一张地图对不同体型会得到不同的连通结果，按 bodyDiameter 分别缓存。
 *
 * 构建只在 World 里按体型懒加载；开口破碎 / 换图时由 World.invalidateNavigation()
 * 清缓存。每帧只做一次 O(1) 的格子查询，不做全图扫描。
 */
import type { MapDef, Rect } from "../data/types";
import { CELL, openingNetWidth } from "./flowField";

/** 构建连通图需要的开口状态（只读，不持有 World 的实例） */
export interface OpeningState {
  id: string;
  rect: Rect;
  broken: boolean;
}

/**
 * 区域邻接边：一扇尚未破坏、且本体型能通过的开口。
 * 只连边、不预存破拆代价 —— 代价依赖僵尸自身的撕咬间隔与移速，
 * 由 AI 在 Dijkstra 时按个体折算，避免把某个单位的数值固化进公共缓存。
 */
export interface RegionEdge {
  openingId: string;
  from: number;
  to: number;
  /** 开口中心（寻路时的目标点） */
  x: number;
  y: number;
}

const EMPTY_EDGES: readonly number[] = [];

export class RegionMap {
  readonly cols: number;
  readonly rows: number;
  /** 连通域数量；0 表示整张图没有可站立的格子 */
  readonly count: number;
  readonly edges: RegionEdge[] = [];
  /** 每个连通域的格子下标（-1 = 墙体 / 不可穿越边界） */
  private readonly region: Int16Array;
  private readonly adjacency: number[][];

  constructor(map: MapDef, openings: readonly OpeningState[], bodyDiameter: number) {
    this.cols = Math.ceil(map.width / CELL);
    this.rows = Math.ceil(map.height / CELL);
    const cells = this.cols * this.rows;
    const blocked = new Uint8Array(cells);

    // 墙体与水池：与流场一致，用格子中心是否落在阻挡矩形内判定；
    // 水池是不可穿越边界，不进入开口候选。
    const solids = [...map.walls, ...map.waterBlockers];
    for (let gy = 0; gy < this.rows; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        const cx = (gx + 0.5) * CELL;
        const cy = (gy + 0.5) * CELL;
        for (const w of solids) {
          if (cx >= w.x && cx <= w.x + w.w && cy >= w.y && cy <= w.y + w.h) {
            blocked[gy * this.cols + gx] = 1;
            break;
          }
        }
      }
    }

    // 开口：完好的、以及破损但体型钻不过去的，都按边界处理
    for (const o of openings) {
      if (o.broken && openingNetWidth(o.rect) >= bodyDiameter) continue;
      const r = o.rect;
      for (let gy = 0; gy < this.rows; gy++) {
        for (let gx = 0; gx < this.cols; gx++) {
          const cx = (gx + 0.5) * CELL;
          const cy = (gy + 0.5) * CELL;
          if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
            blocked[gy * this.cols + gx] = 1;
          }
        }
      }
    }

    // 四连通洪水填充
    const region = new Int16Array(cells).fill(-1);
    const queue = new Int32Array(cells);
    let next = 0;
    for (let start = 0; start < cells; start++) {
      if (blocked[start] || region[start] >= 0) continue;
      let head = 0;
      let tail = 0;
      region[start] = next;
      queue[tail++] = start;
      while (head < tail) {
        const cur = queue[head++];
        const gy = Math.floor(cur / this.cols);
        const gx = cur - gy * this.cols;
        if (gx > 0) {
          const n = cur - 1;
          if (!blocked[n] && region[n] < 0) {
            region[n] = next;
            queue[tail++] = n;
          }
        }
        if (gx < this.cols - 1) {
          const n = cur + 1;
          if (!blocked[n] && region[n] < 0) {
            region[n] = next;
            queue[tail++] = n;
          }
        }
        if (gy > 0) {
          const n = cur - this.cols;
          if (!blocked[n] && region[n] < 0) {
            region[n] = next;
            queue[tail++] = n;
          }
        }
        if (gy < this.rows - 1) {
          const n = cur + this.cols;
          if (!blocked[n] && region[n] < 0) {
            region[n] = next;
            queue[tail++] = n;
          }
        }
      }
      next++;
    }
    this.region = region;
    this.count = next;
    this.adjacency = Array.from({ length: next }, () => []);

    // 区域邻接边：完好的、且本体型能通过的开口
    for (const o of openings) {
      if (o.broken) continue;
      if (openingNetWidth(o.rect) < bodyDiameter) continue;
      const sides = this.sidesOf(o.rect);
      for (let i = 0; i < sides.length; i++) {
        for (let j = i + 1; j < sides.length; j++) {
          if (sides[i] !== sides[j]) this.addEdge(o.id, o.rect, sides[i], sides[j]);
        }
      }
    }
  }

  /** 位置所在连通域；墙体 / 地图外返回 -1。每帧查询 O(1) */
  regionAt(x: number, y: number): number {
    const gx = Math.floor(x / CELL);
    const gy = Math.floor(y / CELL);
    if (gx < 0 || gy < 0 || gx >= this.cols || gy >= this.rows) return -1;
    return this.region[gy * this.cols + gx];
  }

  /**
   * 位置附近的连通域：正常位置等价于 regionAt；
   * 单位刚好压在墙沿 / 门窗框上时，在四周 4 格内找最近的可用区域。
   */
  regionNear(x: number, y: number): number {
    const direct = this.regionAt(x, y);
    if (direct >= 0) return direct;
    const gx = Math.floor(x / CELL);
    const gy = Math.floor(y / CELL);
    for (let r = 1; r <= 4; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          const nx = gx + ox;
          const ny = gy + oy;
          if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
          const v = this.region[ny * this.cols + nx];
          if (v >= 0) return v;
        }
      }
    }
    return -1;
  }

  /** 指定连通域的全部邻接边下标 */
  edgesOf(region: number): readonly number[] {
    return this.adjacency[region] ?? EMPTY_EDGES;
  }

  private addEdge(openingId: string, rect: Rect, a: number, b: number): void {
    const index = this.edges.length;
    this.edges.push({
      openingId,
      from: a,
      to: b,
      x: rect.x + rect.w * 0.5,
      y: rect.y + rect.h * 0.5,
    });
    this.adjacency[a].push(index);
    this.adjacency[b].push(index);
  }

  /** 从开口中心向四个方向探出，收集它两侧（或角落处多侧）的连通域 */
  private sidesOf(rect: Rect): number[] {
    const cx = rect.x + rect.w * 0.5;
    const cy = rect.y + rect.h * 0.5;
    const found = new Set<number>();
    const add = (r: number): void => {
      if (r >= 0) found.add(r);
    };
    add(this.probe(cx, cy, -1, 0, rect.w * 0.5));
    add(this.probe(cx, cy, 1, 0, rect.w * 0.5));
    add(this.probe(cx, cy, 0, -1, rect.h * 0.5));
    add(this.probe(cx, cy, 0, 1, rect.h * 0.5));
    return Array.from(found);
  }

  /**
   * 开口外侧相邻一格的连通域。
   * 只探一格：内置瓦片图墙体都是 1 格厚，多探会穿过墙体跑到墙外的
   * 另一个区域，凭空造出“破这扇门就能直达墙外”的假边。
   */
  private probe(cx: number, cy: number, dx: number, dy: number, halfSpan: number): number {
    return this.regionAt(cx + dx * (halfSpan + CELL * 0.5), cy + dy * (halfSpan + CELL * 0.5));
  }
}
