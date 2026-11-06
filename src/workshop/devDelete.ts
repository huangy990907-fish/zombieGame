/**
 * 工坊「删除当前地图」的开发态客户端。
 *
 * 只在 `import.meta.env.DEV` 下被动态导入，生产构建不会打进主包；
 * 实际删除由 scripts/workshop-save-plugin.ts 的 dev 中间件完成
 * （备份 → 移除 manifest 条目 → 删除文件）。
 */
const DELETE_BUTTON_LABEL = "🗑 删除当前地图";
const DELETE_ROUTE = "/__workshop/delete";

export interface DevDeleteInfo {
  id: string;
  name: string;
  canDelete: boolean;
  /** 不可删除的原因（展示在按钮 title / 点击提示里） */
  reason?: string;
}

interface DeleteResult {
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

/** 工坊页面提供给开发态删除流程的宿主能力 */
export interface DevDeleteHost {
  button: HTMLButtonElement;
  getInfo: () => DevDeleteInfo;
  toast: (text: string, kind?: "bad") => void;
  /** 重新跑一次校验 / 刷新按钮状态 */
  refresh: () => void;
  /** 删除成功后的热刷新（目录 + 注册表 + 训练场下拉），参数是被删的 id 与名称 */
  afterDelete: (id: string, name: string) => Promise<void>;
}

async function requestDelete(id: string): Promise<DeleteResult> {
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
    // 非 JSON 响应（例如代理返回 HTML / 生产环境 404 页）
  }
  return {
    status: res.status,
    ok: res.ok && body.ok === true,
    message: body.message ?? (res.ok ? "" : `删除失败（HTTP ${res.status}）`),
    code: body.code,
    backup: body.backup ?? null,
  };
}

async function deleteCurrent(host: DevDeleteHost): Promise<void> {
  const btn = host.button;
  const info = host.getInfo();
  if (!info.canDelete) {
    host.toast(info.reason ?? "当前地图不可删除", "bad");
    return;
  }
  const confirmed = window.confirm(
    `确定删除地图「${info.name}」（${info.id}）？\n` +
      "删除前会把文件备份到 public/maps/.bak/，删除后名称可复用。",
  );
  if (!confirmed) return;

  const label = btn.textContent ?? "";
  btn.disabled = true;
  btn.textContent = "删除中…";
  try {
    const result = await requestDelete(info.id);
    if (!result.ok) {
      host.toast(result.message || "删除失败", "bad");
      return;
    }
    host.toast(
      result.backup
        ? `已删除「${info.name}」，旧文件备份为 ${result.backup}`
        : `已删除「${info.name}」（${info.id}）`,
    );
    await host.afterDelete(info.id, info.name);
  } catch (err) {
    host.toast(`删除失败：${err instanceof Error ? err.message : String(err)}`, "bad");
  } finally {
    btn.textContent = label;
    btn.disabled = false;
    host.refresh();
  }
}

/** 显示 dev 删除按钮并绑定点击流程；返回一个同步禁用 / 提示状态的函数 */
export function installDevDelete(host: DevDeleteHost): () => void {
  const btn = host.button;
  btn.textContent = DELETE_BUTTON_LABEL;
  btn.hidden = false;
  btn.onclick = () => void deleteCurrent(host);

  const sync = (): void => {
    const info = host.getInfo();
    btn.disabled = !info.canDelete;
    btn.title = info.canDelete
      ? `删除「${info.name}」（${info.id}），删除前会备份到 public/maps/.bak/`
      : info.reason ?? "当前地图不可删除";
  };
  sync();
  host.toast("开发态：可删除 readOnly:false 的工坊地图（删除前会自动备份）");
  return sync;
}
