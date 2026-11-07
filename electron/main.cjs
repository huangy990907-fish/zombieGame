/**
 * Electron 主进程 —— 桌面版最小外壳。
 *
 * 游戏本身是纯前端 SPA，但地图 / 关卡运行时数据通过 `fetch("/maps/*.json")`、
 * `fetch("/levels/*.json")` 读取，`file://` 下会被 CORS / 路径规则拒绝，
 * 所以启动时在 127.0.0.1 的随机端口起一个只读静态服务指向 `dist`，再 loadURL。
 *
 * 安全基线：contextIsolation + sandbox 开启、nodeIntegration 关闭、禁止新窗口、
 * 禁止离开本地服务地址。开发者模式 / dev 保存接口在生产构建里本就剥离，这里不额外暴露。
 */
const { app, BrowserWindow, dialog, session } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

/** 与打包配置一致；显式固定 userData 路径，避免 Electron 回退到默认目录 */
const APP_NAME = "ZombieSwarm";
app.setName(APP_NAME);
// localStorage（设置 / 关卡进度 / 求生记录）与 Chromium 缓存都落在这里；
// 不设置时部分环境会退回到 "Chromium" 目录，与 README 写的存档位置不一致。
// 显式传 --user-data-dir 时尊重命令行（方便调试 / 便携使用），不做覆盖。
if (!app.commandLine.hasSwitch("user-data-dir")) {
  app.setPath("userData", path.join(app.getPath("appData"), APP_NAME));
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

let mainWindow = null;
let staticServer = null;
let appUrl = "";

/** 打包后 dist 由 extraResources 落到 resources/dist；开发态直接读仓库内 dist */
function distRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "dist")
    : path.join(__dirname, "..", "dist");
}

/** 把请求路径限制在 dist 根目录内，防止 `..` 越界读取 */
function resolveAsset(root, rawUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(rawUrl, "http://127.0.0.1").pathname);
  } catch {
    return null;
  }
  if (pathname === "/") pathname = "/index.html";
  const resolved = path.normalize(path.join(root, pathname));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (!resolved.startsWith(rootWithSep)) return null;
  return resolved;
}

function startStaticServer(root) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { Allow: "GET, HEAD" });
        res.end("Method Not Allowed");
        return;
      }
      const file = req.url ? resolveAsset(root, req.url) : null;
      if (!file) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) {
          res.writeHead(404);
          res.end("Not Found");
          return;
        }
        res.writeHead(200, {
          "Content-Type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
          "Content-Length": stat.size,
          // 游戏靠 HTTP 读取运行时 JSON，禁用缓存避免地图 / 关卡改动后读到旧文件
          "Cache-Control": "no-cache",
        });
        if (req.method === "HEAD") {
          res.end();
          return;
        }
        const stream = fs.createReadStream(file);
        stream.on("error", () => res.destroy());
        stream.pipe(res);
      });
    });
    server.on("error", reject);
    // 端口 0 = 由系统分配空闲端口，只监听回环地址
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 960,
    minHeight: 600,
    resizable: true,
    show: false,
    backgroundColor: "#030308",
    title: "尸潮 · 人类 vs 丧尸",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      allowRunningInsecureContent: false,
      webSecurity: true,
    },
  });

  // 禁止新窗口（不区分外链与内链，游戏本身不需要多窗口）
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // 只允许停留在本地静态服务地址；hash 路由变化属于同文档导航，不会触发这里
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== appUrl) event.preventDefault();
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(appUrl);
}

async function launch() {
  const root = distRoot();
  if (!fs.existsSync(path.join(root, "index.html"))) {
    dialog.showErrorBox(
      "未找到游戏文件",
      `缺少 ${path.join(root, "index.html")}。\n请先执行 npm run build 再启动 / 打包桌面版。`,
    );
    app.quit();
    return;
  }

  try {
    staticServer = await startStaticServer(root);
    const address = staticServer.address();
    appUrl = `http://127.0.0.1:${address.port}/`;
  } catch (err) {
    dialog.showErrorBox("启动失败", `无法启动本地静态服务：${String(err)}`);
    app.quit();
    return;
  }

  // 游戏不需要摄像头 / 麦克风 / 通知等任何网页权限，一律拒绝
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  createWindow();
}

app.whenReady().then(launch);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && appUrl) createWindow();
});

// 所有平台关闭窗口即退出（macOS 也保持一致，不做后台驻留）
app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  if (staticServer) {
    staticServer.close();
    staticServer = null;
  }
});
