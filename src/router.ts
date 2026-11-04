/**
 * 极简 hash 路由 —— 只有三屏：主菜单 / 选关 / 战斗。
 * URL 形如：#/ 或 #/menu → 主菜单；#/levels → 选关；#/play → 战斗。
 * 所有页面共享同一个 PixiJS renderer，只是用 CSS 控制哪个显隐。
 */

export type Route = "menu" | "levels" | "play";

const VALID_ROUTES: Record<string, Route> = {
  "": "menu",
  "/": "menu",
  "/menu": "menu",
  "/levels": "levels",
  "/play": "play",
};

export type RouteListener = (route: Route, old: Route) => void;

class Router {
  private current: Route = "menu";
  private listeners: RouteListener[] = [];

  constructor() {
    window.addEventListener("hashchange", () => this.parseAndDispatch());
  }

  private parseAndDispatch(): void {
    const raw = window.location.hash.replace(/^#/, "") || "/";
    const next = VALID_ROUTES[raw] ?? "menu";
    if (next === this.current) return;
    const old = this.current;
    this.current = next;
    for (const fn of this.listeners) fn(next, old);
  }

  /** 启动时调用一次，把初始 hash 同步进状态 */
  init(): Route {
    this.parseAndDispatch();
    return this.current;
  }

  /** 订阅路由变化 */
  subscribe(fn: RouteListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  /** 编程式跳转 */
  go(route: Route): void {
    const hash = route === "menu" ? "#/" : `#/${route}`;
    if (window.location.hash === hash) {
      // 已经在这个路由了，手动触发一次（比如从主菜单又点新游戏，需要刷新）
      this.parseAndDispatch();
    } else {
      window.location.hash = hash;
    }
  }

  /** 当前路由 */
  get(): Route {
    return this.current;
  }
}

export const router = new Router();
