/**
 * 均匀网格空间哈希 —— 本作最重要的性能基石。
 *
 * 问题：几千个单位两两互相找邻居是 O(N²)，5000 只丧尸就是 1250 万次/帧。
 * 解法：把地图切成格子，每个单位只查自己和相邻格子的内容，
 *       “找附近的目标/敌人/碰撞对象”都变成近似 O(N)。
 *
 * 用法：每帧先 clear()，把所有单位 insert() 进去，再用 query() 查邻居。
 */
export interface HasPosition {
  x: number;
  y: number;
}

export class SpatialHash<T extends HasPosition> {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  /** 每个格子是一个数组，按 (行 * 列数 + 列) 一维化 */
  private buckets: T[][];

  constructor(width: number, height: number, cell = 56) {
    this.cell = cell;
    this.cols = Math.max(1, Math.ceil(width / cell));
    this.rows = Math.max(1, Math.ceil(height / cell));
    this.buckets = [];
    for (let i = 0; i < this.cols * this.rows; i++) this.buckets.push([]);
  }

  /** 每帧重建索引前先清空（只清空长度，数组对象保留，减少 GC） */
  clear(): void {
    for (let i = 0; i < this.buckets.length; i++) this.buckets[i].length = 0;
  }

  /** 按坐标把对象放进对应格子，越界对象直接忽略 */
  insert(item: T): void {
    const cx = Math.floor(item.x / this.cell);
    const cy = Math.floor(item.y / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return;
    this.buckets[cy * this.cols + cx].push(item);
  }

  /**
   * 查询以 (x,y) 为圆心、半径 r 范围内的所有对象。
   * 结果写入传入的 out 数组（调用方复用同一个数组，避免每帧产生垃圾对象），
   * 返回值就是 out。
   */
  query(x: number, y: number, r: number, out: T[]): T[] {
    out.length = 0;
    const x0 = Math.max(0, Math.floor((x - r) / this.cell));
    const x1 = Math.min(this.cols - 1, Math.floor((x + r) / this.cell));
    const y0 = Math.max(0, Math.floor((y - r) / this.cell));
    const y1 = Math.min(this.rows - 1, Math.floor((y + r) / this.cell));
    const r2 = r * r;
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        const b = this.buckets[row + cx];
        for (let i = 0; i < b.length; i++) {
          const it = b[i];
          const dx = it.x - x;
          const dy = it.y - y;
          if (dx * dx + dy * dy <= r2) out.push(it);
        }
      }
    }
    return out;
  }
}
