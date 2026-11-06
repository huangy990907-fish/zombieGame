/**
 * 流场寻路（Flow Field）—— 尸潮寻路的性能关键。
 *
 * 常规做法是给每只丧尸跑 A*，几千只一起跑会卡死。
 * 流场反过来：以“所有门窗开口”为起点做多源 BFS，给整张地图算出
 * “每个格子下一步该往哪走才能到达最近的开口”，几千只丧尸共享同一张表。
 *
 * 注意：开口本身不算阻挡 —— 完好的门窗在移动层拦住丧尸（贴上去啃），
 * 破了以后不用重建流场，尸流自然从破口灌进来。
 *
 * 使用：丧尸在房间外时调用 sample(x, y)，取返回对象的 x/y 作为移动方向。
 */
import type { MapDef, Rect } from "../data/types";

export const CELL = 16;
const UNREACHABLE = 65535;

/** 开口净宽：门是 12×80 → 80，窗是 18×12 → 18（取长边） */
export function openingNetWidth(rect: Rect): number {
  return Math.max(rect.w, rect.h);
}

export class FlowField {
  /** 1 = 墙体不可走 */
  private blocked: Uint8Array;
  /** 到最近开口的格子距离，UNREACHABLE 表示走不到 */
  private dist: Uint16Array;
  private dirX: Float32Array;
  private dirY: Float32Array;
  private cols: number;
  private rows: number;
  /** 可通行开口中心（体型过滤后的 BFS 源 + fallback 目标） */
  private sources: { x: number; y: number }[];
  /** sample() 的输出：该位置应移动的单位方向 */
  x = 0;
  y = 0;

  /**
   * @param bodyDiameter 通行直径。>0 时，净宽小于它的开口视为不可通行：
   *   其矩形覆盖的格子标成阻挡、也不再作为 BFS 源，流场会自然绕到别的开口。
   *   0 表示不做体型过滤（原行为：所有开口都可用）。
   */
  constructor(
    map: MapDef,
    bodyDiameter = 0,
  ) {
    this.cols = Math.ceil(map.width / CELL);
    this.rows = Math.ceil(map.height / CELL);
    const cells = this.cols * this.rows;
    this.blocked = new Uint8Array(cells);
    this.dist = new Uint16Array(cells);
    this.dirX = new Float32Array(cells);
    this.dirY = new Float32Array(cells);

    const passable = map.openings
      .map((o) => ({ o, width: openingNetWidth(o.rect) }))
      .filter(({ width }) => bodyDiameter <= 0 || width >= bodyDiameter);
    this.sources = passable.map(({ o }) => ({
      x: o.rect.x + o.rect.w * 0.5,
      y: o.rect.y + o.rect.h * 0.5,
    }));
    if (this.sources.length === 0) this.sources = map.openingCenters;

    // 先把所有被墙体覆盖的格子标记为不可走（门窗开口不算墙）；
    // 体型过不去的开口同样按阻挡处理，避免胖子顺着流场顶到窗边。
    for (let gy = 0; gy < this.rows; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        const cx = (gx + 0.5) * CELL;
        const cy = (gy + 0.5) * CELL;
        let solid = false;
        for (const w of map.walls) {
          if (cx >= w.x && cx <= w.x + w.w && cy >= w.y && cy <= w.y + w.h) {
            solid = true;
            break;
          }
        }
        if (!solid) {
          for (const o of map.openings) {
            if (bodyDiameter > 0 && openingNetWidth(o.rect) < bodyDiameter) {
              const r = o.rect;
              if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) {
                solid = true;
                break;
              }
            }
          }
        }
        if (solid) this.blocked[gy * this.cols + gx] = 1;
      }
    }
    this.bake();
  }

  /** 从所有开口中心同时开始 BFS（多源），得到“到最近开口”的距离场 */
  private bake(): void {
    const { cols, rows, blocked, dist } = this;
    dist.fill(UNREACHABLE);

    // BFS：每个开口距离为 0，一圈一圈向外扩散
    const queue = new Int32Array(cols * rows);
    let head = 0;
    let tail = 0;
    for (const c of this.sources) {
      const gx = Math.floor(c.x / CELL);
      const gy = Math.floor(c.y / CELL);
      const i = gy * cols + gx;
      if (blocked[i] || dist[i] !== UNREACHABLE) continue;
      dist[i] = 0;
      queue[tail++] = i;
    }
    if (tail === 0) return;

    while (head < tail) {
      const cur = queue[head++];
      const gy = Math.floor(cur / cols);
      const gx = cur - gy * cols;
      const next = dist[cur] + 1;
      const neighbors = [
        gx > 0 ? cur - 1 : -1,
        gx < cols - 1 ? cur + 1 : -1,
        gy > 0 ? cur - cols : -1,
        gy < rows - 1 ? cur + cols : -1,
      ];
      for (const n of neighbors) {
        if (n < 0 || blocked[n] || dist[n] !== UNREACHABLE) continue;
        dist[n] = next;
        queue[tail++] = n;
      }
    }

    // 由距离场求梯度方向：每格指向距离更小的邻居（即朝入口的方向）
    const dirX = this.dirX;
    const dirY = this.dirY;
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const i = gy * cols + gx;
        if (blocked[i] || dist[i] === UNREACHABLE) continue;
        let best = dist[i];
        let bx = 0;
        let by = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const nx = gx + ox;
            const ny = gy + oy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const j = ny * cols + nx;
            if (blocked[j]) continue;
            if (dist[j] < best) {
              best = dist[j];
              bx = ox;
              by = oy;
            }
          }
        }
        if (bx !== 0 || by !== 0) {
          const len = Math.hypot(bx, by);
          dirX[i] = bx / len;
          dirY[i] = by / len;
        }
      }
    }
  }

  /**
   * 查询 (x, y) 处的移动方向，结果写在本对象的 x / y 上并返回 this。
   * 走不到任何开口的位置（理论上不该发生）退化为直线冲向最近开口。
   */
  sample(x: number, y: number): FlowField {
    const { cols, rows, blocked, dist } = this;
    const gx = Math.floor(x / CELL);
    const gy = Math.floor(y / CELL);
    if (gx < 0 || gy < 0 || gx >= cols || gy >= rows) {
      this.x = 0;
      this.y = 0;
      return this;
    }
    const i = gy * cols + gx;
    if (blocked[i] || dist[i] === UNREACHABLE) {
      return this.fallback(x, y);
    }
    this.x = this.dirX[i];
    this.y = this.dirY[i];
    if (this.x === 0 && this.y === 0) return this.fallback(x, y);
    return this;
  }

  /** 兜底：直线朝最近的开口中心走 */
  private fallback(x: number, y: number): FlowField {
    let bx = this.sources[0].x;
    let by = this.sources[0].y;
    let bd = Infinity;
    for (const c of this.sources) {
      const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
      if (d < bd) {
        bd = d;
        bx = c.x;
        by = c.y;
      }
    }
    const dx = bx - x;
    const dy = by - y;
    const len = Math.hypot(dx, dy) || 1;
    this.x = dx / len;
    this.y = dy / len;
    return this;
  }
}
