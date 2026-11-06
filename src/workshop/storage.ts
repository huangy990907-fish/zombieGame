/**
 * 工坊存档 / 内置图读取 / 试玩预览桥。
 *
 * - 草稿：localStorage 自动保存，刷新后可恢复（存的是 doc.ts 的序列化快照）
 * - 内置图：从 public/maps/manifest.json 读取，工坊只读载入
 * - 试玩：把当前地图 JSON 存进独立 key，main.ts 启动时编译并注册为运行时地图，
 *   然后通过 `?map=workshop-draft` 进入训练场。正式选图入口仍留到阶段 3。
 */
import { compileTilesToMapDef } from "../data/maps/compile";
import { validateMapJson, MAP_SCHEMA_VERSION, type MapJson } from "../data/maps/schema";
import type { MapDef } from "../data/types";
import { deserializeDoc, serializeDoc, type WorkshopDoc } from "./doc";

const DRAFT_KEY = "zombieGame.workshop.draft.v1";
const PREVIEW_KEY = "zombieGame.workshop.preview.v1";

export const WORKSHOP_PREVIEW_MAP_ID = "workshop-draft";

interface DraftEnvelope {
  version: 1;
  updatedAt: number;
  snapshot: string;
}

export interface BuiltinMapEntry {
  id: string;
  file: string;
  name: string;
}

interface ManifestEntry {
  id: string;
  file: string;
  readOnly?: boolean;
}

interface MapManifest {
  schemaVersion: number;
  maps: ManifestEntry[];
}

function mapsBaseUrl(): string {
  return `${import.meta.env.BASE_URL || "/"}maps/`;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.warn(`[workshop] localStorage「${key}」读取失败`, err);
    return null;
  }
}

/** 保存草稿；返回写入时间（即使 localStorage 失败也返回，UI 只负责显示） */
export function saveWorkshopDraft(doc: WorkshopDoc): number {
  const now = Date.now();
  const envelope: DraftEnvelope = {
    version: 1,
    updatedAt: now,
    snapshot: serializeDoc(doc),
  };
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(envelope));
  } catch (err) {
    console.warn("[workshop] 草稿写入 localStorage 失败（可能超出配额）", err);
  }
  return now;
}

export function loadWorkshopDraft(): { doc: WorkshopDoc; updatedAt: number } | null {
  const envelope = readJson<DraftEnvelope>(DRAFT_KEY);
  if (!envelope || typeof envelope.snapshot !== "string") return null;
  const doc = deserializeDoc(envelope.snapshot);
  if (!doc) return null;
  return { doc, updatedAt: typeof envelope.updatedAt === "number" ? envelope.updatedAt : 0 };
}

let manifestPromise: Promise<MapManifest> | null = null;

async function getManifest(): Promise<MapManifest> {
  if (!manifestPromise) {
    manifestPromise = (async () => {
      const res = await fetch(`${mapsBaseUrl()}manifest.json`, { cache: "no-cache" });
      if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
      const data = (await res.json()) as MapManifest;
      if (!data || data.schemaVersion !== MAP_SCHEMA_VERSION || !Array.isArray(data.maps)) {
        throw new Error("manifest 结构非法");
      }
      return data;
    })().catch((err) => {
      manifestPromise = null;
      throw err;
    });
  }
  return manifestPromise;
}

const mapJsonCache = new Map<string, MapJson>();

export async function loadBuiltinMapJson(id: string): Promise<MapJson> {
  const cached = mapJsonCache.get(id);
  if (cached) return cached;
  const manifest = await getManifest();
  const entry = manifest.maps.find((m) => m && m.id === id);
  if (!entry) throw new Error(`manifest 里没有地图「${id}」`);
  const res = await fetch(`${mapsBaseUrl()}${entry.file}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${entry.file} HTTP ${res.status}`);
  const json = (await res.json()) as MapJson;
  mapJsonCache.set(id, json);
  return json;
}

/** 列出内置图（带中文名；读取失败的单张跳过，不影响其它图） */
export async function loadBuiltinCatalog(): Promise<BuiltinMapEntry[]> {
  const manifest = await getManifest();
  const entries = await Promise.all(
    manifest.maps.map(async (entry): Promise<BuiltinMapEntry | null> => {
      if (!entry || typeof entry.id !== "string" || typeof entry.file !== "string") return null;
      try {
        const json = await loadBuiltinMapJson(entry.id);
        return { id: entry.id, file: entry.file, name: json.name || entry.id };
      } catch {
        return { id: entry.id, file: entry.file, name: entry.id };
      }
    }),
  );
  return entries.filter((e): e is BuiltinMapEntry => e !== null);
}

/** 保存到项目后清空目录缓存，让下一次读取拿到新的 manifest 与地图 JSON */
export function resetWorkshopCatalog(): void {
  manifestPromise = null;
  mapJsonCache.clear();
}

export function saveWorkshopPreview(json: MapJson): void {
  const copy: MapJson = { ...json, id: WORKSHOP_PREVIEW_MAP_ID };
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(copy));
  } catch (err) {
    console.warn("[workshop] 试玩预览写入 localStorage 失败", err);
    throw err;
  }
}

/** main.ts 启动时调用：读取预览草稿并编译成运行时地图 */
export function compileWorkshopPreview(): MapDef | null {
  const json = readJson<MapJson>(PREVIEW_KEY);
  if (!json) return null;
  const candidate: MapJson = { ...json, id: WORKSHOP_PREVIEW_MAP_ID };
  const errors = validateMapJson(candidate);
  if (errors.length > 0) {
    console.warn(
      "[workshop] 试玩地图校验失败，已忽略：",
      errors.map((e) => (e.x === undefined ? e.message : `(${e.x},${e.y}) ${e.message}`)).join("；"),
    );
    return null;
  }
  try {
    return compileTilesToMapDef(candidate);
  } catch (err) {
    console.warn("[workshop] 试玩地图编译失败，已忽略", err);
    return null;
  }
}
