/**
 * 工坊画布 —— 74×45 格的俯视瓦片编辑器。
 *
 * 只负责「把文档画出来 + 处理鼠标输入」：
 *  - 滚轮以光标为中心缩放，右键 / 中键 / 空格 + 左键拖拽平移
 *  - 瓦片画笔支持连续拖动；门窗与区域画笔按拖拽矩形提交
 *  - 历史快照在页面层可见（撤销 / 重做按钮），这里只维护快照栈
 *  - 不参与校验与存档，校验结果由页面通过 setErrorMarkers() 注入
 */
import {
  GRID_COLS,
  GRID_ROWS,
  MAP_HEIGHT,
  MAP_WIDTH,
  TILE_SIZE,
} from "../data/maps/schema";
import type { OpeningJson, TileRect } from "../data/maps/schema";
import {
  TILE_CODES,
  TILE_NAMES,
  createBlankDoc,
  dragRect,
  getTile,
  isInside,
  lineRect,
  nextOpeningId,
  openingAt,
  removeOpeningAt,
  removeOpeningsInRect,
  serializeDoc,
  deserializeDoc,
  setTile,
  zoneAt,
  zoneList,
  type OpeningDefaults,
  type TileCode,
  type WorkshopDoc,
  OPENING_DEFAULTS,
} from "./doc";

export type EditorTool = "empty" | "wall" | "door" | "window" | "human" | "spawn" | "erase";

/** 区域选中引用：kind + 数组下标 */
export interface ZoneRef {
  kind: "human" | "spawn";
  index: number;
}

export interface HoverInfo {
  x: number;
  y: number;
  tile: TileCode;
  tileName: string;
  openingId?: string;
  inHumanZone: boolean;
  inSpawnZone: boolean;
}

export interface OpeningPreview {
  kind: "door" | "window";
  /** 净宽（像素），门窗厚度始终 1 格 */
  widthPx: number;
  /** 占用的格数 */
  tiles: number;
  maxHp: number;
  passSpeed: number;
  horizontal: boolean;
}

export interface ErrorMarker {
  x: number;
  y: number;
  message: string;
}

export interface EditorHooks {
  onDocChange(): void;
  onHover(info: HoverInfo | null): void;
  onZoom(zoom: number): void;
  onPreview(preview: OpeningPreview | null): void;
  /** 区域选中变化（画布点选 / 列表点选 / 删除后都会回调） */
  onZoneSelect?(zone: ZoneRef | null): void;
}

const COLORS = {
  background: "#07070e",
  wall: "#332d4d",
  wallEdge: "#4b4370",
  door: "#8a6a20",
  doorEdge: "#c9a227",
  window: "#2b6a96",
  windowEdge: "#5aa9dc",
  grid: "rgba(255, 255, 255, 0.05)",
  humanFill: "rgba(74, 222, 128, 0.10)",
  humanStroke: "rgba(74, 222, 128, 0.55)",
  spawnFill: "rgba(239, 68, 68, 0.10)",
  spawnStroke: "rgba(239, 68, 68, 0.55)",
  winSpawnFill: "rgba(251, 146, 60, 0.10)",
  winSpawnStroke: "rgba(251, 146, 60, 0.55)",
  hover: "rgba(255, 255, 255, 0.75)",
  errorFill: "rgba(239, 68, 68, 0.16)",
  errorStroke: "rgba(248, 113, 113, 0.95)",
  flash: "rgba(255, 225, 77, 0.9)",
  selected: "rgba(255, 225, 77, 0.85)",
} as const;

const MIN_ZOOM = 0.22;
const MAX_ZOOM = 3;

function clampZoom(z: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));
}

interface PointerCell {
  x: number;
  y: number;
}

type Mode = "idle" | "paint" | "pan" | "dragOpening" | "dragZone" | "moveZone";

export class WorkshopEditor {
  private readonly canvas: HTMLCanvasElement;
  private readonly minimap: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly miniCtx: CanvasRenderingContext2D;
  private readonly hooks: EditorHooks;

  private doc: WorkshopDoc = createBlankDoc();
  private tool: EditorTool = "wall";
  private openingDefaults: OpeningDefaults = { ...OPENING_DEFAULTS };

  private camera = { zoom: 0.9, x: 0, y: 0 };
  private cssW = 0;
  private cssH = 0;
  private hasLayout = false;

  private mode: Mode = "idle";
  private hover: PointerCell | null = null;
  private pointerStart: PointerCell | null = null;
  private pointerCurrent: PointerCell | null = null;
  private panStart = { x: 0, y: 0, camX: 0, camY: 0 };
  private spaceDown = false;
  private active = false;

  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private opSnapshot: string | null = null;

  private errorMarkers: ErrorMarker[] = [];
  private selectedOpening: string | null = null;
  private selectedZone: ZoneRef | null = null;
  private zoneDrag: { kind: "human" | "spawn"; index: number; startX: number; startY: number; rect: TileRect } | null =
    null;
  private flashCell: PointerCell | null = null;
  private flashTimer = 0;

  constructor(
    canvas: HTMLCanvasElement,
    minimap: HTMLCanvasElement,
    hooks: EditorHooks,
  ) {
    this.canvas = canvas;
    this.minimap = minimap;
    this.hooks = hooks;
    const ctx = canvas.getContext("2d");
    const miniCtx = minimap.getContext("2d");
    if (!ctx || !miniCtx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    this.miniCtx = miniCtx;

    this.bindPointer();
    this.bindWheel();
    this.bindKeys();

    const observer = new ResizeObserver(() => this.resize());
    observer.observe(canvas);
  }

  // ============================================================
  // 对外接口
  // ============================================================

  getDoc(): WorkshopDoc {
    return this.doc;
  }

  replaceDoc(doc: WorkshopDoc, fitView = false): void {
    this.doc = doc;
    this.selectedOpening = null;
    this.selectedZone = null;
    this.hooks.onZoneSelect?.(null);
    this.undoStack = [];
    this.redoStack = [];
    this.opSnapshot = null;
    if (fitView) this.fit();
    this.redraw();
    this.hooks.onDocChange();
  }

  setTool(tool: EditorTool): void {
    this.tool = tool;
    this.cancelDrag(true);
  }

  getTool(): EditorTool {
    return this.tool;
  }

  setOpeningDefaults(defaults: OpeningDefaults): void {
    this.openingDefaults = { ...defaults };
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.spaceDown = false;
      this.cancelDrag(false);
    }
  }

  setSelectedOpening(id: string | null): void {
    this.selectedOpening = id;
    if (id) this.selectedZone = null;
    this.redraw();
  }

  /** 选中某块区域；门窗与区域选中互斥 */
  setSelectedZone(zone: ZoneRef | null): void {
    if (zone) {
      const list = zoneList(this.doc, zone.kind);
      if (zone.index < 0 || zone.index >= list.length) return;
      this.selectedOpening = null;
    }
    this.selectedZone = zone;
    this.hooks.onZoneSelect?.(zone);
    this.redraw();
  }

  getSelectedZone(): ZoneRef | null {
    return this.selectedZone;
  }

  /** 删除一块区域（走历史栈）；下标会自动修正选中项 */
  removeZone(kind: "human" | "spawn", index: number): void {
    const list = zoneList(this.doc, kind);
    if (index < 0 || index >= list.length) return;
    this.beginOp();
    list.splice(index, 1);
    const selected = this.selectedZone;
    if (selected && selected.kind === kind) {
      if (selected.index === index) this.selectedZone = null;
      else if (selected.index > index) selected.index--;
    }
    this.hooks.onZoneSelect?.(this.selectedZone);
    this.endOp();
  }

  /** Delete / Backspace：删除当前选中的区域或门窗 */
  private deleteSelection(): void {
    if (this.selectedZone) {
      const { kind, index } = this.selectedZone;
      this.removeZone(kind, index);
      return;
    }
    if (this.selectedOpening) this.removeOpening(this.selectedOpening);
  }

  setErrorMarkers(markers: ErrorMarker[]): void {
    this.errorMarkers = markers;
    this.redraw();
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) return;
    this.redoStack.push(serializeDoc(this.doc));
    this.restore(snapshot);
  }

  redo(): void {
    const snapshot = this.redoStack.pop();
    if (!snapshot) return;
    this.undoStack.push(serializeDoc(this.doc));
    this.restore(snapshot);
  }

  /** 清空内容但保留 id / 名称 / 默认参数 */
  clearAll(): void {
    this.beginOp();
    this.doc.tiles.fill(TILE_CODES.empty);
    this.doc.openings = [];
    this.doc.humanZones = [];
    this.doc.spawnZones = [];
    this.doc.windowSpawn = { top: null, bottom: null };
    this.selectedOpening = null;
    this.selectedZone = null;
    this.hooks.onZoneSelect?.(null);
    this.endOp();
  }

  /** 删除一扇门窗并把瓦片还原成墙（走历史栈） */
  removeOpening(id: string): void {
    const opening = this.doc.openings.find((o) => o.id === id);
    if (!opening) return;
    this.beginOp();
    this.removeOpeningInternal(opening);
    if (this.selectedOpening === id) this.selectedOpening = null;
    this.endOp();
  }

  /** 清除某一类的全部区域（走历史栈） */
  clearZone(kind: "human" | "spawn"): void {
    const list = zoneList(this.doc, kind);
    if (list.length === 0) return;
    this.beginOp();
    list.length = 0;
    if (this.selectedZone?.kind === kind) this.selectedZone = null;
    this.hooks.onZoneSelect?.(this.selectedZone);
    this.endOp();
  }

  private removeOpeningInternal(opening: OpeningJson): void {
    const index = this.doc.openings.findIndex((o) => o.id === opening.id);
    if (index < 0) return;
    this.doc.openings.splice(index, 1);
    for (let y = opening.y; y < opening.y + opening.h; y++) {
      for (let x = opening.x; x < opening.x + opening.w; x++) {
        setTile(this.doc, x, y, TILE_CODES.wall);
      }
    }
  }

  /** 把视角居中到某一格，并高亮 1.6 秒（校验错误跳转用） */
  focusCell(x: number, y: number): void {
    const scale = TILE_SIZE * this.camera.zoom;
    this.camera.x = this.cssW / 2 - (x + 0.5) * scale;
    this.camera.y = this.cssH / 2 - (y + 0.5) * scale;
    this.flashCell = { x: Math.round(x), y: Math.round(y) };
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flashCell = null;
      this.redraw();
    }, 1600);
    this.redraw();
  }

  /** 激活 / 容器尺寸变化后调用；forceFit 用于首次进入 */
  refreshLayout(forceFit = false): void {
    this.resize(forceFit);
  }

  getZoom(): number {
    return this.camera.zoom;
  }

  fit(): void {
    if (this.cssW <= 0 || this.cssH <= 0) return;
    const zoom = clampZoom(Math.min((this.cssW - 24) / MAP_WIDTH, (this.cssH - 24) / MAP_HEIGHT));
    this.camera.zoom = zoom;
    const scale = TILE_SIZE * zoom;
    this.camera.x = (this.cssW - GRID_COLS * scale) / 2;
    this.camera.y = (this.cssH - GRID_ROWS * scale) / 2;
    this.hooks.onZoom(zoom);
    this.redraw();
  }

  // ============================================================
  // 输入
  // ============================================================

  private bindKeys(): void {
    window.addEventListener("keydown", (e) => {
      if (!this.active) return;
      const target = e.target;
      if (target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(target.tagName)) return;

      if (e.code === "Space") {
        this.spaceDown = true;
        e.preventDefault();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) this.redo();
        else this.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        this.redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        if (!this.selectedZone && !this.selectedOpening) return;
        e.preventDefault();
        this.deleteSelection();
      }
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === "Space") this.spaceDown = false;
    });
    window.addEventListener("blur", () => {
      this.spaceDown = false;
    });
  }

  private bindWheel(): void {
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const next = clampZoom(this.camera.zoom * factor);
        const ratio = next / this.camera.zoom;
        this.camera.x = sx - (sx - this.camera.x) * ratio;
        this.camera.y = sy - (sy - this.camera.y) * ratio;
        this.camera.zoom = next;
        this.hooks.onZoom(next);
        this.redraw();
      },
      { passive: false },
    );
  }

  private capturePointer(pointerId: number): void {
    // 真实鼠标一定成功；合成事件 / 已释放的指针会抛 NotFoundError，忽略即可
    try {
      this.canvas.setPointerCapture(pointerId);
    } catch {
      /* noop */
    }
  }

  private bindPointer(): void {
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    this.canvas.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      const cell = this.cellFromEvent(e);
      if (!cell) return;

      if (e.button === 1 || e.button === 2 || (e.button === 0 && this.spaceDown)) {
        e.preventDefault();
        this.mode = "pan";
        this.panStart = { x: e.clientX, y: e.clientY, camX: this.camera.x, camY: this.camera.y };
        this.capturePointer(e.pointerId);
        return;
      }
      if (e.button !== 0) return;

      this.capturePointer(e.pointerId);
      this.pointerStart = cell;
      this.pointerCurrent = cell;

      if (this.tool === "door" || this.tool === "window") {
        this.mode = "dragOpening";
        this.beginOp();
        this.updateOpeningPreview();
      } else if (this.tool === "human" || this.tool === "spawn") {
        const kind = this.tool;
        const hit = zoneAt(this.doc, kind, cell.x, cell.y);
        if (hit >= 0) {
          // 点在已有区域上：选中并进入拖动调整（新增区域从空白处开始拖）
          this.setSelectedZone({ kind, index: hit });
          const rect = zoneList(this.doc, kind)[hit];
          this.zoneDrag = {
            kind,
            index: hit,
            startX: cell.x,
            startY: cell.y,
            rect: { ...rect },
          };
          this.mode = "moveZone";
          this.beginOp();
        } else {
          this.setSelectedZone(null);
          this.mode = "dragZone";
          this.beginOp();
        }
      } else {
        this.mode = "paint";
        this.beginOp();
        this.paintAt(cell.x, cell.y);
      }
      this.redraw();
    });

    this.canvas.addEventListener("pointermove", (e) => {
      const cell = this.cellFromEvent(e);
      if (cell) {
        const changed = !this.hover || this.hover.x !== cell.x || this.hover.y !== cell.y;
        this.hover = cell;
        this.pointerCurrent = cell;
        if (changed) this.hooks.onHover(this.describeCell(cell));
      }

      if (this.mode === "pan") {
        this.camera.x = this.panStart.camX + (e.clientX - this.panStart.x);
        this.camera.y = this.panStart.camY + (e.clientY - this.panStart.y);
        this.redraw();
        return;
      }
      if (this.mode === "paint" && cell) {
        this.paintAt(cell.x, cell.y);
        this.redraw();
        return;
      }
      if (this.mode === "dragOpening") {
        this.updateOpeningPreview();
        this.redraw();
        return;
      }
      if (this.mode === "dragZone") {
        this.redraw();
      } else if (this.mode === "moveZone" && this.zoneDrag && cell) {
        const dx = cell.x - this.zoneDrag.startX;
        const dy = cell.y - this.zoneDrag.startY;
        const rect = this.zoneDrag.rect;
        const target = zoneList(this.doc, this.zoneDrag.kind)[this.zoneDrag.index];
        if (target) {
          target.x = Math.max(0, Math.min(GRID_COLS - rect.w, rect.x + dx));
          target.y = Math.max(0, Math.min(GRID_ROWS - rect.h, rect.y + dy));
        }
        this.redraw();
      } else if (cell) {
        this.redraw(); // 仅悬停高亮
      }
    });

    const finish = (): void => {
      if (this.mode === "paint") {
        this.endOp();
      } else if (this.mode === "dragOpening") {
        this.commitOpening();
        this.endOp();
        this.hooks.onPreview(null);
      } else if (this.mode === "dragZone") {
        this.commitZone();
        this.endOp();
      } else if (this.mode === "moveZone") {
        this.endOp();
      }
      this.mode = "idle";
      this.zoneDrag = null;
      this.pointerStart = null;
      this.pointerCurrent = null;
      this.redraw();
    };
    this.canvas.addEventListener("pointerup", finish);
    this.canvas.addEventListener("pointercancel", () => {
      if (
        this.mode === "paint" ||
        this.mode === "dragOpening" ||
        this.mode === "dragZone" ||
        this.mode === "moveZone"
      ) {
        this.cancelDrag(true);
      }
      this.mode = "idle";
      this.zoneDrag = null;
      this.panStart = { x: 0, y: 0, camX: 0, camY: 0 };
      this.hooks.onPreview(null);
      this.redraw();
    });

    this.canvas.addEventListener("pointerleave", () => {
      if (this.mode === "idle") {
        this.hover = null;
        this.hooks.onHover(null);
        this.redraw();
      }
    });
  }

  /** 取消当前拖拽：restore=true 时回滚到按下前快照 */
  private cancelDrag(restore: boolean): void {
    if (restore && this.opSnapshot) {
      const doc = deserializeDoc(this.opSnapshot);
      if (doc) this.doc = doc;
    }
    this.opSnapshot = null;
    this.zoneDrag = null;
    this.pointerStart = null;
    this.pointerCurrent = null;
    this.hooks.onPreview(null);
  }

  private cellFromEvent(e: PointerEvent): PointerCell | null {
    const rect = this.canvas.getBoundingClientRect();
    const scale = TILE_SIZE * this.camera.zoom;
    const x = Math.floor((e.clientX - rect.left - this.camera.x) / scale);
    const y = Math.floor((e.clientY - rect.top - this.camera.y) / scale);
    if (x < -1 || y < -1 || x > GRID_COLS || y > GRID_ROWS) return null;
    return { x, y };
  }

  private clampCell(cell: PointerCell): PointerCell {
    return {
      x: Math.max(0, Math.min(GRID_COLS - 1, cell.x)),
      y: Math.max(0, Math.min(GRID_ROWS - 1, cell.y)),
    };
  }

  private describeCell(cell: PointerCell): HoverInfo | null {
    if (!isInside(cell.x, cell.y)) return null;
    const tile = getTile(this.doc, cell.x, cell.y);
    const opening = openingAt(this.doc, cell.x, cell.y);
    const inHumanZone = this.doc.humanZones.some((zone) =>
      cell.x >= zone.x &&
      cell.y >= zone.y &&
      cell.x < zone.x + zone.w &&
      cell.y < zone.y + zone.h,
    );
    const inSpawnZone = this.doc.spawnZones.some((zone) =>
      cell.x >= zone.x &&
      cell.y >= zone.y &&
      cell.x < zone.x + zone.w &&
      cell.y < zone.y + zone.h,
    );
    return {
      x: cell.x,
      y: cell.y,
      tile,
      tileName: TILE_NAMES[tile],
      openingId: opening?.id,
      inHumanZone,
      inSpawnZone,
    };
  }

  // ============================================================
  // 编辑操作
  // ============================================================

  private beginOp(): void {
    this.opSnapshot = serializeDoc(this.doc);
  }

  private endOp(): void {
    const before = this.opSnapshot;
    this.opSnapshot = null;
    if (!before) return;
    const after = serializeDoc(this.doc);
    if (after === before) return;
    this.undoStack.push(before);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
    this.hooks.onDocChange();
  }

  private restore(snapshot: string): void {
    const doc = deserializeDoc(snapshot);
    if (!doc) return;
    this.doc = doc;
    this.selectedOpening = null;
    this.selectedZone = null;
    this.hooks.onZoneSelect?.(null);
    this.redraw();
    this.hooks.onDocChange();
  }

  private paintAt(x: number, y: number): void {
    if (!isInside(x, y)) return;
    const current = getTile(this.doc, x, y);

    if (this.tool === "empty") {
      removeOpeningAt(this.doc, x, y, TILE_CODES.empty);
      if (current !== TILE_CODES.empty) setTile(this.doc, x, y, TILE_CODES.empty);
      return;
    }
    if (this.tool === "wall") {
      removeOpeningAt(this.doc, x, y, TILE_CODES.wall);
      if (current !== TILE_CODES.wall) setTile(this.doc, x, y, TILE_CODES.wall);
      return;
    }
    if (this.tool === "erase") {
      // 擦门窗恢复成墙，擦墙 / 空地清成空地
      if (removeOpeningAt(this.doc, x, y, TILE_CODES.wall)) return;
      if (current !== TILE_CODES.empty) setTile(this.doc, x, y, TILE_CODES.empty);
    }
  }

  private currentLineRect(): TileRect | null {
    if (!this.pointerStart || !this.pointerCurrent) return null;
    const start = this.clampCell(this.pointerStart);
    const end = this.clampCell(this.pointerCurrent);
    return lineRect(start.x, start.y, end.x, end.y);
  }

  private currentZoneRect(): TileRect | null {
    if (!this.pointerStart || !this.pointerCurrent) return null;
    const start = this.clampCell(this.pointerStart);
    const end = this.clampCell(this.pointerCurrent);
    return dragRect(start.x, start.y, end.x, end.y);
  }

  private updateOpeningPreview(): void {
    if (this.tool !== "door" && this.tool !== "window") return;
    const rect = this.currentLineRect();
    if (!rect) return;
    const horizontal = rect.w >= rect.h;
    const tiles = horizontal ? rect.w : rect.h;
    const defaults =
      this.tool === "door"
        ? { hp: this.openingDefaults.doorHp, pass: this.openingDefaults.doorPass }
        : { hp: this.openingDefaults.windowHp, pass: this.openingDefaults.windowPass };
    this.hooks.onPreview({
      kind: this.tool,
      tiles,
      widthPx: tiles * TILE_SIZE,
      maxHp: defaults.hp,
      passSpeed: defaults.pass,
      horizontal,
    });
  }

  private commitOpening(): void {
    if (this.tool !== "door" && this.tool !== "window") return;
    const rect = this.currentLineRect();
    if (!rect) return;

    const kind = this.tool;
    const defaults =
      kind === "door"
        ? { hp: this.openingDefaults.doorHp, pass: this.openingDefaults.doorPass }
        : { hp: this.openingDefaults.windowHp, pass: this.openingDefaults.windowPass };

    removeOpeningsInRect(this.doc, rect, TILE_CODES.wall);

    const opening: OpeningJson = {
      id: nextOpeningId(this.doc, kind),
      kind,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      maxHp: defaults.hp,
      passSpeed: defaults.pass,
    };
    this.doc.openings.push(opening);
    const code = kind === "door" ? TILE_CODES.door : TILE_CODES.window;
    for (let y = rect.y; y < rect.y + rect.h; y++) {
      for (let x = rect.x; x < rect.x + rect.w; x++) {
        setTile(this.doc, x, y, code);
      }
    }
    this.selectedOpening = opening.id;
  }

  private commitZone(): void {
    if (this.tool !== "human" && this.tool !== "spawn") return;
    const rect = this.currentZoneRect();
    if (!rect) return;
    const list = this.tool === "human" ? this.doc.humanZones : this.doc.spawnZones;
    list.push(rect);
    this.setSelectedZone({ kind: this.tool, index: list.length - 1 });
  }

  // ============================================================
  // 渲染
  // ============================================================

  private resize(forceFit = false): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w <= 0 || h <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    this.cssW = w;
    this.cssH = h;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
    }
    const miniW = this.minimap.clientWidth;
    const miniH = this.minimap.clientHeight;
    if (miniW > 0 && miniH > 0) {
      if (
        this.minimap.width !== Math.round(miniW * dpr) ||
        this.minimap.height !== Math.round(miniH * dpr)
      ) {
        this.minimap.width = Math.round(miniW * dpr);
        this.minimap.height = Math.round(miniH * dpr);
      }
    }

    if (forceFit || !this.hasLayout) {
      this.hasLayout = true;
      this.fit();
    } else {
      this.redraw();
    }
  }

  private redraw(): void {
    if (this.cssW <= 0 || this.cssH <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, this.cssW, this.cssH);

    const scale = TILE_SIZE * this.camera.zoom;
    const ox = this.camera.x;
    const oy = this.camera.y;

    const x0 = Math.max(0, Math.floor(-ox / scale));
    const y0 = Math.max(0, Math.floor(-oy / scale));
    const x1 = Math.min(GRID_COLS - 1, Math.ceil((this.cssW - ox) / scale));
    const y1 = Math.min(GRID_ROWS - 1, Math.ceil((this.cssH - oy) / scale));

    // ===== 瓦片 =====
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const code = getTile(this.doc, x, y);
        if (code === TILE_CODES.empty) continue;
        const sx = ox + x * scale;
        const sy = oy + y * scale;
        const size = scale + 0.4;

        if (code === TILE_CODES.wall) {
          ctx.fillStyle = COLORS.wall;
          ctx.fillRect(sx, sy, size, size);
          if (scale >= 8) {
            ctx.fillStyle = COLORS.wallEdge;
            ctx.fillRect(sx, sy, size, Math.min(2, scale * 0.12));
          }
        } else if (code === TILE_CODES.door) {
          ctx.fillStyle = COLORS.door;
          ctx.fillRect(sx, sy, size, size);
          if (scale >= 8) {
            ctx.fillStyle = COLORS.doorEdge;
            ctx.fillRect(sx, sy, size, Math.min(2, scale * 0.12));
          }
        } else {
          ctx.fillStyle = COLORS.window;
          ctx.fillRect(sx, sy, size, size);
          if (scale >= 8) {
            ctx.fillStyle = COLORS.windowEdge;
            ctx.fillRect(sx, sy, size, Math.min(2, scale * 0.12));
          }
        }
      }
    }

    // ===== 区域 =====
    const drawZone = (rect: TileRect | null, fill: string, stroke: string, label: string): void => {
      if (!rect) return;
      const sx = ox + rect.x * scale;
      const sy = oy + rect.y * scale;
      const sw = rect.w * scale;
      const sh = rect.h * scale;
      ctx.fillStyle = fill;
      ctx.fillRect(sx, sy, sw, sh);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(sx + 0.75, sy + 0.75, sw - 1.5, sh - 1.5);
      ctx.setLineDash([]);
      if (scale >= 5) {
        ctx.fillStyle = stroke;
        ctx.font = "11px Menlo, monospace";
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        ctx.fillText(label, sx + 4, sy + 3);
      }
    };
    const drawZoneList = (
      list: TileRect[],
      fill: string,
      stroke: string,
      label: string,
    ): void => {
      list.forEach((rect, index) => drawZone(rect, fill, stroke, `${label} ${index + 1}`));
    };
    drawZoneList(this.doc.humanZones, COLORS.humanFill, COLORS.humanStroke, "人类区");
    drawZoneList(this.doc.spawnZones, COLORS.spawnFill, COLORS.spawnStroke, "僵尸区");
    drawZone(
      this.doc.windowSpawn.top,
      COLORS.winSpawnFill,
      COLORS.winSpawnStroke,
      "上窗出生",
    );
    drawZone(
      this.doc.windowSpawn.bottom,
      COLORS.winSpawnFill,
      COLORS.winSpawnStroke,
      "下窗出生",
    );

    // ===== 网格 =====
    if (scale >= 6) {
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = x0; x <= x1 + 1; x++) {
        const sx = Math.round(ox + x * scale) + 0.5;
        ctx.moveTo(sx, oy + y0 * scale);
        ctx.lineTo(sx, oy + (y1 + 1) * scale);
      }
      for (let y = y0; y <= y1 + 1; y++) {
        const sy = Math.round(oy + y * scale) + 0.5;
        ctx.moveTo(ox + x0 * scale, sy);
        ctx.lineTo(ox + (x1 + 1) * scale, sy);
      }
      ctx.stroke();
    }

    // ===== 选中开口 =====
    if (this.selectedOpening) {
      const opening = this.doc.openings.find((o) => o.id === this.selectedOpening);
      if (opening) {
        const sx = ox + opening.x * scale;
        const sy = oy + opening.y * scale;
        ctx.strokeStyle = COLORS.selected;
        ctx.lineWidth = 2;
        ctx.strokeRect(sx + 1, sy + 1, opening.w * scale - 2, opening.h * scale - 2);
      }
    }

    // ===== 选中区域 =====
    if (this.selectedZone) {
      const rect = zoneList(this.doc, this.selectedZone.kind)[this.selectedZone.index];
      if (rect) {
        const sx = ox + rect.x * scale;
        const sy = oy + rect.y * scale;
        ctx.strokeStyle = COLORS.selected;
        ctx.lineWidth = 2;
        ctx.strokeRect(sx + 1, sy + 1, rect.w * scale - 2, rect.h * scale - 2);
      }
    }

    // ===== 拖拽预览 =====
    if (this.mode === "dragOpening") {
      const rect = this.currentLineRect();
      if (rect) {
        const sx = ox + rect.x * scale;
        const sy = oy + rect.y * scale;
        const color = this.tool === "door" ? COLORS.door : COLORS.window;
        const edge = this.tool === "door" ? COLORS.doorEdge : COLORS.windowEdge;
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = color;
        ctx.fillRect(sx, sy, rect.w * scale, rect.h * scale);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = edge;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(sx + 1, sy + 1, rect.w * scale - 2, rect.h * scale - 2);
        ctx.setLineDash([]);
        const horizontal = rect.w >= rect.h;
        const tiles = horizontal ? rect.w : rect.h;
        this.drawLabel(`${tiles * TILE_SIZE}px`, sx + rect.w * scale * 0.5, sy - 8, edge);
      }
    } else if (this.mode === "dragZone") {
      const rect = this.currentZoneRect();
      if (rect) {
        const human = this.tool === "human";
        const sx = ox + rect.x * scale;
        const sy = oy + rect.y * scale;
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = human ? COLORS.humanStroke : COLORS.spawnStroke;
        ctx.fillRect(sx, sy, rect.w * scale, rect.h * scale);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = human ? COLORS.humanStroke : COLORS.spawnStroke;
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(sx + 1, sy + 1, rect.w * scale - 2, rect.h * scale - 2);
        ctx.setLineDash([]);
        this.drawLabel(
          `${rect.w} × ${rect.h} 格`,
          sx + rect.w * scale * 0.5,
          sy - 8,
          human ? COLORS.humanStroke : COLORS.spawnStroke,
        );
      }
    }

    // ===== 校验错误 =====
    for (const marker of this.errorMarkers) {
      const sx = ox + marker.x * scale;
      const sy = oy + marker.y * scale;
      ctx.fillStyle = COLORS.errorFill;
      ctx.fillRect(sx, sy, scale, scale);
      ctx.strokeStyle = COLORS.errorStroke;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx + 0.75, sy + 0.75, scale - 1.5, scale - 1.5);
    }

    // ===== 错误跳转高亮 =====
    if (this.flashCell) {
      const sx = ox + this.flashCell.x * scale;
      const sy = oy + this.flashCell.y * scale;
      ctx.strokeStyle = COLORS.flash;
      ctx.lineWidth = 3;
      ctx.strokeRect(sx + 1.5, sy + 1.5, scale - 3, scale - 3);
    }

    // ===== 悬停格 =====
    if (this.hover && isInside(this.hover.x, this.hover.y)) {
      const sx = ox + this.hover.x * scale;
      const sy = oy + this.hover.y * scale;
      ctx.strokeStyle = COLORS.hover;
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, sy + 0.5, scale - 1, scale - 1);
    }

    this.drawMinimap();
  }

  private drawLabel(text: string, cx: number, cy: number, color: string): void {
    const ctx = this.ctx;
    ctx.font = "11px Menlo, monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    const width = ctx.measureText(text).width + 8;
    ctx.fillStyle = "rgba(7, 7, 14, 0.85)";
    ctx.fillRect(cx - width / 2, cy - 14, width, 14);
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy - 2);
  }

  private drawMinimap(): void {
    const mini = this.minimap;
    const w = mini.clientWidth;
    const h = mini.clientHeight;
    if (w <= 0 || h <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.miniCtx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, w, h);

    const cell = Math.min(w / GRID_COLS, h / GRID_ROWS);
    const offsetX = (w - cell * GRID_COLS) / 2;
    const offsetY = (h - cell * GRID_ROWS) / 2;

    for (let y = 0; y < GRID_ROWS; y++) {
      for (let x = 0; x < GRID_COLS; x++) {
        const code = getTile(this.doc, x, y);
        if (code === TILE_CODES.empty) continue;
        ctx.fillStyle =
          code === TILE_CODES.wall
            ? COLORS.wall
            : code === TILE_CODES.door
              ? COLORS.doorEdge
              : COLORS.windowEdge;
        ctx.fillRect(offsetX + x * cell, offsetY + y * cell, cell + 0.5, cell + 0.5);
      }
    }

    const zone = (rect: TileRect | null, fill: string, stroke: string): void => {
      if (!rect) return;
      ctx.fillStyle = fill;
      ctx.fillRect(offsetX + rect.x * cell, offsetY + rect.y * cell, rect.w * cell, rect.h * cell);
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.strokeRect(
        offsetX + rect.x * cell + 0.5,
        offsetY + rect.y * cell + 0.5,
        rect.w * cell - 1,
        rect.h * cell - 1,
      );
    };
    zone(this.doc.windowSpawn.top, COLORS.winSpawnFill, COLORS.winSpawnStroke);
    zone(this.doc.windowSpawn.bottom, COLORS.winSpawnFill, COLORS.winSpawnStroke);
    for (const rect of this.doc.humanZones) zone(rect, COLORS.humanFill, COLORS.humanStroke);
    for (const rect of this.doc.spawnZones) zone(rect, COLORS.spawnFill, COLORS.spawnStroke);

    // 当前视口
    const scale = TILE_SIZE * this.camera.zoom;
    const viewX0 = Math.max(0, -this.camera.x / scale);
    const viewY0 = Math.max(0, -this.camera.y / scale);
    const viewX1 = Math.min(GRID_COLS, (this.cssW - this.camera.x) / scale);
    const viewY1 = Math.min(GRID_ROWS, (this.cssH - this.camera.y) / scale);
    if (viewX1 > viewX0 && viewY1 > viewY0) {
      ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        offsetX + viewX0 * cell + 0.5,
        offsetY + viewY0 * cell + 0.5,
        (viewX1 - viewX0) * cell - 1,
        (viewY1 - viewY0) * cell - 1,
      );
    }
  }
}
