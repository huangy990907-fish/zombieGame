/**
 * 瓦片 JSON -> MapDef 编译器。
 *
 * 只做几何翻译，不产生任何玩法规则：
 *  - `#` 瓦片按“行内连续段 + 纵向同段合并”整理成矩形墙
 *  - `openings` 元数据直接生成带 id 的开口，门排在最前（渲染/HUD 稳定顺序）
 *  - room 由墙体包围盒推导，像素坐标一律 = 格 × TILE_SIZE
 */
import type { MapDef, OpeningDef, Rect } from "../types";
import {
  MAP_HEIGHT,
  MAP_WIDTH,
  TILE_CHARS,
  TILE_SIZE,
  type MapJson,
  type TileRect,
  validateMapJson,
} from "./schema";

function toPxRect(rect: TileRect): Rect {
  return {
    x: rect.x * TILE_SIZE,
    y: rect.y * TILE_SIZE,
    w: rect.w * TILE_SIZE,
    h: rect.h * TILE_SIZE,
  };
}

function toPxRegion(rect: TileRect): { x0: number; x1: number; y0: number; y1: number } {
  return {
    x0: rect.x * TILE_SIZE,
    x1: (rect.x + rect.w) * TILE_SIZE,
    y0: rect.y * TILE_SIZE,
    y1: (rect.y + rect.h) * TILE_SIZE,
  };
}

/** 读取兼容：旧版单个矩形 / 新版矩形数组，统一成数组 */
function rectList(value: TileRect | TileRect[]): TileRect[] {
  return Array.isArray(value) ? value : [value];
}

/** 人类移动边界：房间内侧内缩 20px（与 TS 兜底口径一致，防止贴墙） */
function humanBoundsOf(room: MapDef["room"]): MapDef["humanBounds"] {
  const pad = 20;
  const x0 = room.left + room.wall + pad;
  const y0 = room.top + room.wall + pad;
  return {
    x0,
    y0,
    x1: Math.max(x0, room.right - room.wall - pad),
    y1: Math.max(y0, room.bottom - room.wall - pad),
  };
}

interface WallRun {
  x: number;
  w: number;
  /** 这一段从第几行开始（编译过程中更新） */
  y: number;
}

/**
 * 把墙瓦片合并成矩形。
 * 先按行找连续段，再把相邻行中 x / w 完全相同的段纵向合并；
 * 这样 arena 的 7 段墙会得到 7 个矩形，不会退化成逐格矩形。
 */
function compileWalls(tiles: string[]): Rect[] {
  const rects: Rect[] = [];
  let bands: WallRun[] = [];

  const emit = (band: WallRun, endY: number): void => {
    rects.push({
      x: band.x * TILE_SIZE,
      y: band.y * TILE_SIZE,
      w: band.w * TILE_SIZE,
      h: (endY - band.y) * TILE_SIZE,
    });
  };

  for (let y = 0; y < tiles.length; y++) {
    const row = tiles[y];
    const runs: WallRun[] = [];
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== TILE_CHARS.wall) continue;
      const start = x;
      while (x + 1 < row.length && row[x + 1] === TILE_CHARS.wall) x++;
      runs.push({ x: start, w: x - start + 1, y });
    }

    // 与上一行仍能对齐的段继续延长，其余段在本行收口
    const nextBands: WallRun[] = [];
    for (const band of bands) {
      const hit = runs.findIndex((r) => r.x === band.x && r.w === band.w);
      if (hit >= 0) {
        nextBands.push(band);
        runs.splice(hit, 1);
      } else {
        emit(band, y);
      }
    }
    for (const run of runs) nextBands.push(run);
    bands = nextBands;
  }
  for (const band of bands) emit(band, tiles.length);
  return rects;
}

/** 由墙体包围盒推导房间矩形（wall 固定 1 格，当前只支持单房间） */
function compileRoom(walls: Rect[], tileSize: number): MapDef["room"] {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const w of walls) {
    if (w.x < left) left = w.x;
    if (w.y < top) top = w.y;
    if (w.x + w.w > right) right = w.x + w.w;
    if (w.y + w.h > bottom) bottom = w.y + w.h;
  }
  if (!Number.isFinite(left)) {
    return { left: 0, top: 0, right: MAP_WIDTH, bottom: MAP_HEIGHT, wall: tileSize };
  }
  return { left, top, right, bottom, wall: tileSize };
}

/**
 * 编译地图。非法 JSON 直接抛错（错误信息含格子坐标），
 * 调用方应先跑 validateMapJson 以便拿到结构化错误。
 */
export function compileTilesToMapDef(json: MapJson): MapDef {
  const errors = validateMapJson(json);
  if (errors.length > 0) {
    const detail = errors
      .map((e) => (e.x === undefined ? e.message : `(${e.x},${e.y}) ${e.message}`))
      .join("；");
    throw new Error(`地图「${json.id ?? "?"}」校验失败：${detail}`);
  }

  const walls = compileWalls(json.tiles);
  const room = compileRoom(walls, TILE_SIZE);

  // 门在前、窗在后；同类按从上到下、从左到右排序，保证编译结果稳定
  const rank = (kind: "door" | "window"): number => (kind === "door" ? 0 : 1);
  const sorted = [...json.openings].sort(
    (a, b) => rank(a.kind) - rank(b.kind) || a.y - b.y || a.x - b.x,
  );
  const openings: OpeningDef[] = sorted.map((o) => ({
    id: o.id,
    kind: o.kind,
    rect: toPxRect(o),
    maxHp: o.maxHp,
    passSpeed: o.passSpeed,
  }));

  return {
    id: json.id,
    name: typeof json.name === "string" && json.name.trim() ? json.name.trim() : json.id,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
    room,
    walls,
    openings,
    openingCenters: openings.map((o) => ({
      x: o.rect.x + o.rect.w * 0.5,
      y: o.rect.y + o.rect.h * 0.5,
    })),
    spawn: rectList(json.spawn).map(toPxRegion),
    windowSpawn: {
      top: json.windowSpawn?.top ? toPxRegion(json.windowSpawn.top) : undefined,
      bottom: json.windowSpawn?.bottom ? toPxRegion(json.windowSpawn.bottom) : undefined,
    },
    humanZones: rectList(json.humanZone).map(toPxRegion),
    humanBounds: humanBoundsOf(room),
    buildBiteDamage: json.buildBiteDamage,
    buildBiteSlow: json.buildBiteSlow,
  };
}
