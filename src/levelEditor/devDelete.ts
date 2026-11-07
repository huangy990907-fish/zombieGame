/**
 * 关卡编辑器「删除关卡」的开发态客户端。
 * 只在 DEV 动态导入；删除由 `/__levels/delete` dev 中间件完成
 * （引用保护 → 备份 → 移除 manifest 条目 → 删除文件）。
 */
const DELETE_ROUTE = "/__levels/delete";

export interface LevelDeleteResult {
  status: number;
  ok: boolean;
  message: string;
  code?: string;
  backup?: string | null;
}

interface DeleteResponse {
  ok?: boolean;
  message?: string;
  code?: string;
  backup?: string | null;
}

export async function deleteLevelFromProject(id: string): Promise<LevelDeleteResult> {
  const url = `${import.meta.env.BASE_URL}${DELETE_ROUTE.replace(/^\//, "")}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  } catch (err) {
    return {
      status: 0,
      ok: false,
      message: `无法连接开发服务器：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  let body: DeleteResponse = {};
  try {
    body = (await res.json()) as DeleteResponse;
  } catch {
    // 非 JSON 响应
  }
  return {
    status: res.status,
    ok: res.ok && body.ok === true,
    message: body.message ?? (res.ok ? "" : `删除失败（HTTP ${res.status}）`),
    code: body.code,
    backup: body.backup ?? null,
  };
}
