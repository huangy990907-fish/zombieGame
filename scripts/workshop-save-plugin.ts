/**
 * Vite 开发服务器插件 —— 工坊「保存到项目」。
 *
 * 只在 dev（configureServer）注册；preview / build 没有该接口。
 * 服务端做二次校验、id 白名单、目录约束、只读保护、备份与原子写入。
 * 这不是发布通道：默认只允许 loopback 访问，远程开发需显式开关。
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv, type Plugin } from "vite";
import {
  MAP_SCHEMA_VERSION,
  validateMapJson,
  type MapJson,
} from "../src/data/maps/schema";

const ROUTE = "/__workshop/save";
const MAX_BODY_BYTES = 256 * 1024;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const RESERVED_IDS = new Set(["workshop-draft"]);
const KEEP_BACKUPS = 5;

interface ManifestEntry {
  id: string;
  file: string;
  readOnly?: boolean;
}

interface MapManifest {
  schemaVersion: number;
  maps: ManifestEntry[];
}

interface SaveRequestBody {
  id?: unknown;
  map?: unknown;
  overwrite?: unknown;
}

interface SaveResult {
  ok: true;
  id: string;
  file: string;
  overwritten: boolean;
  backup: string | null;
}

class SaveError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

function sendJson(
  res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (body: string) => void },
  status: number,
  payload: Record<string, unknown>,
): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function isLoopback(req: { socket: { remoteAddress?: string } }): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return (
    addr === "127.0.0.1" ||
    addr === "::1" ||
    addr === "::ffff:127.0.0.1"
  );
}

function readBody(req: {
  on: (event: string, cb: (chunk?: unknown) => void) => void;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      const text = String(chunk ?? "");
      size += Buffer.byteLength(text);
      if (size > MAX_BODY_BYTES) {
        settled = true;
        reject(new SaveError(413, "请求体超过 256KB 限制", "payload_too_large"));
        return;
      }
      body += text;
    });
    req.on("end", () => {
      if (!settled) resolve(body);
    });
    req.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function resolveMapFile(mapsDir: string, file: string): string | null {
  const base = path.basename(file);
  if (base !== file || !base.toLowerCase().endsWith(".json")) return null;
  const resolved = path.resolve(mapsDir, base);
  const root = path.resolve(mapsDir) + path.sep;
  return resolved.startsWith(root) ? resolved : null;
}

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(tmp, text, "utf8");
  await fs.promises.rename(tmp, file);
}

async function pruneBackups(backupDir: string, id: string): Promise<void> {
  let names: string[];
  try {
    names = await fs.promises.readdir(backupDir);
  } catch {
    return;
  }
  const prefix = `${id}-`;
  const mine = names
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .map((name) => {
      const stamp = Number(name.slice(prefix.length, -".json".length));
      return { name, stamp: Number.isFinite(stamp) ? stamp : 0 };
    })
    .sort((a, b) => b.stamp - a.stamp);
  for (const stale of mine.slice(KEEP_BACKUPS)) {
    await fs.promises.rm(path.join(backupDir, stale.name), { force: true });
  }
}

function firstErrors(map: MapJson): string {
  const errors = validateMapJson(map);
  if (errors.length === 0) return "";
  return errors
    .slice(0, 3)
    .map((e) => (e.x === undefined ? e.message : `(${e.x},${e.y}) ${e.message}`))
    .join("；");
}

export function workshopSavePlugin(): Plugin {
  let mapsDir = "";
  let allowRemote = false;
  let chain: Promise<unknown> = Promise.resolve();

  const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const handleSave = async (
    req: { socket: { remoteAddress?: string }; on: (e: string, cb: (c?: unknown) => void) => void },
    res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void },
  ): Promise<void> => {
    if (!allowRemote && !isLoopback(req)) {
      throw new SaveError(403, "只允许本机（loopback）保存地图；远程开发请显式开启开关", "remote_forbidden");
    }

    const raw = await readBody(req);
    let body: SaveRequestBody;
    try {
      body = JSON.parse(raw) as SaveRequestBody;
    } catch {
      throw new SaveError(400, "请求体不是合法 JSON", "bad_json");
    }
    if (!body || typeof body !== "object") {
      throw new SaveError(400, "请求体必须是 JSON 对象", "bad_json");
    }

    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!ID_PATTERN.test(id)) {
      throw new SaveError(
        400,
        "id 只允许 1–32 位小写字母、数字、- 或 _，且必须以字母或数字开头",
        "bad_id",
      );
    }
    if (RESERVED_IDS.has(id)) {
      throw new SaveError(400, `「${id}」是保留 id，不能用于正式地图`, "reserved_id");
    }
    if (!body.map || typeof body.map !== "object") {
      throw new SaveError(400, "缺少 map 对象", "bad_map");
    }
    const map = body.map as MapJson;
    if (map.id !== id) {
      throw new SaveError(400, `map.id「${map.id}」与请求 id「${id}」不一致`, "id_mismatch");
    }
    const errors = firstErrors(map);
    if (errors) {
      throw new SaveError(400, `地图校验失败：${errors}`, "invalid_map");
    }

    const manifestPath = path.join(mapsDir, "manifest.json");
    let manifest: MapManifest;
    try {
      manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8")) as MapManifest;
    } catch (err) {
      throw new SaveError(500, `manifest 读取失败：${err instanceof Error ? err.message : err}`, "manifest_read");
    }
    if (!manifest || manifest.schemaVersion !== MAP_SCHEMA_VERSION || !Array.isArray(manifest.maps)) {
      throw new SaveError(500, "manifest 结构非法，拒绝写入", "manifest_invalid");
    }

    const entry = manifest.maps.find((m) => m && m.id === id);
    if (entry && entry.readOnly !== false) {
      throw new SaveError(403, `「${id}」是只读地图，不能覆盖`, "readonly");
    }

    let targetFile = `${id}.json`;
    if (entry) {
      const resolved = resolveMapFile(mapsDir, entry.file);
      if (!resolved) {
        throw new SaveError(500, `manifest 中的文件名「${entry.file}」非法`, "bad_manifest_file");
      }
      targetFile = entry.file;
    }
    const targetPath = resolveMapFile(mapsDir, targetFile);
    if (!targetPath) {
      throw new SaveError(400, "目标文件路径非法", "bad_path");
    }

    const exists =
      Boolean(entry) ||
      fs.existsSync(targetPath) ||
      fs.existsSync(path.join(mapsDir, `${id}.json`));
    if (exists && body.overwrite !== true) {
      throw new SaveError(409, `「${id}」已存在，确认后会先备份再覆盖`, "exists");
    }

    const backupDir = path.join(mapsDir, ".bak");
    let backupPath: string | null = null;
    if (fs.existsSync(targetPath)) {
      await fs.promises.mkdir(backupDir, { recursive: true });
      const stamp = Date.now();
      backupPath = path.join(backupDir, `${id}-${stamp}.json`);
      await fs.promises.copyFile(targetPath, backupPath);
    }

    try {
      await writeAtomic(targetPath, `${JSON.stringify(map, null, 2)}\n`);

      const nextMaps = manifest.maps.slice();
      if (entry) {
        entry.file = targetFile;
        entry.readOnly = false;
      } else {
        nextMaps.push({ id, file: targetFile, readOnly: false });
      }
      const nextManifest: MapManifest = {
        schemaVersion: MAP_SCHEMA_VERSION,
        maps: nextMaps,
      };
      await writeAtomic(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`);
    } catch (err) {
      try {
        if (backupPath) await fs.promises.copyFile(backupPath, targetPath);
        else await fs.promises.rm(targetPath, { force: true });
      } catch (rollbackErr) {
        console.warn("[workshop-save] 回滚失败", rollbackErr);
      }
      throw new SaveError(500, `写入失败：${err instanceof Error ? err.message : err}`, "write_failed");
    }

    if (backupPath) {
      try {
        await pruneBackups(backupDir, id);
      } catch (err) {
        console.warn("[workshop-save] 清理旧备份失败", err);
      }
    }

    const result: SaveResult = {
      ok: true,
      id,
      file: targetFile,
      overwritten: exists,
      backup: backupPath ? path.basename(backupPath) : null,
    };
    sendJson(res, 200, result as unknown as Record<string, unknown>);
  };

  return {
    name: "workshop-save",
    apply: "serve",
    configResolved(config) {
      const publicDir = config.publicDir || path.join(config.root, "public");
      mapsDir = path.join(publicDir, "maps");
      const env = loadEnv(config.mode, config.root, "");
      allowRemote =
        env.VITE_WORKSHOP_ALLOW_REMOTE === "1" ||
        process.env.VITE_WORKSHOP_ALLOW_REMOTE === "1";
    },
    configureServer(server) {
      // Vite 启动时扫描 public 目录得到 publicFiles 集合，之后才新建的文件不在集合里，
      // 内部静态中间件会跳过并交给 SPA fallback（返回 index.html）。
      // 这里直接从磁盘读取 /maps/*.json，保证「保存后立刻可读」，不需要重启 dev server。
      // 只在 dev 生效；preview / build 没有这段中间件。
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          next();
          return;
        }
        const pathname = (req.url ?? "").split("?")[0];
        if (!pathname.startsWith("/maps/")) {
          next();
          return;
        }
        let fileName: string;
        try {
          fileName = decodeURIComponent(pathname.slice("/maps/".length));
        } catch {
          next();
          return;
        }
        if (fileName.includes("/") || !fileName.endsWith(".json")) {
          next();
          return;
        }
        const filePath = resolveMapFile(mapsDir, fileName);
        if (!filePath || !fs.existsSync(filePath)) {
          next();
          return;
        }
        fs.promises
          .readFile(filePath, "utf8")
          .then((text) => {
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache");
            res.end(req.method === "HEAD" ? undefined : text);
          })
          .catch(() => next());
      });

      server.middlewares.use(ROUTE, (req, res, next) => {
        if (req.method !== "POST") {
          next();
          return;
        }
        void enqueue(() => handleSave(req, res)).catch((err) => {
          const status = err instanceof SaveError ? err.status : 500;
          const code = err instanceof SaveError ? err.code : "internal";
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, status, { ok: false, code, message });
        });
      });
    },
  };
}
