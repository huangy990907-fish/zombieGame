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
 * 存档 JSON 结构（版本 1）：
 *   { _version: 1, _exportedAt: "...", settings: { ...完整 SETTINGS... } }
 */
import { DEFAULT_SETTINGS, SETTINGS, SLIDERS, setSetting } from "../config";

/** 当前存档格式版本，导入时校验用。跨版本迁移时 bump 这个号 + 加迁移逻辑 */
export const SAVE_VERSION = 1;

/** localStorage key：存 SETTINGS 快照 */
const LS_SETTINGS = "zombieGame.settings.v1";
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

export function saveToLocal(): void {
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(SETTINGS));
  } catch {
    // 存不下或用户禁了隐私模式就静默失败
  }
}

export function loadFromLocal(): boolean {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    mergeSettings(parsed);
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

/** 让用户在系统对话框里选一个文件夹作为存档目录；之后所有自动读写都走这里 */
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
    await idbPut(IDB_DIR_KEY, dir);
    cachedDirHandle = dir;
    // 立刻把当前设置落盘一次
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
    const file = await dir.getFileHandle(SETTINGS_FILE, { create: true });
    const writable = await file.createWritable();
    await writable.write(new Blob([buildSavePayload()], { type: "application/json" }));
    await writable.close();
    return true;
  } catch (e) {
    console.warn("saveToDir failed", e);
    return false;
  }
}

/** 从 FSA 目录读 settings.json，读不到或损坏就返回 false */
export async function loadFromDir(): Promise<boolean> {
  const dir = await getSaveDir();
  if (!dir) return false;
  try {
    const handle = await dir.getFileHandle(SETTINGS_FILE);
    const file = await handle.getFile();
    const text = await file.text();
    return applySaveJSON(text);
  } catch {
    // 目录里还没有 settings.json（用户第一次选目录），不算错
    return false;
  }
}

// ============================================================
// 导入 / 导出 —— FSA 支持时弹系统对话框选文件；不支持时用 a.download / input[file]
// ============================================================

/** 导出：把当前 SETTINGS 打包成 JSON 给用户存到任意位置 */
export async function exportToFile(): Promise<void> {
  const content = buildSavePayload();
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

/** 导入：读 JSON 文件，校验版本，合并到 SETTINGS 并自动保存 */
export async function importFromFile(): Promise<boolean> {
  let text: string | null = null;
  if (FSA_SUPPORTED) {
    try {
      const handles = await (window as unknown as { showOpenFilePicker: () => Promise<FileSystemFileHandle[]> }).showOpenFilePicker();
      const file = await handles[0].getFile();
      text = await file.text();
    } catch (e) {
      if ((e as { name?: string })?.name !== "AbortError") console.warn("importFromFile failed", e);
      return false;
    }
  } else {
    // 降级：隐藏 input[type=file]
    text = await new Promise((resolve) => {
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
    if (!text) return false;
  }
  if (!text) return false; // 兜底，TypeScript 收窄不到这一步
  const ok = applySaveJSON(text);
  if (ok) {
    saveToLocal();
    await saveToDir();
  }
  return ok;
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

/** 记录通关一关：把它标记为 beaten，并解锁下一个关卡（按 LEVELS 数组顺序） */
export function recordBeaten(levelId: string): Progress {
  const p = loadProgress();
  if (!p.beaten.includes(levelId)) p.beaten.push(levelId);

  // 尝试解锁 LEVELS 数组中紧跟它后面的那关
  // 注意：这里不 import LEVELS（避免循环依赖），只按命名规则 level-N 推算下一关 id
  const match = levelId.match(/^level-(\d+)$/);
  if (match) {
    const nextNum = Number(match[1]) + 1;
    const nextId = `level-${nextNum}`;
    if (!p.unlocked.includes(nextId)) p.unlocked.push(nextId);
  }

  saveProgress(p);
  return p;
}

// ============================================================
// 启停入口 —— 每次滑块变化时调用 saveSettings()；页面启动时调用 loadSettings()
// ============================================================

/** 滑一下先存 localStorage，再异步写 FSA 目录（如果已选过） */
export async function saveSettings(): Promise<void> {
  saveToLocal();
  // 不 await，别让滑块卡顿
  void saveToDir();
}

/** 启动时读：先 FSA 目录（最权威，跨设备同步），再 localStorage（本机兜底），都没有就用默认值 */
export async function loadSettings(): Promise<"dir" | "local" | "default"> {
  if (await loadFromDir()) {
    saveToLocal(); // 把目录里的值同步进 localStorage，两边对齐
    return "dir";
  }
  if (loadFromLocal()) {
    return "local";
  }
  // 什么存档都没有 —— 主动把默认值存一次，之后刷新就有东西了
  saveToLocal();
  return "default";
}

/** 重置成游戏出厂默认值，自动写回 localStorage + FSA 目录 */
export async function resetToDefaults(): Promise<void> {
  // 用 DEFAULT_SETTINGS 的深拷贝覆盖 SETTINGS（DEFAULT_SETTINGS 是 import 时的快照）
  for (const grp of Object.keys(SETTINGS) as (keyof typeof SETTINGS)[]) {
    for (const key of Object.keys(SETTINGS[grp])) {
      (SETTINGS[grp] as Record<string, unknown>)[key] = JSON.parse(
        JSON.stringify((DEFAULT_SETTINGS[grp] as Record<string, unknown>)[key]),
      );
    }
  }
  saveToLocal();
  await saveToDir();
}

// ============================================================
// 内部：payload 构造 & 版本校验 & 合并
// ============================================================

function buildSavePayload(): string {
  const payload = {
    _version: SAVE_VERSION,
    _exportedAt: new Date().toISOString(),
    settings: SETTINGS,
  };
  return JSON.stringify(payload, null, 2);
}

/** 校验 JSON 结构 + 合并到 SETTINGS。版本不匹配会弹 warning */
function applySaveJSON(text: string): boolean {
  let data: { _version?: unknown; settings?: unknown } | null = null;
  try {
    data = JSON.parse(text);
  } catch {
    console.warn("存档 JSON 解析失败");
    return false;
  }
  if (!data || typeof data !== "object") return false;
  if (data._version !== undefined && data._version !== SAVE_VERSION) {
    // 版本号不一致（比如用户读了个未来版本 / 老版本）—— 弹 warning 但尽量兼容
    const ok = confirm(
      `存档版本是 v${data._version}，当前游戏格式是 v${SAVE_VERSION}。\n\n` +
        `继续导入可能导致部分字段丢失或使用默认值。是否继续？`,
    );
    if (!ok) return false;
  }
  if (!data.settings || typeof data.settings !== "object") {
    console.warn("存档缺 settings 字段");
    return false;
  }
  mergeSettings(data.settings as Record<string, unknown>);
  return true;
}

/** 把一个扁平/嵌套对象按 path 合并进 SETTINGS，只覆盖 SLIDERS 里声明过的路径（防脏数据） */
function mergeSettings(src: Record<string, unknown>): void {
  for (const s of SLIDERS) {
    const parts = s.path.split(".");
    let v: unknown = src;
    for (const p of parts) {
      v = (v as Record<string, unknown>)?.[p];
      if (v === undefined) break;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      setSetting(s.path, v);
    }
  }
}
