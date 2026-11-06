/**
 * 地图 JSON schema（0.5.0 阶段 0）。
 *
 * 瓦片只是「编辑 / 存储格式」：加载时由 compile.ts 编译成现有的
 * `MapDef`（walls[] + openings[]），World / 流场 / 渲染都不感知瓦片。
 *
 * 固定网格：16px 一格，74 × 45 格 = 1184 × 720 像素。
 * 门窗必须是 16px 的整数倍（即整数格），所以宽度天然满足约束。
 *
 * 字符约定：
 *   .  空地
 *   #  墙
 *   w  窗（对应 openings 里 kind = "window" 的矩形）
 *   d  门（对应 openings 里 kind = "door" 的矩形）
 */

export const MAP_SCHEMA_VERSION = 1;
export const TILE_SIZE = 16;
export const GRID_COLS = 74;
export const GRID_ROWS = 45;
export const MAP_WIDTH = GRID_COLS * TILE_SIZE;
export const MAP_HEIGHT = GRID_ROWS * TILE_SIZE;

export const TILE_CHARS = {
  empty: ".",
  wall: "#",
  window: "w",
  door: "d",
} as const;

export type TileChar = (typeof TILE_CHARS)[keyof typeof TILE_CHARS];

/** 以格为单位的矩形 */
export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 一扇门窗：id 唯一，宽度由格数决定（必须 ≥ 1 格） */
export interface OpeningJson {
  id: string;
  kind: "door" | "window";
  x: number;
  y: number;
  w: number;
  h: number;
  /** 默认血量，丧尸啃到 0 即破损 */
  maxHp: number;
  /** 破损后丧尸穿过时的速度倍率 */
  passSpeed: number;
}

/** 地图 JSON 的完整结构（public/maps/*.json） */
export interface MapJson {
  schemaVersion: number;
  id: string;
  /** 显示名（去首尾空格后 1–24 字）；旧图缺失时调用方回退显示 id */
  name?: string;
  widthTiles: number;
  heightTiles: number;
  tileSize: number;
  /** GRID_ROWS 行，每行 GRID_COLS 个字符 */
  tiles: string[];
  openings: OpeningJson[];
  /**
   * 人类活动区：可放置多块矩形，按并集生效。
   * 读取兼容旧版单个对象，保存统一写数组。
   */
  humanZone: TileRect | TileRect[];
  /**
   * 僵尸出生区：可放置多块矩形，按面积加权抽签。
   * 读取兼容旧版单个对象，保存统一写数组。
   */
  spawn: TileRect | TileRect[];
  /**
   * 窗侧出生区（可选）：按方位显式提供，缺哪个就用不到哪个，不报错。
   * 没有对应方位的窗口由 spawn 区兜底，靠流场绕行到窗口。
   */
  windowSpawn?: { top?: TileRect; bottom?: TileRect };
  buildBiteDamage: number;
  buildBiteSlow: number;
}

/**
 * 校验错误：能定位到格子时带 x / y（列 / 行，0 基）。
 */
export interface MapValidationError {
  message: string;
  x?: number;
  y?: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v);
}

function rectsOverlap(a: TileRect, b: TileRect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function readRect(raw: unknown, label: string, errors: MapValidationError[]): TileRect | null {
  if (!isRecord(raw)) {
    errors.push({ message: `${label}必须是 {x,y,w,h} 对象` });
    return null;
  }
  const { x, y, w, h } = raw;
  if (!isInt(x) || !isInt(y) || !isInt(w) || !isInt(h)) {
    errors.push({ message: `${label}的 x / y / w / h 必须是整数格` });
    return null;
  }
  if (w <= 0 || h <= 0) {
    errors.push({ message: `${label}的宽高必须 ≥ 1 格`, x, y });
    return null;
  }
  if (x < 0 || y < 0 || x + w > GRID_COLS || y + h > GRID_ROWS) {
    errors.push({ message: `${label}超出固定画布 ${GRID_COLS}×${GRID_ROWS} 格`, x, y });
    return null;
  }
  return { x, y, w, h };
}

/**
 * 读取「单个矩形或矩形数组」：旧版 JSON 用对象，新版统一写数组。
 * 缺失（null / undefined）返回空数组，由调用方决定是否报“缺少区域”。
 */
export function normalizeRectList(
  raw: unknown,
  label: string,
  errors: MapValidationError[],
): TileRect[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) {
    const rects: TileRect[] = [];
    for (let i = 0; i < raw.length; i++) {
      const rect = readRect(raw[i], `${label}[${i}]`, errors);
      if (rect) rects.push(rect);
    }
    return rects;
  }
  const rect = readRect(raw, label, errors);
  return rect ? [rect] : [];
}

interface GridRead {
  rows: string[];
  /** 行数 / 行宽 / 字符全部合法时为 true */
  valid: boolean;
}

function readGrid(raw: unknown, errors: MapValidationError[]): GridRead | null {
  if (!Array.isArray(raw) || raw.length !== GRID_ROWS) {
    errors.push({ message: `tiles 必须是 ${GRID_ROWS} 行字符串数组` });
    return null;
  }
  const allowed = new Set<string>(Object.values(TILE_CHARS));
  const rows: string[] = [];
  let valid = true;
  for (let y = 0; y < GRID_ROWS; y++) {
    const row = raw[y];
    if (typeof row !== "string") {
      errors.push({ message: `tiles 第 ${y} 行不是字符串`, y });
      valid = false;
      rows.push("");
      continue;
    }
    if (row.length !== GRID_COLS) {
      errors.push({ message: `tiles 第 ${y} 行有 ${row.length} 列，应为 ${GRID_COLS} 列`, y });
      valid = false;
    }
    for (let x = 0; x < row.length; x++) {
      if (!allowed.has(row[x])) {
        errors.push({
          message: `未知瓦片字符 "${row[x]}"（只允许 . / # / w / d）`,
          x,
          y,
        });
        valid = false;
      }
    }
    rows.push(row);
  }
  return { rows, valid };
}

/** 检查一个区域是否全部落在空地格；只报第一个越界格，避免刷屏 */
function checkEmptyRegion(
  name: string,
  rect: TileRect,
  grid: string[],
  errors: MapValidationError[],
): void {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    const row = grid[y] ?? "";
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (row[x] !== TILE_CHARS.empty) {
        errors.push({
          message: `${name}只能落在空地格（当前是 "${row[x] ?? "越界"}"）`,
          x,
          y,
        });
        return;
      }
    }
  }
}

/** 出生区 / 人类区到达性检查：出生点能走到所有开口，开口能走进人类区 */
function checkReachability(
  grid: string[],
  openings: Array<{ id: string; kind: "door" | "window"; rect: TileRect }>,
  spawnRects: TileRect[],
  humanZones: TileRect[],
  errors: MapValidationError[],
): void {
  const total = GRID_COLS * GRID_ROWS;
  const visited = new Uint8Array(total);
  const queue: number[] = [];
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= GRID_COLS || y >= GRID_ROWS) return;
    if (grid[y]?.[x] === TILE_CHARS.wall) return;
    const i = y * GRID_COLS + x;
    if (visited[i]) return;
    visited[i] = 1;
    queue.push(i);
  };

  for (const r of spawnRects) {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) push(x, y);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const y = Math.floor(i / GRID_COLS);
    const x = i - y * GRID_COLS;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }

  for (const o of openings) {
    const cx = o.rect.x + Math.floor((o.rect.w - 1) / 2);
    const cy = o.rect.y + Math.floor((o.rect.h - 1) / 2);
    if (!visited[cy * GRID_COLS + cx]) {
      errors.push({
        message: `从出生点无法到达${o.kind === "door" ? "门" : "窗"}「${o.id}」`,
        x: cx,
        y: cy,
      });
    }
  }

  // 反向：所有开口作为源，检查人类区是否可达
  visited.fill(0);
  queue.length = 0;
  for (const o of openings) {
    const cx = o.rect.x + Math.floor((o.rect.w - 1) / 2);
    const cy = o.rect.y + Math.floor((o.rect.h - 1) / 2);
    push(cx, cy);
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const y = Math.floor(i / GRID_COLS);
    const x = i - y * GRID_COLS;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  for (const zone of humanZones) {
    const hx = zone.x + Math.floor(zone.w / 2);
    const hy = zone.y + Math.floor(zone.h / 2);
    if (!visited[hy * GRID_COLS + hx]) {
      errors.push({
        message: `人类活动区（${zone.x},${zone.y}，${zone.w}×${zone.h}）与世界不可达（从门窗走不进去）`,
        x: hx,
        y: hy,
      });
    }
  }
}

/** 两侧被墙体堵住的格（越界也算堵） */
function isBlockedSide(grid: string[], x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= GRID_COLS || y >= GRID_ROWS) return true;
  return grid[y]?.[x] === TILE_CHARS.wall;
}

/**
 * 每个门窗的两侧都必须可通行：
 *  - 横向开口（w >= h）检查上下两排
 *  - 纵向开口（h > w）检查左右两列
 *  - 1×1 的洞口方向不明，上下或左右任意一组通过即可
 * 编辑器与加载期共用这条规则，确保「画出来的门窗能从两边走」。
 */
function checkOpeningPassages(
  grid: string[],
  openings: Array<{ id: string; kind: "door" | "window"; rect: TileRect }>,
  errors: MapValidationError[],
): void {
  for (const opening of openings) {
    const rect = opening.rect;
    const horizontal = rect.w >= rect.h;
    let blocked: { x: number; y: number } | null = null;

    const checkVertical = (): { x: number; y: number } | null => {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        if (isBlockedSide(grid, x, rect.y - 1)) return { x, y: rect.y - 1 };
        if (isBlockedSide(grid, x, rect.y + rect.h)) return { x, y: rect.y + rect.h };
      }
      return null;
    };
    const checkHorizontal = (): { x: number; y: number } | null => {
      for (let y = rect.y; y < rect.y + rect.h; y++) {
        if (isBlockedSide(grid, rect.x - 1, y)) return { x: rect.x - 1, y };
        if (isBlockedSide(grid, rect.x + rect.w, y)) return { x: rect.x + rect.w, y };
      }
      return null;
    };

    if (horizontal) {
      blocked = checkVertical();
      if (blocked && rect.w === 1 && rect.h === 1) blocked = checkHorizontal();
    } else {
      blocked = checkHorizontal();
    }

    if (blocked) {
      errors.push({
        message: `开口「${opening.id}」有一侧被墙体堵住，丧尸无法从两边通过`,
        x: blocked.x,
        y: blocked.y,
      });
    }
  }
}

/**
 * 校验地图 JSON。返回空数组表示通过。
 * 所有能落到格子的错误都带 x / y，编辑器与保存前校验共用这一份规则。
 */
export function validateMapJson(raw: unknown): MapValidationError[] {
  const errors: MapValidationError[] = [];
  if (!isRecord(raw)) {
    errors.push({ message: "地图 JSON 必须是对象" });
    return errors;
  }

  if (raw.schemaVersion !== MAP_SCHEMA_VERSION) {
    errors.push({
      message: `schemaVersion 必须为 ${MAP_SCHEMA_VERSION}（当前 ${String(raw.schemaVersion)}）`,
    });
  }
  if (typeof raw.id !== "string" || raw.id.trim() === "") {
    errors.push({ message: "id 必须是非空字符串" });
  }
  if (typeof raw.name !== "string") {
    if (raw.name !== undefined) errors.push({ message: "name 必须是字符串" });
  } else {
    const name = raw.name.trim();
    if (name === "") errors.push({ message: "name 不能为空（去首尾空格后 1–24 字）" });
    else if (name.length > 24) {
      errors.push({ message: `name 最多 24 字（当前 ${name.length} 字）` });
    }
  }
  if (raw.widthTiles !== GRID_COLS || raw.heightTiles !== GRID_ROWS) {
    errors.push({ message: `画布固定为 ${GRID_COLS}×${GRID_ROWS} 格，不支持自定义尺寸` });
  }
  if (raw.tileSize !== TILE_SIZE) {
    errors.push({ message: `tileSize 固定为 ${TILE_SIZE}` });
  }

  const gridRead = readGrid(raw.tiles, errors);
  const grid = gridRead?.valid ? gridRead.rows : null;

  // ===== 开口 =====
  const covered = new Map<string, string>();
  const openings: Array<{ id: string; kind: "door" | "window"; rect: TileRect }> = [];
  let doorCount = 0;

  if (!Array.isArray(raw.openings)) {
    errors.push({ message: "openings 必须是数组" });
  } else {
    const seenIds = new Set<string>();
    for (let i = 0; i < raw.openings.length; i++) {
      const item = raw.openings[i];
      if (!isRecord(item)) {
        errors.push({ message: `openings[${i}] 必须是对象` });
        continue;
      }
      const id = typeof item.id === "string" ? item.id : "";
      const label = `openings[${i}]`;
      if (!id) {
        errors.push({ message: `${label} 缺少 id` });
      } else if (seenIds.has(id)) {
        errors.push({ message: `开口 id 重复："${id}"` });
      } else {
        seenIds.add(id);
      }
      if (item.kind !== "door" && item.kind !== "window") {
        errors.push({ message: `${label} 的 kind 必须是 "door" 或 "window"` });
        continue;
      }
      const kind = item.kind;
      const rect = readRect(item, `${label}（${id || "无 id"}）`, errors);
      if (!rect) continue;
      if (!isInt(item.maxHp) || item.maxHp <= 0) {
        errors.push({ message: `${label} 的 maxHp 必须是正整数`, x: rect.x, y: rect.y });
      }
      if (typeof item.passSpeed !== "number" || !(item.passSpeed > 0) || item.passSpeed > 1) {
        errors.push({ message: `${label} 的 passSpeed 必须在 (0, 1] 之间`, x: rect.x, y: rect.y });
      }

      if (kind === "door") doorCount++;
      openings.push({ id: id || `${kind}-${i}`, kind, rect });

      if (grid) {
        const expected = kind === "door" ? TILE_CHARS.door : TILE_CHARS.window;
        let mismatch = false;
        for (let y = rect.y; y < rect.y + rect.h && !mismatch; y++) {
          for (let x = rect.x; x < rect.x + rect.w; x++) {
            if (grid[y][x] !== expected) {
              errors.push({
                message: `开口「${id || kind}」应使用 "${expected}"，当前是 "${grid[y][x]}"`,
                x,
                y,
              });
              mismatch = true;
              break;
            }
          }
        }
        // 记录覆盖格，用于发现“画了 d / w 却忘记登记 openings”的格子
        for (let y = rect.y; y < rect.y + rect.h; y++) {
          for (let x = rect.x; x < rect.x + rect.w; x++) {
            const key = `${x},${y}`;
            const owner = covered.get(key);
            if (owner) {
              errors.push({ message: `开口「${owner}」与「${id || kind}」重叠`, x, y });
            } else {
              covered.set(key, id || kind);
            }
          }
        }
      }
    }

    // 任意数量的门窗：守岗按类型 / 朝向 / 房间几何推导（1B 起）
    if (doorCount === 0) {
      errors.push({ message: "地图至少需要 1 扇门（胖子只能走门）" });
    }
  }

  // ===== 瓦片内容 =====
  if (grid) {
    checkOpeningPassages(grid, openings, errors);
    let wallCount = 0;
    let orphanCount = 0;
    for (let y = 0; y < GRID_ROWS; y++) {
      for (let x = 0; x < GRID_COLS; x++) {
        const ch = grid[y][x];
        if (ch === TILE_CHARS.wall) wallCount++;
        else if ((ch === TILE_CHARS.door || ch === TILE_CHARS.window) && !covered.has(`${x},${y}`)) {
          if (orphanCount < 8) {
            errors.push({ message: `瓦片 "${ch}" 没有对应的开口记录`, x, y });
            orphanCount++;
          }
        }
      }
    }
    if (wallCount === 0) errors.push({ message: "地图至少需要一格墙体" });
  }

  // ===== 人类区 / 出生区（多块按并集） =====
  const humanZones = normalizeRectList(raw.humanZone, "humanZone", errors);
  const spawnZones = normalizeRectList(raw.spawn, "spawn", errors);
  if (raw.humanZone === undefined) {
    errors.push({ message: "缺少人类活动区（humanZone）" });
  } else if (Array.isArray(raw.humanZone) && raw.humanZone.length === 0) {
    errors.push({ message: "人类活动区至少需要 1 块矩形" });
  }
  if (raw.spawn === undefined) {
    errors.push({ message: "缺少僵尸出生区（spawn）" });
  } else if (Array.isArray(raw.spawn) && raw.spawn.length === 0) {
    errors.push({ message: "僵尸出生区至少需要 1 块矩形" });
  }
  const winSpawnRaw = raw.windowSpawn;
  let winTop: TileRect | null = null;
  let winBottom: TileRect | null = null;
  if (winSpawnRaw !== undefined) {
    if (!isRecord(winSpawnRaw)) {
      errors.push({ message: "windowSpawn 必须是 {top?, bottom?} 对象" });
    } else {
      if (winSpawnRaw.top !== undefined) {
        winTop = readRect(winSpawnRaw.top, "windowSpawn.top", errors);
      }
      if (winSpawnRaw.bottom !== undefined) {
        winBottom = readRect(winSpawnRaw.bottom, "windowSpawn.bottom", errors);
      }
    }
  }

  for (const zone of humanZones) {
    if (grid) checkEmptyRegion("人类活动区", zone, grid, errors);
  }
  const spawnRects: Array<{ name: string; rect: TileRect }> = [
    ...spawnZones.map((rect) => ({ name: "僵尸出生区", rect })),
    ...(winTop ? [{ name: "上窗出生区", rect: winTop }] : []),
    ...(winBottom ? [{ name: "下窗出生区", rect: winBottom }] : []),
  ];
  for (const { name, rect } of spawnRects) {
    if (grid) checkEmptyRegion(name, rect, grid, errors);
    for (const humanZone of humanZones) {
      if (rectsOverlap(rect, humanZone)) {
        errors.push({
          message: `${name}不能与人类活动区重叠`,
          x: Math.max(rect.x, humanZone.x),
          y: Math.max(rect.y, humanZone.y),
        });
        break;
      }
    }
  }

  if (typeof raw.buildBiteDamage !== "number" || !(raw.buildBiteDamage > 0)) {
    errors.push({ message: "buildBiteDamage 必须是正数" });
  }
  if (typeof raw.buildBiteSlow !== "number" || !(raw.buildBiteSlow > 0)) {
    errors.push({ message: "buildBiteSlow 必须是正数" });
  }

  // 人类区必须在墙体包围盒内（当前只有封闭房间，未做多房间）
  if (grid && humanZones.length > 0) {
    let minX = GRID_COLS;
    let minY = GRID_ROWS;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < GRID_ROWS; y++) {
      for (let x = 0; x < GRID_COLS; x++) {
        if (grid[y][x] !== TILE_CHARS.wall) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + 1 > maxX) maxX = x + 1;
        if (y + 1 > maxY) maxY = y + 1;
      }
    }
    if (maxX > 0) {
      for (const humanZone of humanZones) {
        const inside =
          humanZone.x >= minX &&
          humanZone.y >= minY &&
          humanZone.x + humanZone.w <= maxX &&
          humanZone.y + humanZone.h <= maxY;
        if (!inside) {
          errors.push({
            message: "人类活动区必须位于墙体包围的房间内",
            x: humanZone.x,
            y: humanZone.y,
          });
        }
      }
    }
  }

  // ===== 连通性 =====
  if (grid && openings.length > 0 && spawnZones.length > 0 && humanZones.length > 0) {
    const allSpawn = spawnRects.map((s) => s.rect);
    checkReachability(grid, openings, allSpawn, humanZones, errors);
  }

  return errors;
}
