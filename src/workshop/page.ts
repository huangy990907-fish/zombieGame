/**
 * 工坊页面 —— 把编辑器、校验、存档 / 导入导出装进一个整页 overlay。
 *
 * 页面只做 DOM 与流程编排，几何与绘制全部在 editor.ts / doc.ts。
 * 入口只有 `#/workshop`，由开发者模式控制显隐（阶段 4）。
 */
import { compileTilesToMapDef } from "../data/maps/compile";
import { isReadOnlyMap } from "../data/maps";
import { validateMapJson } from "../data/maps/schema";
import { TILE_SIZE } from "../data/maps/schema";
import type { MapJson, MapValidationError, TileRect } from "../data/maps/schema";
import { getMapReferences } from "../levels";
import {
  OPENING_DEFAULTS,
  cloneDoc,
  createBlankDoc,
  fromMapJson,
  generateWorkshopId,
  toMapJson,
  toRawJson,
  type OpeningDefaults,
  type WorkshopDoc,
} from "./doc";
import {
  WorkshopEditor,
  type EditorTool,
  type HoverInfo,
  type OpeningPreview,
  type ZoneRef,
} from "./editor";
import {
  WORKSHOP_PREVIEW_MAP_ID,
  loadBuiltinCatalog,
  loadBuiltinMapJson,
  loadWorkshopDraft,
  resetWorkshopCatalog,
  saveWorkshopDraft,
  saveWorkshopPreview,
  type BuiltinMapEntry,
} from "./storage";
import type { DevDeleteInfo } from "./devDelete";

const TOOLS: Array<{ id: EditorTool; label: string; icon: string; hint: string }> = [
  { id: "empty", label: "空地", icon: "·", hint: "把格子清成空地，并移除覆盖它的门窗" },
  { id: "wall", label: "墙", icon: "#", hint: "拖动连续画墙；画在门窗上会把门窗还原成墙" },
  { id: "door", label: "门", icon: "D", hint: "按住拖拽决定宽度（16px 整数倍），门可被胖子穿过" },
  { id: "window", label: "窗", icon: "W", hint: "按住拖拽决定宽度；窗只放行普通 / 狂奔僵尸" },
  { id: "human", label: "人类区", icon: "人", hint: "拖出矩形人类出生区，可放多块；只决定出生点，不限制后续活动" },
  { id: "spawn", label: "僵尸区", icon: "僵", hint: "拖出矩形僵尸出生区，可放多块；必须可通行且不与人类区重叠" },
  { id: "erase", label: "擦除", icon: "✕", hint: "擦门窗时还原成墙；擦墙 / 空地清成空地" },
];

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeFileId(id: string): string {
  const cleaned = id.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
  return cleaned || "map";
}

export class WorkshopPage {
  private readonly root: HTMLElement;
  private readonly editor: WorkshopEditor;

  private readonly nameInput: HTMLInputElement;
  private readonly idTextEl: HTMLElement;
  private readonly readonlyBadge: HTMLElement;
  private readonly undoBtn: HTMLButtonElement;
  private readonly redoBtn: HTMLButtonElement;
  private readonly clearBtn: HTMLButtonElement;
  private readonly hoverEl: HTMLElement;
  private readonly zoomEl: HTMLElement;
  private readonly previewEl: HTMLElement;
  private readonly errorsEl: HTMLElement;
  private readonly errorCountEl: HTMLElement;
  private readonly compileEl: HTMLElement;
  private readonly openingsEl: HTMLElement;
  private readonly zonesEl: HTMLElement;
  private readonly saveStatusEl: HTMLElement;
  private readonly builtinSelect: HTMLSelectElement;
  private readonly toastEl: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly exportBtn: HTMLButtonElement;
  private readonly saveProjectBtn: HTMLButtonElement | null;
  private readonly deleteMapBtn: HTMLButtonElement | null;

  private paletteButtons: HTMLButtonElement[] = [];
  private selectedOpeningId: string | null = null;
  private selectedZone: ZoneRef | null = null;
  private openingDefaults: OpeningDefaults = { ...OPENING_DEFAULTS };
  private builtinCatalog: BuiltinMapEntry[] = [];
  private catalogLoaded = false;
  private hasActivated = false;
  private saveTimer = 0;
  private toastTimer = 0;
  private syncDevDelete: (() => void) | null = null;

  constructor(
    private readonly onBack: () => void,
    /** 保存到项目成功后：由 main.ts 重新加载注册表并刷新训练场下拉（参数是被保存的 id） */
    private readonly onSaved?: (id: string) => void | Promise<void>,
    /** 删除项目地图成功后：由 main.ts 重新加载注册表，必要时把训练场切回 arena */
    private readonly onDeleted?: (id: string) => void | Promise<void>,
  ) {
    const root = document.getElementById("workshopOverlay");
    if (!root) throw new Error("missing element #workshopOverlay");
    this.root = root;

    this.root.innerHTML = `
      <div class="ws-frame">
        <header class="ws-head">
          <button class="back-btn" id="wsBack">← 主菜单</button>
          <div class="ws-head-title">
            <h2>工坊编辑器</h2>
            <span>固定画布 74 × 45 · 16px 一格</span>
          </div>
          <div class="ws-meta">
            <label>名称 <input id="wsName" maxlength="24" spellcheck="false" /></label>
            <span class="ws-idline">id <code id="wsIdText"></code></span>
            <span class="ws-badge hidden" id="wsReadonly">内置只读</span>
          </div>
          <div class="ws-top-actions">
            <button id="wsUndo" title="Ctrl / Cmd + Z">↶ 撤销</button>
            <button id="wsRedo" title="Ctrl / Cmd + Shift + Z">↷ 重做</button>
            <button id="wsClear" class="danger">清空</button>
          </div>
        </header>

        <div class="ws-body">
          <aside class="ws-tools">
            <h3>画笔</h3>
            <div class="ws-palette" id="wsPalette"></div>
            <p class="ws-hint" id="wsToolHint"></p>

            <h3>新门窗默认值</h3>
            <div class="ws-defaults">
              <div class="ws-default-row">
                <span class="ws-default-label door">门</span>
                <label>血量 <input id="wsDoorHp" type="number" min="1" step="1" /></label>
                <label>通行 <input id="wsDoorPass" type="number" min="0.05" max="1" step="0.05" /></label>
              </div>
              <div class="ws-default-row">
                <span class="ws-default-label window">窗</span>
                <label>血量 <input id="wsWindowHp" type="number" min="1" step="1" /></label>
                <label>通行 <input id="wsWindowPass" type="number" min="0.05" max="1" step="0.05" /></label>
              </div>
            </div>
            <p class="ws-hint" id="wsPreview"></p>

            <h3>开口列表</h3>
            <div class="ws-openings" id="wsOpenings"></div>

            <h3>区域（可多块）</h3>
            <div class="ws-zone-actions">
              <button id="wsClearHuman">清除人类区</button>
              <button id="wsClearSpawn">清除僵尸区</button>
            </div>
            <div class="ws-zones" id="wsZones"></div>

            <h3>操作提示</h3>
            <ul class="ws-controls">
              <li>滚轮缩放（以光标为中心）</li>
              <li>右键 / 中键 / 空格 + 左键平移</li>
              <li>左键按下拖动绘制；松手提交一步历史</li>
              <li>Ctrl / Cmd + Z 撤销，Shift 组合重做</li>
            </ul>
          </aside>

          <main class="ws-stage" id="wsStage">
            <canvas id="wsCanvas"></canvas>
            <div class="ws-hud">
              <span id="wsHover">移入画布查看格子</span>
              <span class="ws-hud-right"><b id="wsZoom">90%</b></span>
            </div>
          </main>

          <aside class="ws-side">
            <section class="ws-side-block">
              <h3>小地图</h3>
              <canvas id="wsMinimap" class="ws-minimap"></canvas>
            </section>

            <section class="ws-side-block ws-validate">
              <h3>实时校验 <span class="ws-err-count" id="wsErrCount"></span></h3>
              <ul class="ws-errors" id="wsErrors"></ul>
              <div class="ws-compile" id="wsCompile">尚未编译</div>
            </section>

            <section class="ws-side-block ws-io">
              <h3>草稿 / 地图文件</h3>
              <div class="ws-save-status" id="wsSaveStatus">草稿未保存</div>
              <div class="ws-btn-grid">
                <button id="wsNew">＋ 新建空白</button>
                <button id="wsSaveNow">💾 保存草稿</button>
                <button id="wsCopy">另存为副本</button>
                <button id="wsExport">⬇ 导出 JSON</button>
                <button id="wsImportBtn">⬆ 导入 JSON</button>
                <input type="file" id="wsImportFile" accept="application/json,.json" hidden />
                <button id="wsPlay" class="primary" disabled title="校验通过后可试玩">▶ 用当前图试玩</button>
                <button id="wsSaveProject" class="ws-dev-save" hidden disabled></button>
              </div>
              <div class="ws-builtin">
                <select id="wsBuiltinSelect"><option value="">载入内置图…</option></select>
                <button id="wsLoadBuiltin">载入</button>
              </div>
              <button id="wsDeleteMap" class="ws-dev-delete" hidden disabled></button>
              <p class="ws-hint">
                导出的 JSON 可直接放进 <code>public/maps/</code>，并在 <code>manifest.json</code> 登记；
                试玩会载入训练场，正式选图入口留到阶段 3。
              </p>
            </section>
          </aside>
        </div>

        <div class="ws-toast" id="wsToast"></div>
      </div>
    `;

    this.nameInput = this.query<HTMLInputElement>("#wsName");
    this.idTextEl = this.query<HTMLElement>("#wsIdText");
    this.readonlyBadge = this.query<HTMLElement>("#wsReadonly");
    this.undoBtn = this.query<HTMLButtonElement>("#wsUndo");
    this.redoBtn = this.query<HTMLButtonElement>("#wsRedo");
    this.clearBtn = this.query<HTMLButtonElement>("#wsClear");
    this.hoverEl = this.query<HTMLElement>("#wsHover");
    this.zoomEl = this.query<HTMLElement>("#wsZoom");
    this.previewEl = this.query<HTMLElement>("#wsPreview");
    this.errorsEl = this.query<HTMLElement>("#wsErrors");
    this.errorCountEl = this.query<HTMLElement>("#wsErrCount");
    this.compileEl = this.query<HTMLElement>("#wsCompile");
    this.openingsEl = this.query<HTMLElement>("#wsOpenings");
    this.zonesEl = this.query<HTMLElement>("#wsZones");
    this.saveStatusEl = this.query<HTMLElement>("#wsSaveStatus");
    this.builtinSelect = this.query<HTMLSelectElement>("#wsBuiltinSelect");
    this.toastEl = this.query<HTMLElement>("#wsToast");
    this.playBtn = this.query<HTMLButtonElement>("#wsPlay");
    this.exportBtn = this.query<HTMLButtonElement>("#wsExport");
    this.saveProjectBtn = this.root.querySelector<HTMLButtonElement>("#wsSaveProject");
    this.deleteMapBtn = this.root.querySelector<HTMLButtonElement>("#wsDeleteMap");

    const canvas = this.query<HTMLCanvasElement>("#wsCanvas");
    const minimap = this.query<HTMLCanvasElement>("#wsMinimap");
    this.editor = new WorkshopEditor(canvas, minimap, {
      onDocChange: () => this.handleDocChange(),
      onHover: (info) => this.handleHover(info),
      onZoom: (zoom) => {
        this.zoomEl.textContent = `${Math.round(zoom * 100)}%`;
      },
      onPreview: (preview) => this.handlePreview(preview),
      onZoneSelect: (zone) => {
        this.selectedZone = zone;
        this.refreshZones();
      },
    });

    this.buildPalette();
    this.bindHeader();
    this.bindDefaults();
    this.bindZones();
    this.bindIo();

    const backBtn = this.query<HTMLButtonElement>("#wsBack");
    backBtn.onclick = () => {
      this.saveDraftNow();
      this.onBack();
    };

    window.addEventListener("beforeunload", () => {
      if (this.hasActivated) this.saveDraftNow();
    });

    this.syncMeta();
    this.refreshValidation();
    this.refreshOpenings();
    this.refreshZones();
  }

  private query<T extends HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`missing workshop element ${selector}`);
    return el;
  }

  // ============================================================
  // 生命周期
  // ============================================================

  activate(): void {
    this.root.classList.remove("hidden");
    this.root.classList.add("active");
    this.editor.setActive(true);
    requestAnimationFrame(() => this.editor.refreshLayout(!this.hasActivated));
    this.bindDevSave();
    this.bindDevDelete();

    if (!this.hasActivated) {
      this.hasActivated = true;
      const draft = loadWorkshopDraft();
      if (draft) {
        this.editor.replaceDoc(draft.doc, true);
        this.syncMeta();
        this.refreshValidation();
        this.refreshOpenings();
        this.refreshZones();
        this.saveStatusEl.textContent = this.formatSavedAt(draft.updatedAt);
        this.showToast("已恢复上次的工坊草稿");
      }
    }
    if (!this.catalogLoaded) void this.loadCatalog();
  }

  deactivate(): void {
    this.editor.setActive(false);
    if (this.hasActivated) this.saveDraftNow();
    this.root.classList.remove("active");
    this.root.classList.add("hidden");
  }

  // ============================================================
  // 顶部 / 画笔
  // ============================================================

  private buildPalette(): void {
    const palette = this.query<HTMLElement>("#wsPalette");
    for (const tool of TOOLS) {
      const btn = document.createElement("button");
      btn.className = "ws-tool";
      btn.dataset.tool = tool.id;
      btn.title = tool.hint;
      btn.innerHTML = `<i>${escapeHtml(tool.icon)}</i><span>${escapeHtml(tool.label)}</span>`;
      btn.onclick = () => this.selectTool(tool.id);
      palette.appendChild(btn);
      this.paletteButtons.push(btn);
    }
    this.selectTool("wall");
  }

  private selectTool(tool: EditorTool): void {
    this.editor.setTool(tool);
    for (const btn of this.paletteButtons) {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    }
    const info = TOOLS.find((t) => t.id === tool);
    this.query<HTMLElement>("#wsToolHint").textContent = info?.hint ?? "";
    this.handlePreview(null);
  }

  private bindHeader(): void {
    this.nameInput.addEventListener("input", () => {
      this.editor.getDoc().name = this.nameInput.value;
      this.refreshValidation();
      this.scheduleSave();
    });
    this.undoBtn.onclick = () => {
      this.editor.undo();
      this.refreshOpenings();
      this.refreshZones();
    };
    this.redoBtn.onclick = () => {
      this.editor.redo();
      this.refreshOpenings();
      this.refreshZones();
    };
    this.clearBtn.onclick = () => {
      if (!confirm("清空当前地图内容？门窗、区域与墙体都会消失（可撤销）。")) return;
      this.editor.clearAll();
      this.refreshOpenings();
      this.showToast("已清空，可用撤销恢复");
    };
  }

  private bindDefaults(): void {
    const bind = (
      selector: string,
      field: keyof OpeningDefaults,
      min: number,
      max: number,
      integer: boolean,
    ): void => {
      const input = this.query<HTMLInputElement>(selector);
      input.value = String(this.openingDefaults[field]);
      input.addEventListener("change", () => {
        let value = Number(input.value);
        if (!Number.isFinite(value)) value = this.openingDefaults[field];
        value = Math.max(min, Math.min(max, value));
        if (integer) value = Math.round(value);
        this.openingDefaults[field] = value;
        input.value = String(value);
        this.editor.setOpeningDefaults(this.openingDefaults);
      });
    };
    bind("#wsDoorHp", "doorHp", 1, 100000, true);
    bind("#wsDoorPass", "doorPass", 0.05, 1, false);
    bind("#wsWindowHp", "windowHp", 1, 100000, true);
    bind("#wsWindowPass", "windowPass", 0.05, 1, false);
    this.editor.setOpeningDefaults(this.openingDefaults);
  }

  private bindZones(): void {
    this.query<HTMLButtonElement>("#wsClearHuman").onclick = () => {
      this.editor.clearZone("human");
      this.refreshOpenings();
      this.refreshZones();
      this.showToast("已清除全部人类区");
    };
    this.query<HTMLButtonElement>("#wsClearSpawn").onclick = () => {
      this.editor.clearZone("spawn");
      this.refreshOpenings();
      this.refreshZones();
      this.showToast("已清除全部僵尸区");
    };
  }

  private syncReadonlyState(): void {
    const doc = this.editor.getDoc();
    this.readonlyBadge.classList.toggle("hidden", doc.builtinId === null);
    this.readonlyBadge.textContent = doc.builtinId ? "内置只读 · 请另存为副本" : "";
    const readonly = isReadOnlyMap(doc.id);
    this.exportBtn.disabled = readonly;
    this.exportBtn.title = readonly ? "内置图不能覆盖，请先另存为副本" : "导出为 public/maps 可用的 JSON";
    this.syncDevDeleteState();
  }

  private syncMeta(): void {
    const doc = this.editor.getDoc();
    this.nameInput.value = doc.name;
    this.idTextEl.textContent = doc.id;
    this.syncReadonlyState();
    this.updateHistoryButtons();
  }

  private syncDevDeleteState(): void {
    this.syncDevDelete?.();
  }

  /** 删除入口需要的信息：只允许删 manifest 里 readOnly:false 且未被关卡 / 模式引用的图 */
  private deleteInfo(): DevDeleteInfo {
    const doc = this.editor.getDoc();
    if (!this.catalogLoaded) {
      return { id: doc.id, name: doc.name, canDelete: false, reason: "地图目录尚未加载" };
    }
    const entry = this.builtinCatalog.find((item) => item.id === doc.id);
    if (!entry) {
      return { id: doc.id, name: doc.name, canDelete: false, reason: "当前地图还没有写入项目" };
    }
    if (entry.readOnly) {
      return { id: doc.id, name: entry.name, canDelete: false, reason: "内置地图不可删除" };
    }
    const refs = getMapReferences(doc.id);
    if (refs.length > 0) {
      return {
        id: doc.id,
        name: entry.name,
        canDelete: false,
        reason: `被${refs.map((ref) => ref.label).join("、")}引用`,
      };
    }
    return { id: doc.id, name: entry.name, canDelete: true };
  }

  private updateHistoryButtons(): void {
    this.undoBtn.disabled = !this.editor.canUndo();
    this.redoBtn.disabled = !this.editor.canRedo();
  }

  // ============================================================
  // 文档变化
  // ============================================================

  private handleDocChange(syncInputs = false): void {
    if (syncInputs) this.syncMeta();
    this.updateHistoryButtons();
    this.refreshValidation();
    this.refreshOpenings();
    this.refreshZones();
    this.scheduleSave();
  }

  private handleHover(info: HoverInfo | null): void {
    if (!info) {
      this.hoverEl.textContent = "移入画布查看格子";
      return;
    }
    const tags: string[] = [];
    if (info.openingId) tags.push(`开口 ${info.openingId}`);
    if (info.inHumanZone) tags.push("人类区");
    if (info.inSpawnZone) tags.push("僵尸区");
    this.hoverEl.textContent = `列 ${info.x} · 行 ${info.y} · ${info.tileName}${
      tags.length ? ` · ${tags.join(" / ")}` : ""
    }`;
  }

  private handlePreview(preview: OpeningPreview | null): void {
    if (!preview) {
      this.previewEl.textContent = "拖拽画门 / 窗：净宽按 16px 一格对齐";
      this.previewEl.classList.remove("live");
      return;
    }
    const kind = preview.kind === "door" ? "门" : "窗";
    const orient = preview.horizontal ? "横向" : "纵向";
    this.previewEl.textContent = `${kind} · ${orient} · 净宽 ${preview.widthPx}px（${preview.tiles} 格）· 血量 ${preview.maxHp} · 通行 ${preview.passSpeed.toFixed(2)}`;
    this.previewEl.classList.add("live");
  }

  // ============================================================
  // 校验
  // ============================================================

  private refreshValidation(): void {
    const doc = this.editor.getDoc();
    const errors = this.validationErrors(doc);
    this.errorsEl.innerHTML = "";

    if (errors.length === 0) {
      const li = document.createElement("li");
      li.className = "ok";
      li.textContent = "✓ 校验通过";
      this.errorsEl.appendChild(li);
    } else {
      for (const error of errors) {
        const li = document.createElement("li");
        if (error.x !== undefined && error.y !== undefined) {
          const btn = document.createElement("button");
          btn.textContent = `(${error.x},${error.y}) ${error.message}`;
          btn.title = "跳转到该格";
          const x = error.x;
          const y = error.y;
          btn.onclick = () => this.editor.focusCell(x, y);
          li.appendChild(btn);
        } else {
          li.textContent = error.message;
        }
        this.errorsEl.appendChild(li);
      }
    }
    this.errorCountEl.textContent = errors.length === 0 ? "" : `${errors.length} 条`;
    this.errorCountEl.classList.toggle("bad", errors.length > 0);

    this.editor.setErrorMarkers(
      errors
        .filter((e) => e.x !== undefined && e.y !== undefined)
        .map((e) => ({ x: e.x as number, y: e.y as number, message: e.message })),
    );
    this.syncDevDeleteState();

    if (errors.length > 0) {
      this.compileEl.textContent = `⚠ ${errors.length} 条错误，无法编译`;
      this.compileEl.classList.add("bad");
      this.playBtn.disabled = true;
      if (this.saveProjectBtn) this.saveProjectBtn.disabled = true;
      return;
    }

    try {
      const map = compileTilesToMapDef(toMapJson(doc));
      this.compileEl.textContent = `✓ 编译通过 · ${map.walls.length} 面墙 / ${map.openings.length} 扇门窗 · 画布 ${map.width}×${map.height}`;
      this.compileEl.classList.remove("bad");
      this.compileEl.classList.add("ok");
      this.playBtn.disabled = false;
      if (this.saveProjectBtn) this.saveProjectBtn.disabled = isReadOnlyMap(doc.id);
    } catch (err) {
      this.compileEl.textContent = `编译失败：${err instanceof Error ? err.message : String(err)}`;
      this.compileEl.classList.add("bad");
      this.playBtn.disabled = true;
      if (this.saveProjectBtn) this.saveProjectBtn.disabled = true;
    }
  }

  /**
   * 结构校验 + 名称全局唯一预校验。
   * 名称去首尾空格后比较，区分大小写（A 与 a 视为不同）；排除当前图自身的 id。
   */
  private validationErrors(doc: WorkshopDoc): MapValidationError[] {
    const errors = validateMapJson(toRawJson(doc));
    const name = doc.name.trim();
    if (name) {
      const conflict = this.builtinCatalog.find(
        (entry) => entry.id !== doc.id && entry.hasName && entry.name === name,
      );
      if (conflict) {
        errors.push({
          message: `地图名称「${name}」已被「${conflict.name}」（${conflict.id}）使用`,
        });
      }
    }
    return errors;
  }

  // ============================================================
  // 开口列表
  // ============================================================

  private refreshOpenings(): void {
    const doc = this.editor.getDoc();
    if (this.selectedOpeningId && !doc.openings.some((o) => o.id === this.selectedOpeningId)) {
      this.selectedOpeningId = null;
      this.editor.setSelectedOpening(null);
    }
    this.openingsEl.innerHTML = "";

    if (doc.openings.length === 0) {
      const empty = document.createElement("p");
      empty.className = "ws-hint";
      empty.textContent = "还没有门窗，用门 / 窗画笔画。";
      this.openingsEl.appendChild(empty);
      return;
    }

    for (const opening of doc.openings) {
      const row = document.createElement("div");
      row.className = "ws-open-row";
      if (opening.id === this.selectedOpeningId) row.classList.add("selected");

      const nameBtn = document.createElement("button");
      nameBtn.className = "ws-open-name";
      nameBtn.innerHTML = `<b>${opening.kind === "door" ? "门" : "窗"}</b> ${escapeHtml(opening.id)}`;
      nameBtn.onclick = () => {
        this.selectedOpeningId = opening.id;
        this.editor.setSelectedOpening(opening.id);
        this.editor.focusCell(
          opening.x + Math.floor(opening.w / 2),
          opening.y + Math.floor(opening.h / 2),
        );
        this.refreshOpenings();
      };

      const size = document.createElement("span");
      size.className = "ws-open-size";
      size.textContent = `${(opening.w >= opening.h ? opening.w : opening.h) * TILE_SIZE}px`;

      const hp = document.createElement("input");
      hp.type = "number";
      hp.min = "1";
      hp.step = "1";
      hp.value = String(opening.maxHp);
      hp.title = "默认血量";
      hp.addEventListener("change", () => {
        const value = Math.max(1, Math.round(Number(hp.value) || 1));
        opening.maxHp = value;
        hp.value = String(value);
        this.refreshValidation();
        this.scheduleSave();
      });

      const pass = document.createElement("input");
      pass.type = "number";
      pass.min = "0.05";
      pass.max = "1";
      pass.step = "0.05";
      pass.value = String(opening.passSpeed);
      pass.title = "通行速度";
      pass.addEventListener("change", () => {
        let value = Number(pass.value);
        if (!Number.isFinite(value)) value = opening.passSpeed;
        value = Math.max(0.05, Math.min(1, value));
        opening.passSpeed = Number(value.toFixed(2));
        pass.value = String(opening.passSpeed);
        this.refreshValidation();
        this.scheduleSave();
      });

      const del = document.createElement("button");
      del.className = "ws-open-del";
      del.textContent = "✕";
      del.title = "删除这扇门窗（瓦片还原成墙）";
      del.onclick = () => {
        this.editor.removeOpening(opening.id);
        if (this.selectedOpeningId === opening.id) this.selectedOpeningId = null;
        this.refreshOpenings();
      };

      row.append(nameBtn, size, hp, pass, del);
      this.openingsEl.appendChild(row);
    }
  }

  // ============================================================
  // 区域列表（多块）
  // ============================================================

  private refreshZones(): void {
    const doc = this.editor.getDoc();
    const listOf = (kind: "human" | "spawn") =>
      kind === "human" ? doc.humanZones : doc.spawnZones;

    if (this.selectedZone) {
      const list = listOf(this.selectedZone.kind);
      if (this.selectedZone.index >= list.length) {
        this.selectedZone = null;
        this.editor.setSelectedZone(null);
      }
    }

    this.zonesEl.innerHTML = "";
    if (doc.humanZones.length === 0 && doc.spawnZones.length === 0) {
      const empty = document.createElement("p");
      empty.className = "ws-hint";
      empty.textContent = "还没有区域，用人类区 / 僵尸区画笔画（可放多块）。";
      this.zonesEl.appendChild(empty);
      return;
    }

    const addRow = (kind: "human" | "spawn", rect: TileRect, index: number): void => {
      const row = document.createElement("div");
      row.className = "ws-zone-row";
      const selected =
        this.selectedZone?.kind === kind && this.selectedZone.index === index;
      if (selected) row.classList.add("selected");

      const nameBtn = document.createElement("button");
      nameBtn.className = "ws-zone-name";
      nameBtn.innerHTML = `<b>${kind === "human" ? "人类区" : "僵尸区"}</b> ${index + 1}`;
      nameBtn.title = "选中并定位到这块区域";
      nameBtn.onclick = () => {
        this.editor.setSelectedZone({ kind, index });
        this.editor.focusCell(
          rect.x + Math.floor(rect.w / 2),
          rect.y + Math.floor(rect.h / 2),
        );
      };

      const size = document.createElement("span");
      size.className = "ws-open-size";
      size.textContent = `${rect.w}×${rect.h}`;

      const del = document.createElement("button");
      del.className = "ws-open-del";
      del.textContent = "✕";
      del.title = "删除这块区域（也可选中后按 Delete）";
      del.onclick = () => {
        this.editor.removeZone(kind, index);
      };

      row.append(nameBtn, size, del);
      this.zonesEl.appendChild(row);
    };

    for (const kind of ["human", "spawn"] as const) {
      const list = listOf(kind);
      list.forEach((rect, index) => addRow(kind, rect, index));
    }
  }

  // ============================================================
  // 存档 / 导入导出 / 试玩
  // ============================================================

  private bindIo(): void {
    this.query<HTMLButtonElement>("#wsNew").onclick = () => {
      if (!confirm("新建一张空白地图？当前内容会先保存进草稿，可用撤销或重新载入找回部分内容。")) {
        return;
      }
      const doc = createBlankDoc();
      doc.id = this.nextWorkshopId();
      doc.name = this.uniqueName(doc.name);
      this.editor.replaceDoc(doc, true);
      this.syncMeta();
      this.refreshValidation();
      this.refreshOpenings();
      this.refreshZones();
      this.saveDraftNow();
      this.showToast("已新建空白地图");
    };

    this.query<HTMLButtonElement>("#wsSaveNow").onclick = () => {
      this.saveDraftNow();
      this.showToast("草稿已保存到 localStorage");
    };

    this.query<HTMLButtonElement>("#wsCopy").onclick = () => this.saveAsCopy();

    this.exportBtn.onclick = () => this.exportJson();

    const importBtn = this.query<HTMLButtonElement>("#wsImportBtn");
    const importFile = this.query<HTMLInputElement>("#wsImportFile");
    importBtn.onclick = () => importFile.click();
    importFile.onchange = () => {
      const file = importFile.files?.[0];
      importFile.value = "";
      if (file) void this.importJsonFile(file);
    };

    this.query<HTMLButtonElement>("#wsLoadBuiltin").onclick = () => {
      void this.loadSelectedBuiltin();
    };

    this.playBtn.onclick = () => this.playCurrentMap();
  }

  private scheduleSave(): void {
    if (!this.hasActivated) return;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveDraftNow(), 250);
  }

  private saveDraftNow(): void {
    if (!this.hasActivated) return;
    window.clearTimeout(this.saveTimer);
    const updatedAt = saveWorkshopDraft(this.editor.getDoc());
    this.saveStatusEl.textContent = this.formatSavedAt(updatedAt);
  }

  private formatSavedAt(timestamp: number): string {
    const time = new Date(timestamp);
    const hh = String(time.getHours()).padStart(2, "0");
    const mm = String(time.getMinutes()).padStart(2, "0");
    const ss = String(time.getSeconds()).padStart(2, "0");
    return `已自动保存 ${hh}:${mm}:${ss}`;
  }

  private saveAsCopy(): void {
    const doc = this.editor.getDoc();
    const suggested = this.uniqueName(`${doc.name} 副本`);
    const input = prompt(
      "另存为副本：输入地图名称（去首尾空格后 1–24 字，名称全局唯一）\nid 由系统自动生成",
      suggested,
    );
    if (input === null) return;
    const name = input.trim();
    if (!name) {
      this.showToast("名称不能为空", "bad");
      return;
    }
    if (name.length > 24) {
      this.showToast(`名称最多 24 字（当前 ${name.length} 字）`, "bad");
      return;
    }
    if (this.nameTaken(name)) {
      this.showToast(`名称「${name}」已被其它地图使用，请换一个`, "bad");
      return;
    }
    const copy = cloneDoc(doc);
    copy.id = this.nextWorkshopId();
    copy.name = name;
    copy.builtinId = null;
    this.editor.replaceDoc(copy, false);
    this.syncMeta();
    this.refreshValidation();
    this.refreshOpenings();
    this.refreshZones();
    this.saveDraftNow();
    this.showToast(`已另存为副本「${name}」（id ${copy.id}）`);
  }

  /** 名称是否已被目录里另一张图占用（区分大小写，忽略首尾空格） */
  private nameTaken(name: string, excludeId?: string): boolean {
    const trimmed = name.trim();
    return this.builtinCatalog.some(
      (entry) => entry.id !== excludeId && entry.hasName && entry.name === trimmed,
    );
  }

  /** 生成一个不与现有目录冲突的系统 id */
  private nextWorkshopId(): string {
    return generateWorkshopId(this.builtinCatalog.map((entry) => entry.id));
  }

  /** 基于候选名称找一个可用名（冲突时追加 2 / 3 …，并压在 24 字以内） */
  private uniqueName(base: string): string {
    let name = base.trim().slice(0, 24) || "我的地图";
    if (!this.nameTaken(name)) return name;
    for (let i = 2; i < 100; i++) {
      const suffix = ` ${i}`;
      name = `${base.trim().slice(0, 24 - suffix.length)}${suffix}`;
      if (!this.nameTaken(name)) return name;
    }
    return `${Date.now()}`.slice(-24);
  }

  private exportJson(): void {
    const doc = this.editor.getDoc();
    if (isReadOnlyMap(doc.id)) {
      this.showToast(`「${doc.id}」是内置只读地图，请先另存为副本再导出`, "bad");
      return;
    }
    const errors = this.validationErrors(doc);
    if (errors.length > 0) {
      const first = errors[0];
      const at = first.x === undefined ? "" : `(${first.x},${first.y}) `;
      this.showToast(`还有 ${errors.length} 条校验错误：${at}${first.message}`, "bad");
      return;
    }
    let json;
    try {
      json = toMapJson(doc);
    } catch (err) {
      this.showToast(err instanceof Error ? err.message : String(err), "bad");
      return;
    }
    const text = `${JSON.stringify(json, null, 2)}\n`;
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFileId(doc.id)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast(`已导出 ${sanitizeFileId(doc.id)}.json，可放入 public/maps/ 并登记 manifest`);
  }

  /** 仅开发态：动态加载保存模块并显示按钮（生产构建整块剔除） */
  private bindDevSave(): void {
    const btn = this.saveProjectBtn;
    if (!btn) return;
    if (import.meta.env.DEV) {
      void import("./devSave")
        .then((mod) => {
          mod.installDevSave({
            button: btn,
            isReadOnly: () => isReadOnlyMap(this.editor.getDoc().id),
            getErrors: () => this.validationErrors(this.editor.getDoc()),
            getMap: () => toMapJson(this.editor.getDoc()),
            toast: (text, kind) => this.showToast(text, kind),
            refresh: () => this.refreshValidation(),
            afterSave: async (id) => {
              this.saveDraftNow();
              resetWorkshopCatalog();
              await this.reloadBuiltinCatalog();
              await this.onSaved?.(id);
            },
          });
        })
        .catch((err) => {
          console.warn("[workshop] 开发态保存模块加载失败", err);
          btn.remove();
        });
      return;
    }
    btn.remove();
  }

  /** 仅开发态：动态加载删除模块并显示按钮（生产构建整块剔除） */
  private bindDevDelete(): void {
    const btn = this.deleteMapBtn;
    if (!btn) return;
    if (this.syncDevDelete) {
      this.syncDevDelete();
      return;
    }
    if (import.meta.env.DEV) {
      void import("./devDelete")
        .then((mod) => {
          this.syncDevDelete = mod.installDevDelete({
            button: btn,
            getInfo: () => this.deleteInfo(),
            toast: (text, kind) => this.showToast(text, kind),
            refresh: () => this.refreshValidation(),
            afterDelete: async (id, name) => {
              this.saveDraftNow();
              resetWorkshopCatalog();
              await this.reloadBuiltinCatalog();
              await this.onDeleted?.(id);
              this.refreshValidation();
              this.refreshOpenings();
              this.refreshZones();
              this.showToast(`已删除「${name}」（${id}），名称已释放`);
            },
          });
          this.syncDevDelete();
        })
        .catch((err) => {
          console.warn("[workshop] 开发态删除模块加载失败", err);
          btn.remove();
        });
      return;
    }
    btn.remove();
  }

  /** 保存后重读 manifest，让新图立刻出现在「载入内置图」下拉里 */
  private async reloadBuiltinCatalog(): Promise<void> {
    this.builtinCatalog = [];
    this.catalogLoaded = false;
    this.builtinSelect.innerHTML = '<option value="">载入内置图…</option>';
    this.builtinSelect.disabled = false;
    await this.loadCatalog();
  }

  private async importJsonFile(file: File): Promise<void> {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const errors = validateMapJson(parsed);
      if (typeof parsed !== "object" || parsed === null) {
        this.showToast("导入失败：文件不是合法的地图 JSON 对象", "bad");
        return;
      }
      const doc = fromMapJson(parsed as MapJson);
      doc.builtinId = null;
      this.editor.replaceDoc(doc, true);
      this.syncMeta();
      this.refreshValidation();
      this.refreshOpenings();
      this.refreshZones();
      this.saveDraftNow();
      if (errors.length > 0) {
        this.showToast(`已导入「${doc.name}」，但有 ${errors.length} 条校验错误`, "bad");
      } else {
        this.showToast(`已导入「${doc.name}」并通过校验`);
      }
    } catch (err) {
      this.showToast(`导入失败：${err instanceof Error ? err.message : String(err)}`, "bad");
    }
  }

  private async loadCatalog(): Promise<void> {
    try {
      this.builtinCatalog = await loadBuiltinCatalog();
      this.catalogLoaded = true;
      for (const entry of this.builtinCatalog) {
        const option = document.createElement("option");
        option.value = entry.id;
        option.textContent = entry.hasName ? `${entry.name}（${entry.id}）` : entry.id;
        this.builtinSelect.appendChild(option);
      }
      if (this.builtinCatalog.length === 0) {
        this.builtinSelect.disabled = true;
      }
      // 目录加载后名称冲突校验才有意义，立刻重算一次
      this.refreshValidation();
      this.syncDevDeleteState();
    } catch (err) {
      console.warn("[workshop] 内置地图目录加载失败", err);
      this.showToast("内置地图目录加载失败，只能导入 / 新建", "bad");
    }
  }

  private async loadSelectedBuiltin(): Promise<void> {
    const id = this.builtinSelect.value;
    if (!id) {
      this.showToast("请先选择一张内置图", "bad");
      return;
    }
    try {
      const json = await loadBuiltinMapJson(id);
      const doc = fromMapJson(json);
      const entry = this.builtinCatalog.find((item) => item.id === id);
      const readonly = entry ? entry.readOnly : true;
      doc.builtinId = readonly ? id : null;
      this.editor.replaceDoc(doc, true);
      this.syncMeta();
      this.refreshValidation();
      this.refreshOpenings();
      this.refreshZones();
      this.saveDraftNow();
      if (readonly) {
        this.showToast(`已载入内置图「${doc.name}」；它是只读的，导出前请另存为副本`);
      } else {
        this.showToast(`已载入工坊图「${doc.name}」（${doc.id}），可直接保存覆盖`);
      }
    } catch (err) {
      this.showToast(
        `载入失败：${err instanceof Error ? err.message : String(err)}`,
        "bad",
      );
    }
  }

  private playCurrentMap(): void {
    if (this.playBtn.disabled) return;
    const doc = this.editor.getDoc();
    try {
      const json = toMapJson(doc);
      // 先在编辑器里编译一次，确保不会把坏图带进训练场
      compileTilesToMapDef(json);
      saveWorkshopPreview(json);
      const url = new URL(window.location.href);
      url.searchParams.set("map", WORKSHOP_PREVIEW_MAP_ID);
      url.hash = "#/training";
      this.showToast("正在载入训练场…");
      window.location.href = url.toString();
    } catch (err) {
      this.showToast(
        `无法试玩：${err instanceof Error ? err.message : String(err)}`,
        "bad",
      );
    }
  }

  private showToast(text: string, kind: "ok" | "bad" = "ok"): void {
    window.clearTimeout(this.toastTimer);
    this.toastEl.textContent = text;
    this.toastEl.className = `ws-toast show ${kind}`;
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.className = "ws-toast";
    }, 3200);
  }
}
