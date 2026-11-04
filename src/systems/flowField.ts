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
import { OPENING_CENTERS, WALLS, WORLD } from "../config";

export const CELL = 16;
export const COLS = Math.ceil(WORLD.width / CELL);
export const ROWS = Math.ceil(WORLD.height / CELL);
const UNREACHABLE = 65535;

export class FlowField {
  /** 1 = 墙体不可走 */
  private blocked = new Uint8Array(COLS * ROWS);
  /** 到最近开口的格子距离，UNREACHABLE 表示走不到 */
  private dist = new Uint16Array(COLS * ROWS);
  private dirX = new Float32Array(COLS * ROWS);
  private dirY = new Float32Array(COLS * ROWS);
  /** sample() 的输出：该位置应移动的单位方向 */
  x = 0;
  y = 0;

  constructor() {
    // 先把所有被墙体覆盖的格子标记为不可走（门窗开口不算墙）
    for (let gy = 0; gy < ROWS; gy++) {
      for (let gx = 0; gx < COLS; gx++) {
        const cx = (gx + 0.5) * CELL;
        const cy = (gy + 0.5) * CELL;
        let solid = false;
        for (const w of WALLS) {
          if (cx >= w.x && cx <= w.x + w.w && cy >= w.y && cy <= w.y + w.h) {
            solid = true;
            break;
          }
        }
        if (solid) this.blocked[gy * COLS + gx] = 1;
      }
    }
    this.bake();
  }

  /** 从三个开口中心同时开始 BFS（多源），得到“到最近开口”的距离场 */
  private bake(): void {
    const dist = this.dist;
    dist.fill(UNREACHABLE);

    // BFS：每个开口距离为 0，一圈一圈向外扩散
    const queue = new Int32Array(COLS * ROWS);
    let head = 0;
    let tail = 0;
    for (const c of OPENING_CENTERS) {
      const gx = Math.floor(c.x / CELL);
      const gy = Math.floor(c.y / CELL);
      const i = gy * COLS + gx;
      if (this.blocked[i] || dist[i] !== UNREACHABLE) continue;
      dist[i] = 0;
      queue[tail++] = i;
    }
    if (tail === 0) return;

    while (head < tail) {
      const cur = queue[head++];
      const gy = Math.floor(cur / COLS);
      const gx = cur - gy * COLS;
      const next = dist[cur] + 1;
      const neighbors = [
        gx > 0 ? cur - 1 : -1,
        gx < COLS - 1 ? cur + 1 : -1,
        gy > 0 ? cur - COLS : -1,
        gy < ROWS - 1 ? cur + COLS : -1,
      ];
      for (const n of neighbors) {
        if (n < 0 || this.blocked[n] || dist[n] !== UNREACHABLE) continue;
        dist[n] = next;
        queue[tail++] = n;
      }
    }

    // 由距离场求梯度方向：每格指向距离更小的邻居（即朝入口的方向）
    const dirX = this.dirX;
    const dirY = this.dirY;
    for (let gy = 0; gy < ROWS; gy++) {
      for (let gx = 0; gx < COLS; gx++) {
        const i = gy * COLS + gx;
        if (this.blocked[i] || dist[i] === UNREACHABLE) continue;
        let best = dist[i];
        let bx = 0;
        let by = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            const nx = gx + ox;
            const ny = gy + oy;
            if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
            const j = ny * COLS + nx;
            if (this.blocked[j]) continue;
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
    const gx = Math.floor(x / CELL);
    const gy = Math.floor(y / CELL);
    if (gx < 0 || gy < 0 || gx >= COLS || gy >= ROWS) {
      this.x = 0;
      this.y = 0;
      return this;
    }
    const i = gy * COLS + gx;
    if (this.blocked[i] || this.dist[i] === UNREACHABLE) {
      return this.fallback(x, y);
    }
    this.x = this.dirX[i];
    this.y = this.dirY[i];
    if (this.x === 0 && this.y === 0) return this.fallback(x, y);
    return this;
  }

  /** 兜底：直线朝最近的开口中心走 */
  private fallback(x: number, y: number): FlowField {
    let bx = OPENING_CENTERS[0].x;
    let by = OPENING_CENTERS[0].y;
    let bd = Infinity;
    for (const c of OPENING_CENTERS) {
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
