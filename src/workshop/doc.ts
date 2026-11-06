/**
 * 工坊地图文档 —— 编辑器内部的可变模型。
 *
 * 用 Uint8Array 存 74×45 个瓦片（比字符串好改），导出时再转回 schema 的
 * 字符行格式。门窗与人类区 / 出生区直接复用 `MapJson` 的结构，
 * 这样保存、导入导出与 `compileTilesToMapDef()` 都不需要额外翻译。
 */
import {
  GRID_COLS,
  GRID_ROWS,
  MAP_HEIGHT,
  MAP_SCHEMA_VERSION,
  MAP_WIDTH,
  TILE_CHARS,
  TILE_SIZE,
  type MapJson,
  type OpeningJson,
  type TileRect,
} from "../data/maps/schema";

export const TILE_CODES = {
  empty: 0,
  wall: 1,
  door: 2,
  window: 3,
} as const;

export type TileCode = (typeof TILE_CODES)[keyof typeof TILE_CODES];

const CHAR_OF_CODE: Record<TileCode, string> = {
  [TILE_CODES.empty]: TILE_CHARS.empty,
  [TILE_CODES.wall]: TILE_CHARS.wall,
  [TILE_CODES.door]: TILE_CHARS.door,
  [TILE_CODES.window]: TILE_CHARS.window,
};

const CODE_OF_CHAR: Record<string, TileCode> = {
  [TILE_CHARS.empty]: TILE_CODES.empty,
  [TILE_CHARS.wall]: TILE_CODES.wall,
  [TILE_CHARS.door]: TILE_CODES.door,
  [TILE_CHARS.window]: TILE_CODES.window,
};

export const TILE_NAMES: Record<TileCode, string> = {
  [TILE_CODES.empty]: "空地",
  [TILE_CODES.wall]: "墙",
  [TILE_CODES.door]: "门",
  [TILE_CODES.window]: "窗",
};

/** 文档元信息 + 内容；门窗 / 区域允许暂缺，校验面板会报错 */
export interface WorkshopDoc {
  id: string;
  name: string;
  tiles: Uint8Array;
  openings: OpeningJson[];
  humanZone: TileRect | null;
  spawn: TileRect | null;
  /** 可选的上 / 下窗出生区：编辑器不改，但导入 / 载入内置图时必须原样保留 */
  windowSpawn: { top: TileRect | null; bottom: TileRect | null };
  buildBiteDamage: number;
  buildBiteSlow: number;
  /** 从哪张内置图载入的；null 表示新图 / 副本 / 导入 */
  builtinId: string | null;
}

export interface OpeningDefaults {
  doorHp: number;
  doorPass: number;
  windowHp: number;
  windowPass: number;
}

/** 新建门窗的默认属性（与 arena 的默认口径一致） */
export const OPENING_DEFAULTS: OpeningDefaults = {
  doorHp: 450,
  doorPass: 1,
  windowHp: 100,
  windowPass: 0.45,
};

export function createBlankDoc(): WorkshopDoc {
  return {
    id: "my-map",
    name: "我的地图",
    tiles: new Uint8Array(GRID_COLS * GRID_ROWS),
    openings: [],
    humanZone: null,
    spawn: null,
    windowSpawn: { top: null, bottom: null },
    buildBiteDamage: 4,
    buildBiteSlow: 1.5,
    builtinId: null,
  };
}

export function cloneDoc(doc: WorkshopDoc): WorkshopDoc {
  return {
    ...doc,
    tiles: new Uint8Array(doc.tiles),
    openings: doc.openings.map((o) => ({ ...o })),
    humanZone: doc.humanZone ? { ...doc.humanZone } : null,
    spawn: doc.spawn ? { ...doc.spawn } : null,
    windowSpawn: {
      top: doc.windowSpawn.top ? { ...doc.windowSpawn.top } : null,
      bottom: doc.windowSpawn.bottom ? { ...doc.windowSpawn.bottom } : null,
    },
  };
}

export function tileIndex(x: number, y: number): number {
  return y * GRID_COLS + x;
}

export function isInside(x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < GRID_COLS && y < GRID_ROWS;
}

export function getTile(doc: WorkshopDoc, x: number, y: number): TileCode {
  if (!isInside(x, y)) return TILE_CODES.wall;
  return doc.tiles[tileIndex(x, y)] as TileCode;
}

export function setTile(doc: WorkshopDoc, x: number, y: number, code: TileCode): void {
  if (!isInside(x, y)) return;
  doc.tiles[tileIndex(x, y)] = code;
}

export function toTileRows(doc: WorkshopDoc): string[] {
  const rows: string[] = [];
  for (let y = 0; y < GRID_ROWS; y++) {
    let row = "";
    for (let x = 0; x < GRID_COLS; x++) {
      row += CHAR_OF_CODE[getTile(doc, x, y)];
    }
    rows.push(row);
  }
  return rows;
}

/** 把拖拽两点规范成矩形（区域画笔用，允许任意方向） */
export function dragRect(x0: number, y0: number, x1: number, y1: number): TileRect {
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  return {
    x,
    y,
    w: Math.abs(x1 - x0) + 1,
    h: Math.abs(y1 - y0) + 1,
  };
}

/** 把拖拽两点规范成门窗线：主轴决定横 / 竖，厚度固定 1 格 */
export function lineRect(x0: number, y0: number, x1: number, y1: number): TileRect {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  if (dx >= dy) {
    return { x: Math.min(x0, x1), y: y0, w: dx + 1, h: 1 };
  }
  return { x: x0, y: Math.min(y0, y1), w: 1, h: dy + 1 };
}

export function pointInRect(x: number, y: number, rect: TileRect): boolean {
  return x >= rect.x && y >= rect.y && x < rect.x + rect.w && y < rect.y + rect.h;
}

export function rectsIntersect(a: TileRect, b: TileRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function openingAt(doc: WorkshopDoc, x: number, y: number): OpeningJson | undefined {
  return doc.openings.find((o) => pointInRect(x, y, o));
}

/** 删除覆盖某格的开口，并把它的瓦片还原成调用方指定的类型 */
export function removeOpeningAt(
  doc: WorkshopDoc,
  x: number,
  y: number,
  restoreTo: TileCode,
): OpeningJson | null {
  const index = doc.openings.findIndex((o) => pointInRect(x, y, o));
  if (index < 0) return null;
  const [removed] = doc.openings.splice(index, 1);
  for (let ty = removed.y; ty < removed.y + removed.h; ty++) {
    for (let tx = removed.x; tx < removed.x + removed.w; tx++) {
      setTile(doc, tx, ty, restoreTo);
    }
  }
  return removed;
}

/** 删除与矩形相交的所有开口（新画门窗覆盖旧门窗时用） */
export function removeOpeningsInRect(doc: WorkshopDoc, rect: TileRect, restoreTo: TileCode): void {
  for (let i = doc.openings.length - 1; i >= 0; i--) {
    if (!rectsIntersect(doc.openings[i], rect)) continue;
    const [removed] = doc.openings.splice(i, 1);
    for (let ty = removed.y; ty < removed.y + removed.h; ty++) {
      for (let tx = removed.x; tx < removed.x + removed.w; tx++) {
        setTile(doc, tx, ty, restoreTo);
      }
    }
  }
}

/** 生成下一个未占用的开口 id，例如 door-2 / window-3 */
export function nextOpeningId(doc: WorkshopDoc, kind: OpeningJson["kind"]): string {
  const prefix = kind === "door" ? "door" : "window";
  const used = new Set(doc.openings.map((o) => o.id));
  for (let i = 1; i < 1000; i++) {
    const id = `${prefix}-${i}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}-${Date.now()}`;
}

export function rectToPixels(rect: TileRect): { x: number; y: number; w: number; h: number } {
  return {
    x: rect.x * TILE_SIZE,
    y: rect.y * TILE_SIZE,
    w: rect.w * TILE_SIZE,
    h: rect.h * TILE_SIZE,
  };
}

function windowSpawnJson(doc: WorkshopDoc): MapJson["windowSpawn"] {
  const top = doc.windowSpawn.top ? { ...doc.windowSpawn.top } : undefined;
  const bottom = doc.windowSpawn.bottom ? { ...doc.windowSpawn.bottom } : undefined;
  return top || bottom ? { top, bottom } : undefined;
}

/** 供 validateMapJson 使用的原始对象；区域缺失时传 null，让校验报“缺少区域” */
export function toRawJson(doc: WorkshopDoc): Record<string, unknown> {
  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    id: doc.id,
    name: doc.name,
    widthTiles: GRID_COLS,
    heightTiles: GRID_ROWS,
    tileSize: TILE_SIZE,
    tiles: toTileRows(doc),
    openings: doc.openings,
    humanZone: doc.humanZone,
    spawn: doc.spawn,
    windowSpawn: windowSpawnJson(doc),
    buildBiteDamage: doc.buildBiteDamage,
    buildBiteSlow: doc.buildBiteSlow,
  };
}

/** 校验通过后才能调用：此时区域一定存在，直接产出可导出的 MapJson */
export function toMapJson(doc: WorkshopDoc): MapJson {
  if (!doc.humanZone || !doc.spawn) {
    throw new Error("地图缺少人类区或出生区，无法导出");
  }
  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    id: doc.id,
    name: doc.name,
    widthTiles: GRID_COLS,
    heightTiles: GRID_ROWS,
    tileSize: TILE_SIZE,
    tiles: toTileRows(doc),
    openings: doc.openings.map((o) => ({ ...o })),
    humanZone: { ...doc.humanZone },
    spawn: { ...doc.spawn },
    windowSpawn: windowSpawnJson(doc),
    buildBiteDamage: doc.buildBiteDamage,
    buildBiteSlow: doc.buildBiteSlow,
  };
}

/** 导入外部 JSON；这里容错读取，非法细节交给 validateMapJson 报 */
export function fromMapJson(json: MapJson): WorkshopDoc {
  const doc = createBlankDoc();
  doc.id = typeof json.id === "string" ? json.id : "imported";
  doc.name = typeof json.name === "string" ? json.name : "导入地图";
  doc.buildBiteDamage = typeof json.buildBiteDamage === "number" ? json.buildBiteDamage : 4;
  doc.buildBiteSlow = typeof json.buildBiteSlow === "number" ? json.buildBiteSlow : 1.5;
  doc.openings = Array.isArray(json.openings) ? json.openings.map((o) => ({ ...o })) : [];

  const rows = Array.isArray(json.tiles) ? json.tiles : [];
  for (let y = 0; y < GRID_ROWS && y < rows.length; y++) {
    const row = rows[y];
    if (typeof row !== "string") continue;
    for (let x = 0; x < GRID_COLS && x < row.length; x++) {
      const code = CODE_OF_CHAR[row[x]];
      if (code === undefined) continue;
      setTile(doc, x, y, code);
    }
  }

  doc.humanZone = isRect(json.humanZone) ? { ...json.humanZone } : null;
  doc.spawn = isRect(json.spawn) ? { ...json.spawn } : null;
  doc.windowSpawn = {
    top: isRect(json.windowSpawn?.top) ? { ...json.windowSpawn.top } : null,
    bottom: isRect(json.windowSpawn?.bottom) ? { ...json.windowSpawn.bottom } : null,
  };
  return doc;
}

function isRect(value: unknown): value is TileRect {
  if (typeof value !== "object" || value === null) return false;
  const { x, y, w, h } = value as Record<string, unknown>;
  return (
    typeof x === "number" &&
    typeof y === "number" &&
    typeof w === "number" &&
    typeof h === "number"
  );
}

function readWindowSpawn(value: unknown): { top: TileRect | null; bottom: TileRect | null } {
  if (typeof value !== "object" || value === null) return { top: null, bottom: null };
  const record = value as Record<string, unknown>;
  return {
    top: isRect(record.top) ? { ...record.top } : null,
    bottom: isRect(record.bottom) ? { ...record.bottom } : null,
  };
}

interface SerializedDoc {
  id: string;
  name: string;
  tiles: string[];
  openings: OpeningJson[];
  humanZone: TileRect | null;
  spawn: TileRect | null;
  windowSpawn: { top: TileRect | null; bottom: TileRect | null };
  buildBiteDamage: number;
  buildBiteSlow: number;
  builtinId: string | null;
}

/** 历史快照 / 草稿共用的序列化格式（JSON 字符串可直接比较） */
export function serializeDoc(doc: WorkshopDoc): string {
  const payload: SerializedDoc = {
    id: doc.id,
    name: doc.name,
    tiles: toTileRows(doc),
    openings: doc.openings.map((o) => ({ ...o })),
    humanZone: doc.humanZone ? { ...doc.humanZone } : null,
    spawn: doc.spawn ? { ...doc.spawn } : null,
    windowSpawn: {
      top: doc.windowSpawn.top ? { ...doc.windowSpawn.top } : null,
      bottom: doc.windowSpawn.bottom ? { ...doc.windowSpawn.bottom } : null,
    },
    buildBiteDamage: doc.buildBiteDamage,
    buildBiteSlow: doc.buildBiteSlow,
    builtinId: doc.builtinId,
  };
  return JSON.stringify(payload);
}

export function deserializeDoc(raw: string): WorkshopDoc | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const data = parsed as Partial<SerializedDoc>;
  if (!Array.isArray(data.tiles)) return null;
  const doc = createBlankDoc();
  doc.id = typeof data.id === "string" ? data.id : "my-map";
  doc.name = typeof data.name === "string" ? data.name : "我的地图";
  doc.buildBiteDamage = typeof data.buildBiteDamage === "number" ? data.buildBiteDamage : 4;
  doc.buildBiteSlow = typeof data.buildBiteSlow === "number" ? data.buildBiteSlow : 1.5;
  doc.builtinId = typeof data.builtinId === "string" ? data.builtinId : null;
  doc.openings = Array.isArray(data.openings) ? data.openings.map((o) => ({ ...o })) : [];

  for (let y = 0; y < GRID_ROWS && y < data.tiles.length; y++) {
    const row = data.tiles[y];
    if (typeof row !== "string") continue;
    for (let x = 0; x < GRID_COLS && x < row.length; x++) {
      const code = CODE_OF_CHAR[row[x]];
      if (code === undefined) continue;
      setTile(doc, x, y, code);
    }
  }
  doc.humanZone = isRect(data.humanZone) ? { ...data.humanZone } : null;
  doc.spawn = isRect(data.spawn) ? { ...data.spawn } : null;
  doc.windowSpawn = readWindowSpawn(data.windowSpawn);
  return doc;
}

/** 画布尺寸（导出给 UI 展示） */
export const CANVAS_PX = { width: MAP_WIDTH, height: MAP_HEIGHT } as const;
