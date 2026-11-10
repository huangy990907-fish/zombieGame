/**
 * 开发者模式 —— 仅界面层开关，不是安全边界。
 *
 * `__DEV_BUILD__` / `__DEV_PASSWORD__` 由 vite.config.ts 在构建期注入：
 *   - dev server：true + `.env.local` 里的口令
 *   - build / preview：false + 空串
 * 因此发布产物里既没有口令常量，也没有可用的开发者入口；
 * 口令缺失时一律视为禁用，不再回退任何内置默认密码。
 */
declare const __DEV_BUILD__: boolean;
declare const __DEV_PASSWORD__: string;

const STORAGE_KEY = "zombieGame.devMode.v1";

/** 非 Vite 环境（回归脚本 / Node）里常量不存在，按"非开发构建"处理 */
const DEV_BUILD = typeof __DEV_BUILD__ === "boolean" ? __DEV_BUILD__ : false;

function configuredPassword(): string {
  if (!DEV_BUILD) return "";
  return typeof __DEV_PASSWORD__ === "string" ? __DEV_PASSWORD__.trim() : "";
}

/** 开发者功能是否可用：仅 dev 构建且口令已配置 */
export function devModeAvailable(): boolean {
  return DEV_BUILD && configuredPassword().length > 0;
}

export function isDevModeEnabled(): boolean {
  if (!DEV_BUILD) return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setDevModeEnabled(on: boolean): void {
  if (!DEV_BUILD) return;
  try {
    if (on) localStorage.setItem(STORAGE_KEY, "1");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 隐私模式等写入失败时，本次会话由调用方持有的状态兜底
  }
}

export function checkDevPassword(input: string): boolean {
  const password = configuredPassword();
  // 口令缺失（.env.local 没配）即禁用，不回退内置默认值
  if (!password) return false;
  return input.trim() === password;
}
