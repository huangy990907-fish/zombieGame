/**
 * 极简 hash 路由 —— 六个页面：主菜单 / 选关 / 战斗 / 训练场 / 工坊编辑器 / 数值调参。
 * URL 形如：#/ 或 #/menu → 主菜单；#/levels → 选关；
 * #/play → 战斗；#/training → 训练场；#/workshop → 工坊编辑器；
 * #/tuning → 数值调参（开发者专属）。
 * 所有页面共享同一个 PixiJS renderer，只是用 CSS 控制哪个显隐。
 */

export type Route = "menu" | "levels" | "play" | "training" | "workshop" | "survival" | "tuning";

const VALID_ROUTES: Record<string, Route> = {
  "": "menu",
  "/": "menu",
  "/menu": "menu",
  "/levels": "levels",
  "/levels/edit": "levels",
  "/play": "play",
  "/training": "training",
  "/workshop": "workshop",
  "/survival": "survival",
  "/tuning": "tuning",
};

export type RouteListener = (route: Route, old: Route) => void;

class Router {
  private current: Route = "menu";
  private lastHash = "";
  private listeners: RouteListener[] = [];

  constructor() {
    window.addEventListener("hashchange", () => this.parseAndDispatch());
  }

  /** 去掉 hash 里的查询串：`#/play?level=x` → `/play` */
  private pathOf(): string {
    const raw = window.location.hash.replace(/^#/, "") || "/";
    return raw.split("?")[0] || "/";
  }

  private parseAndDispatch(force = false): void {
    const hash = window.location.hash;
    const next = VALID_ROUTES[this.pathOf()] ?? "menu";
    // 同路由但查询串变化（如 #/play?level=a → b）也要重新应用
    if (!force && next === this.current && hash === this.lastHash) return;
    const old = this.current;
    this.current = next;
    this.lastHash = hash;
    for (const fn of this.listeners) fn(next, old);
  }

  /** 读取当前 hash 查询串（`#/play?level=level-1` → level-1） */
  getQuery(name: string): string | undefined {
    const raw = window.location.hash.replace(/^#/, "");
    const q = raw.indexOf("?");
    if (q < 0) return undefined;
    const params = new URLSearchParams(raw.slice(q + 1));
    return params.get(name) ?? undefined;
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

  /** 编程式跳转；query 会拼进 hash（如 `#/play?level=level-1`） */
  go(route: Route, query?: Record<string, string>): void {
    let hash = route === "menu" ? "#/" : `#/${route}`;
    if (query && Object.keys(query).length > 0) {
      hash += `?${new URLSearchParams(query).toString()}`;
    }
    if (window.location.hash === hash) {
      // 已经在这个路由了，手动触发一次（比如从主菜单又点新游戏，需要刷新）
      this.parseAndDispatch(true);
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
