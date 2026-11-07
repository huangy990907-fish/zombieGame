/**
 * 用 hdiutil 把 electron-builder 产出的 .app 打成 dmg。
 *
 * 不直接用 electron-builder 的 dmg target：dmgbuild 会往挂载卷写 `.VolumeIcon.icns`
 * 与 `.background`，在受限环境（如编辑器沙箱）里会被拒绝；hdiutil 只做镜像封装，
 * 不写这些隐藏文件，兼容性更稳。非 macOS 平台直接跳过（Windows 走 NSIS）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") {
  console.log("[dmg] 非 macOS 平台，跳过 dmg 打包");
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = path.join(root, "release");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

/** 找到 electron-builder 刚产出的 .app（mac-arm64 / mac / mac-universal） */
function findApp() {
  if (!fs.existsSync(releaseDir)) return null;
  for (const name of fs.readdirSync(releaseDir)) {
    if (!name.startsWith("mac") || !fs.statSync(path.join(releaseDir, name)).isDirectory()) continue;
    const app = path.join(releaseDir, name, "ZombieSwarm.app");
    if (fs.existsSync(app)) return { app, dir: name };
  }
  return null;
}

const found = findApp();
if (!found) {
  console.error("[dmg] 未找到 release/mac*/ZombieSwarm.app，请先执行 electron-builder");
  process.exit(1);
}

const arch = found.dir.includes("arm64") ? "arm64" : found.dir.includes("universal") ? "universal" : "x64";
const output = path.join(releaseDir, `ZombieSwarm-${pkg.version}-mac-${arch}.dmg`);
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "zombieswarm-dmg-"));

try {
  // ditto 保留 app bundle 的符号链接与扩展属性，比 fs.cp 更适合 macOS 包
  execFileSync("ditto", [found.app, path.join(stage, "ZombieSwarm.app")], { stdio: "inherit" });
  fs.symlinkSync("/Applications", path.join(stage, "Applications"));
  fs.rmSync(output, { force: true });
  execFileSync(
    "hdiutil",
    ["create", "-volname", "ZombieSwarm", "-srcfolder", stage, "-ov", "-format", "UDZO", output],
    { stdio: "inherit" },
  );
  const size = fs.statSync(output).size;
  console.log(`[dmg] ${path.relative(root, output)}（${(size / 1024 / 1024).toFixed(1)} MB）`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
