/**
 * 回归脚本入口：用 esbuild 把 suite.ts 打包成临时 ESM 文件，再用 Node 直接跑。
 *
 * 这样做的好处是回归场景能 import 真实的 src 模块（World / AI / 战斗 / 校验器），
 * 又不需要在仓库里引入测试框架，也不会把 DOM / PixiJS 模块拉进来。
 *
 * 用法：npm run regression
 * 失败时打印每个失败场景名并以非零退出码结束。
 */
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const outDir = await mkdtemp(join(tmpdir(), "zombie-game-regression-"));
const outFile = join(outDir, "suite.mjs");

try {
  await build({
    absWorkingDir: here,
    entryPoints: [join(here, "suite.ts")],
    outfile: outFile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: false,
    logLevel: "warning",
  });

  const suite = await import(pathToFileURL(outFile).href);
  const failures = await suite.runScenarios();
  process.exitCode = failures > 0 ? 1 : 0;
} catch (err) {
  console.error("[regression] 无法执行回归套件：", err);
  process.exitCode = 1;
} finally {
  await rm(outDir, { recursive: true, force: true });
}
