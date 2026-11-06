/**
 * 地图注册表。
 *
 * 0.5.0 起，内置地图以 `public/maps/*.json` + manifest 为唯一运行时来源：
 * 启动时 `loadBuiltinMaps()` 拉取 JSON，校验通过后编译成 MapDef 并替换注册表。
 * 任何一步失败都保留 `arena.ts` 的 TS 兜底，保证游戏仍能进入。
 *
 * `arena` 是内置只读地图：工坊/编辑器只能另存副本，不能覆盖它。
 */
import type { MapDef } from "../types";
import { arena } from "./arena";
import { compileTilesToMapDef } from "./compile";
import {
  MAP_SCHEMA_VERSION,
  validateMapJson,
  type MapJson,
  type MapValidationError,
} from "./schema";

export type { MapDef } from "../types";
export {
  MAP_SCHEMA_VERSION,
  TILE_SIZE,
  GRID_COLS,
  GRID_ROWS,
  MAP_WIDTH,
  MAP_HEIGHT,
} from "./schema";
export { compileTilesToMapDef } from "./compile";
export { validateMapJson } from "./schema";

interface ManifestEntry {
  id: string;
  file: string;
  /** 省略时按只读处理；false 才代表可被工坊覆盖 */
  readOnly?: boolean;
}

interface MapManifest {
  schemaVersion: number;
  maps: ManifestEntry[];
}

/** 地图注册表：id -> 定义（TS 兜底 + 运行时 JSON 编译结果） */
export const MAPS: Record<string, MapDef> = {
  arena,
};

/** 有序地图列表（顺序只影响展示，不承担身份语义） */
export const MAP_LIST: MapDef[] = Object.values(MAPS);

/** 当前默认地图；内置地图加载成功后会被 JSON 版本替换 */
export let DEFAULT_MAP: MapDef = arena;

/** 内置地图 id（来自 manifest；即使加载失败，arena 也始终算内置） */
export const BUILTIN_MAP_IDS = new Set<string>([arena.id]);

/** 只读地图 id：工坊只能另存副本 */
export const READONLY_MAP_IDS = new Set<string>([arena.id]);

export function getMap(id: string): MapDef {
  return MAPS[id] ?? DEFAULT_MAP;
}

export interface MapResolution {
  map: MapDef;
  /** 请求的 id；传 MapDef 时取它自己的 id */
  requestedId: string;
  /** 请求 id 不存在、实际回退了默认图 */
  fallback: boolean;
}

/**
 * 解析地图参数：MapDef 直接使用，字符串按 id 查表。
 * id 不存在时回退默认图并输出 warning，调用方可用 fallback 做可见提示。
 */
export function resolveMap(mapOrId: MapDef | string): MapResolution {
  if (typeof mapOrId !== "string") {
    return { map: mapOrId, requestedId: mapOrId.id, fallback: false };
  }
  const found = MAPS[mapOrId];
  if (found) return { map: found, requestedId: mapOrId, fallback: false };
  console.warn(`[maps] 地图 id「${mapOrId}」不存在，回退默认图「${DEFAULT_MAP.id}」`);
  return { map: DEFAULT_MAP, requestedId: mapOrId, fallback: true };
}

export function isReadOnlyMap(id: string): boolean {
  return READONLY_MAP_IDS.has(id);
}

/**
 * 注册运行时地图（工坊试玩预览用）。
 * 不写入 manifest，不算内置、不算只读；进程内有效，刷新后由预览草稿重新编译。
 */
export function registerRuntimeMap(map: MapDef): void {
  MAPS[map.id] = map;
  MAP_LIST.length = 0;
  MAP_LIST.push(...Object.values(MAPS));
  console.info(`[maps] 运行时地图已注册「${map.id}」${map.width}×${map.height}`);
}

function formatValidationErrors(errors: MapValidationError[]): string {
  return errors
    .map((e) => (e.x === undefined ? e.message : `(${e.x},${e.y}) ${e.message}`))
    .join("；");
}

/**
 * 加载 public/maps/manifest.json 列出的内置地图。
 * 必须在构造 World / Game / Renderer 之前 await，否则它们会拿到 TS 兜底几何。
 */
export async function loadBuiltinMaps(): Promise<void> {
  const base = import.meta.env.BASE_URL || "/";
  const manifestUrl = `${base}maps/manifest.json`;

  let manifest: MapManifest;
  try {
    const res = await fetch(manifestUrl, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = (await res.json()) as MapManifest;
  } catch (err) {
    console.warn(`[maps] manifest 加载失败（${manifestUrl}），使用 TS 兜底地图`, err);
    return;
  }

  if (
    !manifest ||
    manifest.schemaVersion !== MAP_SCHEMA_VERSION ||
    !Array.isArray(manifest.maps)
  ) {
    console.warn("[maps] manifest 结构非法，使用 TS 兜底地图");
    return;
  }

  let loaded = 0;
  for (const entry of manifest.maps) {
    if (!entry || typeof entry.id !== "string" || typeof entry.file !== "string") {
      console.warn("[maps] manifest 条目非法，已跳过", entry);
      continue;
    }
    const fileUrl = `${base}maps/${entry.file}`;
    try {
      const res = await fetch(fileUrl, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MapJson;
      const errors = validateMapJson(json);
      if (errors.length > 0) throw new Error(formatValidationErrors(errors));
      const map = compileTilesToMapDef(json);
      if (map.id !== entry.id) {
        throw new Error(`文件 id「${map.id}」与 manifest「${entry.id}」不一致`);
      }
      MAPS[map.id] = map;
      BUILTIN_MAP_IDS.add(map.id);
      if (entry.readOnly !== false) READONLY_MAP_IDS.add(map.id);
      loaded++;
      console.info(
        `[maps] 已加载「${map.id}」${map.width}×${map.height}，` +
          `${map.walls.length} 面墙 / ${map.openings.length} 个开口`,
      );
    } catch (err) {
      console.warn(`[maps] 地图「${entry.id}」加载失败，回退 TS 定义（若有）`, err);
    }
  }

  // 刷新派生列表与默认图：arena 加载成功就替换掉 TS 兜底
  MAP_LIST.length = 0;
  MAP_LIST.push(...Object.values(MAPS));
  DEFAULT_MAP = MAPS["arena"] ?? arena;
  console.info(`[maps] 内置地图就绪 ${loaded}/${manifest.maps.length}，默认「${DEFAULT_MAP.id}」`);
}
