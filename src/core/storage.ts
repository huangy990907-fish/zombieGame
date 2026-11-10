/**
 * 存档系统 —— 三层持久化：
 *
 *   1. localStorage      —— 每次调滑块自动存（快、默认开启、Safari/Firefox 唯一选项）
 *   2. FSA 目录句柄       —— 用户选过一次存档文件夹后持久授权，自动读写该目录下 settings.json
 *   3. 手动导入/导出      —— 生成带版本号的 JSON，跨设备拷贝分享
 *
 * 浏览器能力检测：
 *   - showDirectoryPicker 存在 → 支持 FSA 目录句柄（Chrome/Edge，localhost 或 HTTPS）
 *   - 否则                    → 所有 FSA 操作自动降级为手动 <input file> / <a download>
 *
 * 存档 JSON 结构（版本 2）：
 *   { _version: 2, _exportedAt: "...", settings: { ...玩家覆盖值... } }
 * 版本 1 存的是完整 SETTINGS 快照（含数字下标的实体值），与 0.3.0 不再兼容；
 * 读到不认识的版本直接回落默认值，不抛异常。
 */
import { clearOverrides, getOverridesSnapshot, mergeOverrides, replaceOverrides } from "../data/settings/runtime";

/** 当前存档格式版本，导入时校验用。跨版本迁移时 bump 这个号 + 加迁移逻辑 */
export const SAVE_VERSION = 2;

/** localStorage key：存玩家覆盖值快照 */
const LS_SETTINGS = "zombieGame.settings.v2";
/** IndexedDB database / store / key：存 FSA 目录句柄（句柄不能放 localStorage，必须进 IDB） */
const IDB_DB = "zombieGame";
const IDB_STORE = "handles";
const IDB_DIR_KEY = "saveDir";
/** FSA 目录内的设置文件名 */
const SETTINGS_FILE = "settings.json";

/** FSA 能力检测（showDirectoryPicker 只在 Chromium + 安全上下文存在） */
export const FSA_SUPPORTED =
  typeof window !== "undefined" &&
  typeof (window as unknown as { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker === "function" &&
  typeof (window as unknown as { showOpenFilePicker?: () => Promise<FileSystemFileHandle[]> }).showOpenFilePicker === "function" &&
  typeof (window as unknown as { showSaveFilePicker?: () => Promise<FileSystemFileHandle> }).showSaveFilePicker === "function";

// ============================================================
// IndexedDB 小工具 —— 存 / 取 FSA 目录句柄
// ============================================================

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut<T>(key: string, value: T): Promise<void> {
  const db = await openIDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openIDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ============================================================
// localStorage —— 快速兜底，每次滑块变化先写这个
// ============================================================

export function saveToLocal(): boolean {
  try {
    localStorage.setItem(
      LS_SETTINGS,
      JSON.stringify({
        _version: SAVE_VERSION,
        _exportedAt: new Date().toISOString(),
        settings: getOverridesSnapshot(),
      }),
    );
    return true;
  } catch {
    // 存不下或用户禁了隐私模式：返回 false，由调用方提示"仅本机 / 保存失败"
    return false;
  }
}

/** 一存档文本 + 用于比较新旧的时间戳 */
export interface SavePayloadText {
  text: string;
  /** `_exportedAt` 解析结果；缺失 / 非法为 NaN */
  at: number;
}

/** 从存档 JSON 里取 `_exportedAt`，缺失或非法返回 NaN */
function exportedAtOf(raw: string): number {
  try {
    const parsed = JSON.parse(raw) as { _exportedAt?: unknown } | null;
    const at = typeof parsed?._exportedAt === "string" ? Date.parse(parsed._exportedAt) : NaN;
    return Number.isFinite(at) ? at : NaN;
  } catch {
    return NaN;
  }
}

function readLocalPayload(): SavePayloadText | null {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return null;
    return { text: raw, at: exportedAtOf(raw) };
  } catch {
    return null;
  }
}

/**
 * 两份存档都存在时挑较新的：只比较 `_exportedAt`（缺失时用调用方给的兜底时间戳）。
 * 两边都拿不到时间戳时保持旧的「目录优先」；只有一边存在就用那一边。
 */
export function pickNewerSave(
  dir: SavePayloadText | null,
  local: SavePayloadText | null,
): "dir" | "local" | null {
  if (!dir) return local ? "local" : null;
  if (!local) return "dir";
  const dirAt = Number.isFinite(dir.at) ? dir.at : Number.NEGATIVE_INFINITY;
  const localAt = Number.isFinite(local.at) ? local.at : Number.NEGATIVE_INFINITY;
  if (dirAt === localAt) return "dir";
  return localAt > dirAt ? "local" : "dir";
}

export function loadFromLocal(): boolean {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { _version?: unknown; settings?: unknown } | null;
    // 旧格式（裸 SETTINGS / 数字下标实体值）直接忽略，回落默认值
    if (!parsed || parsed._version !== SAVE_VERSION || !parsed.settings || typeof parsed.settings !== "object") {
      return false;
    }
    replaceOverrides(parsed.settings);
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// FSA 目录句柄 —— 用户选一次后自动持久授权
// ============================================================

type DirHandle = FileSystemDirectoryHandle;

/** 从 IDB 取回之前授权过的目录句柄（可能失效，要 queryPermission 确认） */
async function loadDirHandle(): Promise<DirHandle | null> {
  const handle = await idbGet<DirHandle>(IDB_DIR_KEY);
  if (!handle) return null;
  // 句柄可能被浏览器撤销授权，queryPermission 检查一下
  const anyHandle = handle as unknown as { queryPermission?: (mode: string) => Promise<string> };
  if (anyHandle.queryPermission) {
    const perm = await anyHandle.queryPermission("readwrite");
    if (perm === "denied") return null; // 被拒了，用户得重新选
  }
  return handle;
}

let cachedDirHandle: DirHandle | null | undefined = undefined; // undefined = 还没查过

/** 获取当前可用的目录句柄（可能 null）。缓存在内存里避免每次都查 IDB */
export async function getSaveDir(): Promise<DirHandle | null> {
  if (cachedDirHandle !== undefined) return cachedDirHandle;
  cachedDirHandle = await loadDirHandle();
  return cachedDirHandle;
}

/** 目录存档的读取结果：读到 / 还没有文件 / 读失败（权限、IO 等） */
type DirReadState =
  | { kind: "ok"; payload: SavePayloadText }
  | { kind: "missing" }
  | { kind: "failed" };

/**
 * 读目录里的 settings.json。
 * 文件不存在 = missing（首次使用，正常）；其它异常 = failed（不要拿默认值回写）。
 * 时间戳优先用 `_exportedAt`，缺失时退回文件 mtime。
 */
async function readDirState(): Promise<DirReadState> {
  const dir = await getSaveDir();
  if (!dir) return { kind: "missing" };
  try {
    const handle = await dir.getFileHandle(SETTINGS_FILE);
    const file = await handle.getFile();
    const text = await file.text();
    const parsedAt = exportedAtOf(text);
    return {
      kind: "ok",
      payload: { text, at: Number.isFinite(parsedAt) ? parsedAt : file.lastModified },
    };
  } catch (e) {
    if ((e as { name?: string })?.name === "NotFoundError") return { kind: "missing" };
    console.warn("loadFromDir failed", e);
    return { kind: "failed" };
  }
}

/** 把文本写进指定目录下的文件（目录写失败的异常交给调用方处理） */
async function writeTextFile(dir: DirHandle, name: string, text: string): Promise<void> {
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(new Blob([text], { type: "application/json" }));
  await writable.close();
}

function describeError(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

/**
 * 选目录时目录里已有 settings.json：让用户显式决定覆盖方向。
 * 返回 cancel 表示不改任何文件。
 */
function askDirConflict(): "dir" | "local" | "backup" | "cancel" {
  const input = window.prompt(
    "这个目录里已经有 settings.json：\n\n" +
      "输入 1：用目录里的设置覆盖本机\n" +
      "输入 2：用本机当前设置覆盖目录\n" +
      "输入 3：先把目录里的文件备份，再用本机覆盖\n\n" +
      "留空或取消：不改变任何文件",
    "1",
  );
  if (input === null) return "cancel";
  const value = input.trim();
  if (value === "1") return "dir";
  if (value === "2") return "local";
  if (value === "3") return "backup";
  return "cancel";
}

/**
 * 让用户在系统对话框里选一个文件夹作为存档目录；之后所有自动读写都走这里。
 * 目录里已有 settings.json 时不会静默覆盖，先问用户选覆盖方向。
 */
export async function selectSaveDir(): Promise<DirHandle | null> {
  if (!FSA_SUPPORTED) {
    // 降级：把目录路径贴进 localStorage 当"标记"用，但没法真正自动读写
    alert("当前浏览器不支持自动读写本地文件夹（需要 Chrome/Edge 且 localhost 或 HTTPS）。将为你开启手动导入/导出模式。");
    cachedDirHandle = null;
    return null;
  }
  try {
    const dir = await (window as unknown as { showDirectoryPicker: () => Promise<DirHandle> }).showDirectoryPicker();
    // 请求持久授权——页面关了再开还能继续用
    const anyDir = dir as unknown as { requestPermission?: (mode: string) => Promise<string> };
    if (anyDir.requestPermission) {
      const perm = await anyDir.requestPermission("readwrite");
      if (perm === "denied") {
        alert("未授予写入权限，无法自动存档。");
        return null;
      }
    }

    // 先试探目录里是否已有存档，有就交给用户决定，不静默写
    let existing: string | null = null;
    try {
      const handle = await dir.getFileHandle(SETTINGS_FILE);
      existing = await (await handle.getFile()).text();
    } catch (e) {
      if ((e as { name?: string })?.name !== "NotFoundError") throw e;
    }

    if (existing !== null) {
      const choice = askDirConflict();
      if (choice === "cancel") return null;
      if (choice === "dir") {
        // 先校验再动本机值：解析失败时保持原样，不清空
        const settings = parseSaveJSON(existing);
        if (!settings) {
          alert("目录里的 settings.json 无法解析，已保持本机设置不变。");
          return null;
        }
        // 用目录覆盖本机：整体替换，避免本机独有字段残留在合并结果里
        replaceOverrides(settings);
        saveToLocal();
        await idbPut(IDB_DIR_KEY, dir);
        cachedDirHandle = dir;
        return dir;
      }
      if (choice === "backup") {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
        await writeTextFile(dir, `settings.backup-${stamp}.json`, existing);
      }
    }

    await idbPut(IDB_DIR_KEY, dir);
    cachedDirHandle = dir;
    // 用本机设置覆盖目录（含"先备份"分支）
    await saveToDir();
    return dir;
  } catch (e) {
    // 用户点了取消也会抛异常，静默处理
    if ((e as { name?: string })?.name !== "AbortError") {
      console.warn("selectSaveDir failed", e);
    }
    return null;
  }
}

/** 清除已授权的存档目录（用户想换个位置存） */
export async function clearSaveDir(): Promise<void> {
  await idbDelete(IDB_DIR_KEY);
  cachedDirHandle = null;
}

/** 把当前 SETTINGS 写到 FSA 目录下的 settings.json（有目录句柄才真正写） */
export async function saveToDir(): Promise<boolean> {
  const dir = await getSaveDir();
  if (!dir) return false;
  try {
    await writeTextFile(dir, SETTINGS_FILE, buildSavePayload());
    return true;
  } catch (e) {
    console.warn("saveToDir failed", e);
    return false;
  }
}

/** 从 FSA 目录读 settings.json，读不到或损坏就返回 false */
export async function loadFromDir(): Promise<boolean> {
  const state = await readDirState();
  if (state.kind !== "ok") return false;
  return applySaveJSON(state.payload.text);
}

// ============================================================
// 导入 / 导出 —— FSA 支持时弹系统对话框选文件；不支持时用 a.download / input[file]
// ============================================================

/** 导出：把当前 SETTINGS 打包成 JSON 给用户存到任意位置 */
export async function exportToFile(snapshot = getOverridesSnapshot()): Promise<void> {
  const content = buildSavePayload(snapshot);
  if (FSA_SUPPORTED) {
    try {
      const handle = await (window as unknown as { showSaveFilePicker: () => Promise<FileSystemFileHandle> }).showSaveFilePicker();
      const writable = await handle.createWritable();
      await writable.write(new Blob([content], { type: "application/json" }));
      await writable.close();
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") console.warn("exportToFile failed", e);
    }
  } else {
    // 降级：a 标签 download
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    a.href = url;
    a.download = `zombieGame-settings-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** 让用户挑一个 JSON 文件并读成文本；取消 / 失败返回 null */
async function pickFileText(): Promise<string | null> {
  if (FSA_SUPPORTED) {
    try {
      const handles = await (window as unknown as { showOpenFilePicker: () => Promise<FileSystemFileHandle[]> }).showOpenFilePicker();
      const file = await handles[0].getFile();
      return await file.text();
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") console.warn("pickFileText failed", e);
      return null;
    }
  }
  // 降级：隐藏 input[type=file]
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsText(f);
    };
    input.click();
  });
}

/** 导入：读 JSON 文件，校验版本，合并到 SETTINGS 并自动保存 */
export async function importFromFile(): Promise<boolean> {
  const text = await pickFileText();
  if (!text) return false;
  const ok = applySaveJSON(text);
  if (ok) {
    saveToLocal();
    await saveToDir();
  }
  return ok;
}

/**
 * 读取存档文件的 settings 内容但不合并、不落盘。
 * 数值调参页「导入」只作用于草稿，因此需要先拿到纯数据。
 */
export async function readSettingsFile(): Promise<unknown | null> {
  const text = await pickFileText();
  if (!text) return null;
  return parseSaveJSON(text);
}

/** localStorage key：存进度（解锁关卡、已通关关卡） */
const LS_PROGRESS = "zombieGame.progress.v1";

export interface Progress {
  /** 已解锁的关卡 id 集合（至少包含第一个关卡） */
  unlocked: string[];
  /** 已通关的关卡 id 集合 */
  beaten: string[];
}

const DEFAULT_PROGRESS: Progress = {
  unlocked: ["level-1"],
  beaten: [],
};

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(LS_PROGRESS);
    if (!raw) return { ...DEFAULT_PROGRESS };
    const parsed = JSON.parse(raw);
    // 防御性校验
    if (parsed && Array.isArray(parsed.unlocked) && Array.isArray(parsed.beaten)) {
      // 保证第一个关卡永远在 unlocked 里（以防用户清了 localStorage 部分 key）
      const unlocked = parsed.unlocked.includes("level-1") ? parsed.unlocked : ["level-1", ...parsed.unlocked];
      return { unlocked, beaten: parsed.beaten };
    }
  } catch {
    // 忽略
  }
  return { ...DEFAULT_PROGRESS };
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(LS_PROGRESS, JSON.stringify(p));
  } catch {
    // 忽略
  }
}

/**
 * 清空玩法进度（放置抵抗的关卡解锁/通关 + 尸潮求生的最佳记录 + 预留的挑战进度 key）。
 * 只删进度相关的 key，不碰设置覆盖值 / 音量偏好，也不碰 FSA 目录里的 settings.json。
 */
export function clearProgress(): void {
  try {
    localStorage.removeItem(LS_PROGRESS);
    // 尸潮求生只持久化最佳存活时间 / 最高等级（见 src/survival/storage.ts）
    localStorage.removeItem("zombieGame.survival.v1");
    // 预留：未来挑战模式的进度也只落在这些 key 上
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("zombieGame.challenge.")) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // 隐私模式等场景静默失败
  }
}

/**
 * 记录通关一关：把它标记为 beaten，并解锁下一关。
 * `levelIds` 传入当前关卡清单顺序时按顺序解锁；省略时退回旧的 `level-N` 命名规则。
 */
export function recordBeaten(levelId: string, levelIds?: string[]): Progress {
  const p = loadProgress();
  if (!p.beaten.includes(levelId)) p.beaten.push(levelId);

  let nextId: string | undefined;
  if (levelIds) {
    const i = levelIds.indexOf(levelId);
    nextId = i >= 0 ? levelIds[i + 1] : undefined;
  } else {
    const match = levelId.match(/^level-(\d+)$/);
    if (match) nextId = `level-${Number(match[1]) + 1}`;
  }
  if (nextId && !p.unlocked.includes(nextId)) p.unlocked.push(nextId);

  saveProgress(p);
  return p;
}

// ============================================================
// 启停入口 —— 每次滑块变化时调用 saveSettings()；页面启动时调用 loadSettings()
// ============================================================

/** 一次保存的真实结果：local / dir 各自是否成功，目录失败时带原因 */
export interface SaveResult {
  local: boolean;
  /** 未配置目录时也是 false（dirError 为空） */
  dir: boolean;
  dirError?: string;
}

export type SaveStatusTone = "saved" | "warn" | "error";
export interface SaveStatus {
  text: string;
  tone: SaveStatusTone;
}

/**
 * 把保存结果翻译成 UI 三态：
 * 两处都成功 = 已保存；只剩本机 = 警告（带原因）；都失败 = 保存失败。
 */
export function describeSaveResult(result: SaveResult, time = ""): SaveStatus {
  const stamp = time ? ` ${time}` : "";
  if (result.dir) return { text: `✅ 已保存${stamp}`, tone: "saved" };
  if (result.local) {
    const reason = result.dirError ? `目录写入失败：${result.dirError}` : "未配置存档目录";
    return { text: `⚠️ 仅本机已保存${stamp} · ${reason}`, tone: "warn" };
  }
  return {
    text: `❌ 保存失败：${result.dirError ?? "浏览器拒绝了本地存储"}`,
    tone: "error",
  };
}

/** 滑一下先存 localStorage，再写 FSA 目录（如果已选过），返回两边真实结果 */
export async function saveSettings(): Promise<SaveResult> {
  const local = saveToLocal();
  const dir = await getSaveDir();
  if (!dir) return { local, dir: false };
  try {
    await writeTextFile(dir, SETTINGS_FILE, buildSavePayload());
    return { local, dir: true };
  } catch (e) {
    console.warn("saveToDir failed", e);
    return { local, dir: false, dirError: describeError(e) };
  }
}

/**
 * 启动时读：目录与 localStorage 都存在时比较 `_exportedAt` 取较新者；
 * 只有一边存在就用那一边；都没有才写默认值。
 * 目录读取失败时保持本机现状，不拿默认值回写任何一边。
 */
export async function loadSettings(): Promise<"dir" | "local" | "default"> {
  const dirState = await readDirState();
  const localState = readLocalPayload();
  const dirPayload = dirState.kind === "ok" ? dirState.payload : null;

  const order: Array<"dir" | "local"> =
    pickNewerSave(dirPayload, localState) === "local" ? ["local", "dir"] : ["dir", "local"];

  for (const src of order) {
    if (src === "dir") {
      if (dirPayload && applySaveJSON(dirPayload.text)) {
        saveToLocal(); // 把较新的目录值同步进 localStorage，两边对齐
        return "dir";
      }
    } else if (loadFromLocal()) {
      return "local";
    }
  }

  // 目录读失败：不拿默认值覆盖，避免把只是"暂时读不到"的存档抹掉
  if (dirState.kind === "failed") return "default";

  // 什么存档都没有 —— 主动把默认值存一次，之后刷新就有东西了
  saveToLocal();
  return "default";
}

/** 重置成游戏出厂默认值，自动写回 localStorage + FSA 目录 */
export async function resetToDefaults(): Promise<void> {
  // 清空所有玩家覆盖值，读取时自然回落到实体 / 地图定义默认值
  clearOverrides();
  saveToLocal();
  await saveToDir();
}

// ============================================================
// 内部：payload 构造 & 版本校验 & 合并
// ============================================================

function buildSavePayload(snapshot = getOverridesSnapshot()): string {
  const payload = {
    _version: SAVE_VERSION,
    _exportedAt: new Date().toISOString(),
    settings: snapshot,
  };
  return JSON.stringify(payload, null, 2);
}

/** 校验 JSON 结构并取出 settings（不合并、不落盘） */
function parseSaveJSON(text: string): unknown | null {
  let data: { _version?: unknown; settings?: unknown } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    console.warn("存档 JSON 解析失败");
    return null;
  }
  if (!data || typeof data !== "object") return null;
  if (data._version !== undefined && data._version !== SAVE_VERSION) {
    // 版本号不一致（比如用户读了个未来版本 / 老版本）—— 弹 warning 但尽量兼容
    const ok = confirm(
      `存档版本是 v${data._version}，当前游戏格式是 v${SAVE_VERSION}。\n\n` +
        `继续导入可能导致部分字段丢失或使用默认值。是否继续？`,
    );
    if (!ok) return null;
  }
  if (!data.settings || typeof data.settings !== "object") {
    console.warn("存档缺 settings 字段");
    return null;
  }
  return data.settings;
}

/** 校验 JSON 结构 + 合并到 SETTINGS。版本不匹配会弹 warning */
function applySaveJSON(text: string): boolean {
  const settings = parseSaveJSON(text);
  if (!settings) return false;
  mergeOverrides(settings);
  return true;
}
