/**
 * 关卡注册表与加载器。
 *
 * 0.6.0 起，关卡以 `public/levels/manifest.json` + `<id>.json` 为运行时来源：
 * 启动时 `loadLevels()` 拉取 JSON、校验、替换注册表；失败时回退到 `level-1.ts`
 * 的 TS 兜底，保证至少有一关可玩，不白屏。
 *
 * `LEVELS` 是就地修改的数组：`src/levels.ts` 的展示投影与存档逻辑持有同一个引用，
 * 重新加载后无需重新 import。
 */
import { level1 } from "./level-1";
import {
  LEVEL_SCHEMA_VERSION,
  levelTotalZombies,
  validateLevelJson,
  type LevelJson,
} from "./schema";

export type {
  LevelHumanConfig,
  LevelJson,
  LevelWave,
  LevelWaveGroup,
} from "./schema";
export {
  LEVEL_SCHEMA_VERSION,
  LEVEL_ID_RE,
  LEVEL_WEAPON_ORDER,
  levelEnabledHumans,
  levelTotalZombies,
  validateLevelJson,
} from "./schema";

interface ManifestEntry {
  id: string;
  file: string;
  /** 省略时按只读处理；false 才代表开发者新建 / 可删除的关卡 */
  readOnly?: boolean;
}

interface LevelManifest {
  schemaVersion: number;
  levels: ManifestEntry[];
}

/** 关卡注册表（按 manifest 顺序；失败时只有 TS 兜底的教学关） */
export const LEVELS: LevelJson[] = [level1];

/** 有序列表（与 LEVELS 同一引用） */
export const LEVEL_LIST: LevelJson[] = LEVELS;

/** 安全的默认关卡：任何加载失败都回退到它 */
export const DEFAULT_LEVEL_ID = level1.id;

/** 内置关卡 id（manifest 中 readOnly !== false 的关卡；教学关始终算内置） */
export const BUILTIN_LEVEL_IDS = new Set<string>([level1.id]);

/** 只读关卡 id：开发者只能复制后编辑 */
export const READONLY_LEVEL_IDS = new Set<string>([level1.id]);

/** 最近一次从 manifest 成功加载的 id，删除关卡后用来清理注册表 */
const MANIFEST_LOADED_IDS = new Set<string>();

/** 上一次加载是否回退到 TS 兜底（UI 给可见提示） */
export let levelsFallback = false;
/** 加载 / 校验失败的摘要；null 表示正常 */
export let levelLoadError: string | null = null;

export function findLevel(id: string): LevelJson | undefined {
  return LEVELS.find((level) => level.id === id);
}

export function isReadOnlyLevel(id: string): boolean {
  return READONLY_LEVEL_IDS.has(id);
}

export function isBuiltinLevel(id: string): boolean {
  return BUILTIN_LEVEL_IDS.has(id);
}

function restoreFallback(reason: string): void {
  LEVELS.length = 0;
  LEVELS.push(level1);
  BUILTIN_LEVEL_IDS.clear();
  BUILTIN_LEVEL_IDS.add(level1.id);
  READONLY_LEVEL_IDS.clear();
  READONLY_LEVEL_IDS.add(level1.id);
  MANIFEST_LOADED_IDS.clear();
  levelsFallback = true;
  levelLoadError = reason;
}

/** 把注册表重置为 TS 兜底基线（重新加载 manifest 前调用） */
export function resetLevelCatalog(): void {
  LEVELS.length = 0;
  LEVELS.push(level1);
  BUILTIN_LEVEL_IDS.clear();
  BUILTIN_LEVEL_IDS.add(level1.id);
  READONLY_LEVEL_IDS.clear();
  READONLY_LEVEL_IDS.add(level1.id);
  MANIFEST_LOADED_IDS.clear();
  levelsFallback = false;
  levelLoadError = null;
}

/**
 * 加载 public/levels/manifest.json 列出的关卡。
 * 必须在 Game.start() / 选关页渲染之前 await，否则只能看到 TS 兜底。
 */
export async function loadLevels(): Promise<void> {
  const base = import.meta.env.BASE_URL || "/";
  const manifestUrl = `${base}levels/manifest.json`;

  let manifest: LevelManifest;
  try {
    const res = await fetch(manifestUrl, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    manifest = (await res.json()) as LevelManifest;
  } catch (err) {
    console.warn(`[levels] manifest 加载失败（${manifestUrl}），使用 TS 兜底关卡`, err);
    restoreFallback(`关卡清单加载失败（${String(err)}）`);
    return;
  }

  if (
    !manifest ||
    manifest.schemaVersion !== LEVEL_SCHEMA_VERSION ||
    !Array.isArray(manifest.levels)
  ) {
    console.warn("[levels] manifest 结构非法，使用 TS 兜底关卡");
    restoreFallback("关卡清单结构非法");
    return;
  }

  const loaded: LevelJson[] = [];
  const loadedIds = new Set<string>();
  const manifestIds = new Set<string>();
  const errors: string[] = [];

  for (const entry of manifest.levels) {
    if (!entry || typeof entry.id !== "string" || typeof entry.file !== "string") {
      console.warn("[levels] manifest 条目非法，已跳过", entry);
      errors.push("清单中存在非法条目");
      continue;
    }
    manifestIds.add(entry.id);
    const fileUrl = `${base}levels/${entry.file}`;
    try {
      const res = await fetch(fileUrl, { cache: "no-cache" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as LevelJson;
      const issues = validateLevelJson(json);
      if (issues.length > 0) throw new Error(issues.join("；"));
      if (json.id !== entry.id) {
        throw new Error(`文件 id「${json.id}」与 manifest「${entry.id}」不一致`);
      }
      if (loadedIds.has(json.id)) {
        throw new Error(`关卡 id「${json.id}」重复`);
      }
      loaded.push(json);
      loadedIds.add(json.id);
      console.info(
        `[levels] 已加载「${json.id}」${json.name} · ${json.waves.length} 波 · ` +
          `${levelTotalZombies(json)} 只 · 地图 ${json.mapId}`,
      );
    } catch (err) {
      const msg = `关卡「${entry.id}」加载失败：${err instanceof Error ? err.message : String(err)}`;
      console.warn(`[levels] ${msg}，已跳过`);
      errors.push(msg);
    }
  }

  // 教学关必须在：清单漏掉它时补 TS 兜底，保证始终有一个安全默认关卡
  if (!loadedIds.has(level1.id)) {
    loaded.unshift(level1);
    errors.push(`清单缺少教学关「${level1.id}」，已补 TS 兜底`);
  }

  if (loaded.length === 0) {
    restoreFallback("没有可用的关卡");
    return;
  }

  // 删除关卡后重新加载：把 manifest 中已不存在的旧关卡从注册表移除
  for (const id of [...MANIFEST_LOADED_IDS]) {
    if (manifestIds.has(id)) continue;
    MANIFEST_LOADED_IDS.delete(id);
    BUILTIN_LEVEL_IDS.delete(id);
    READONLY_LEVEL_IDS.delete(id);
    console.info(`[levels] 关卡「${id}」已从 manifest 移除，注册表同步删除`);
  }

  LEVELS.length = 0;
  LEVELS.push(...loaded);
  MANIFEST_LOADED_IDS.clear();
  BUILTIN_LEVEL_IDS.clear();
  READONLY_LEVEL_IDS.clear();
  for (const entry of manifest.levels) {
    if (!entry || typeof entry.id !== "string") continue;
    if (!loadedIds.has(entry.id) && entry.id !== level1.id) continue;
    MANIFEST_LOADED_IDS.add(entry.id);
    if (entry.readOnly !== false) {
      BUILTIN_LEVEL_IDS.add(entry.id);
      READONLY_LEVEL_IDS.add(entry.id);
    }
  }
  // 兜底教学关始终只读
  BUILTIN_LEVEL_IDS.add(level1.id);
  READONLY_LEVEL_IDS.add(level1.id);

  levelsFallback = errors.length > 0;
  levelLoadError = errors.length > 0 ? errors.join("；") : null;
  console.info(`[levels] 关卡就绪 ${loaded.length} 个（清单 ${manifest.levels.length} 项）`);
}
