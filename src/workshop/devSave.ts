/**
 * 工坊「保存到项目」的开发态客户端。
 *
 * 只在 `import.meta.env.DEV` 下被动态导入，生产构建不会打进主包；
 * 实际写入由 scripts/workshop-save-plugin.ts 的 dev 中间件完成。
 */
import type { MapJson, MapValidationError } from "../data/maps/schema";

const SAVE_BUTTON_LABEL = "💾 保存到项目（dev）";
const SAVE_ROUTE = "/__workshop/save";

interface SaveResult {
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

/** 工坊页面提供给开发态保存流程的宿主能力 */
export interface DevSaveHost {
  button: HTMLButtonElement;
  isReadOnly: () => boolean;
  getErrors: () => MapValidationError[];
  getMap: () => MapJson;
  toast: (text: string, kind?: "bad") => void;
  /** 重新跑一次校验，恢复按钮可用状态 */
  refresh: () => void;
  /** 保存成功后的热刷新（工坊目录 + 注册表 + 训练场下拉），参数是被保存的 id */
  afterSave: (id: string) => Promise<void>;
}

async function requestSave(map: MapJson, overwrite: boolean): Promise<SaveResult> {
  const url = `${import.meta.env.BASE_URL}${SAVE_ROUTE.replace(/^\//, "")}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: map.id, map, overwrite }),
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
    // 非 JSON 响应（例如代理返回 HTML）
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

async function saveToProject(host: DevSaveHost): Promise<void> {
  const btn = host.button;
  if (btn.disabled) return;

  if (host.isReadOnly()) {
    host.toast("当前是内置只读地图，请先另存为副本", "bad");
    return;
  }
  const errors = host.getErrors();
  if (errors.length > 0) {
    const first = errors[0];
    const at = first.x === undefined ? "" : `(${first.x},${first.y}) `;
    host.toast(`还有 ${errors.length} 条校验错误：${at}${first.message}`, "bad");
    return;
  }

  let map: MapJson;
  try {
    map = host.getMap();
  } catch (err) {
    host.toast(err instanceof Error ? err.message : String(err), "bad");
    return;
  }

  const label = btn.textContent ?? "";
  btn.disabled = true;
  btn.textContent = "保存中…";
  try {
    let result = await requestSave(map, false);
    if (result.status === 409 && result.code === "name_taken") {
      // 名称冲突不能靠 overwrite 解决，直接提示换名
      host.toast(result.message || "地图名称已被其它地图使用，请换一个名称", "bad");
      return;
    }
    if (result.status === 409) {
      const ok = window.confirm(
        result.message || `「${map.id}」已存在，覆盖前会备份到 .bak，继续？`,
      );
      if (!ok) {
        host.toast("已取消保存");
        return;
      }
      result = await requestSave(map, true);
    }
    if (!result.ok) {
      host.toast(result.message || "保存失败", "bad");
      return;
    }
    const file = result.file ?? `${map.id}.json`;
    host.toast(
      result.backup
        ? `已写入 public/maps/${file}；旧文件备份为 ${result.backup}`
        : `已写入 public/maps/${file}，manifest 已登记`,
    );
    await host.afterSave(map.id);
  } catch (err) {
    host.toast(`写入项目失败：${err instanceof Error ? err.message : String(err)}`, "bad");
  } finally {
    btn.textContent = label;
    btn.disabled = false;
    host.refresh();
  }
}

/** 显示 dev 保存按钮并绑定点击流程；只在开发态调用 */
export function installDevSave(host: DevSaveHost): void {
  const btn = host.button;
  btn.textContent = SAVE_BUTTON_LABEL;
  btn.hidden = false;
  btn.onclick = () => void saveToProject(host);
  host.toast("开发态：可直接写入 public/maps 并自动登记 manifest");
  host.refresh();
}
