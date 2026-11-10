import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { workshopSavePlugin } from "./scripts/workshop-save-plugin";

/**
 * 构建产物清理：`publicDir` 会整目录复制，`.bak` 备份目录不应进 dist。
 * 只作用于 build，不影响 dev 下的保存 / 删除流程。
 */
function cleanBackupDirsPlugin(): Plugin {
  return {
    name: "clean-backup-dirs",
    apply: "build",
    closeBundle() {
      for (const dir of ["dist/maps/.bak", "dist/levels/.bak"]) {
        fs.rmSync(path.resolve(dir), { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  // 开发者口令只在 dev server 注入；build / preview 一律为空串，
  // 保证口令与开发者入口不会随发布产物发出去。
  const devBuild = command === "serve";
  const env = devBuild ? loadEnv(mode, process.cwd(), "") : { VITE_DEV_PASSWORD: "" };
  return {
    define: {
      __DEV_BUILD__: JSON.stringify(devBuild),
      __DEV_PASSWORD__: JSON.stringify((env.VITE_DEV_PASSWORD ?? "").trim()),
    },
    plugins: [workshopSavePlugin(), cleanBackupDirsPlugin()],
  };
});
