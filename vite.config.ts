import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
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

export default defineConfig({
  plugins: [workshopSavePlugin(), cleanBackupDirsPlugin()],
});
