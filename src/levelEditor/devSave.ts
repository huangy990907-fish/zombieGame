/**
 * 关卡编辑器「保存到项目」的开发态客户端。
 * 只在 `import.meta.env.DEV` 下被动态导入；写入由 scripts/workshop-save-plugin.ts 的
 * `/__levels/save` dev 中间件完成，生产构建不会包含该接口。
 */
import type { LevelJson } from "../data/levels/schema";

const SAVE_ROUTE = "/__levels/save";

export interface LevelSaveResult {
  status: number;
  ok: boolean;
  message: string;
  code?: string;
  file?: string;
  backup?: string | null;
}

interface SaveResponse {
  ok?: boolean;
  message?: string;
  code?: string;
  file?: string;
  backup?: string | null;
}

export async function saveLevelToProject(
  level: LevelJson,
  overwrite: boolean,
): Promise<LevelSaveResult> {
  const url = `${import.meta.env.BASE_URL}${SAVE_ROUTE.replace(/^\//, "")}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: level.id, level, overwrite }),
    });
  } catch (err) {
    return {
      status: 0,
      ok: false,
      message: `无法连接开发服务器：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let body: SaveResponse = {};
  try {
    body = (await res.json()) as SaveResponse;
  } catch {
    // 非 JSON 响应（生产环境 / 代理返回 HTML）
  }
  return {
    status: res.status,
    ok: res.ok && body.ok === true,
    message: body.message ?? (res.ok ? "" : `保存失败（HTTP ${res.status}）`),
    code: body.code,
    file: body.file,
    backup: body.backup ?? null,
  };
}
