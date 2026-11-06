/**
 * 开发者模式 —— 仅界面层开关，不是安全边界。
 *
 * 状态存 localStorage，刷新后保持；密码来自 `.env.local` 的 `VITE_DEV_PASSWORD`，
 * 缺失时回退内置默认值。玩家仍可直接改 localStorage 或访问 URL 绕过，
 * 因此这里只用于隐藏工坊入口，不能当作权限校验。
 */
const STORAGE_KEY = "zombieGame.devMode.v1";
const DEFAULT_PASSWORD = "zb9993";

function configuredPassword(): string {
  const fromEnv: unknown = import.meta.env.VITE_DEV_PASSWORD;
  const value = typeof fromEnv === "string" ? fromEnv.trim() : "";
  return value || DEFAULT_PASSWORD;
}

export function isDevModeEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDevModeEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 隐私模式等写入失败时，本次会话由调用方持有的状态兜底
  }
}

export function checkDevPassword(input: string): boolean {
  return input.trim() === configuredPassword();
}
