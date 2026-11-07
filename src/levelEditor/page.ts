/**
 * 开发者关卡编辑器（0.6.0 阶段 4）—— 从 #/levels 列表弹出的整页表单。
 *
 * 只编辑 LevelJson；保存 / 删除走 dev-only 中间件（`src/levelEditor/devSave.ts` /
 * `devDelete.ts` 只在 `import.meta.env.DEV` 下动态导入）。
 * 内置只读关卡不进入编辑，只能从列表「复制」出新的副本。
 */
import { MAP_LIST } from "../data/maps";
import {
  LEVEL_WEAPON_ORDER,
  validateLevelJson,
  type LevelHumanConfig,
  type LevelJson,
} from "../data/levels/schema";
import { isReadOnlyLevel } from "../data/levels";
import { ZOMBIE_IDS, getZombieDef } from "../data/zombies";
import { WEAPON_LIST } from "../data/weapons";
import { LEVELS, findLevel } from "../levels";
import type { LevelSaveResult } from "./devSave";
import type { LevelDeleteResult } from "./devDelete";

type EditorMode = "new" | "edit" | "copy";

interface EditorCallbacks {
  onClose: () => void;
  /** 保存 / 删除成功后的热刷新；参数是被保存 / 删除的关卡 id */
  onSaved: (id: string) => Promise<void>;
  onDeleted: (id: string) => Promise<void>;
}

const DEFAULT_HUMANS: Record<string, { hp: number; initial: number; cap: number; regen: number }> = {
  mg: { hp: 100, initial: 20, cap: 20, regen: 25 },
  flame: { hp: 100, initial: 8, cap: 8, regen: 40 },
  shotgun: { hp: 100, initial: 8, cap: 8, regen: 35 },
  rocket: { hp: 100, initial: 4, cap: 4, regen: 90 },
  tesla: { hp: 100, initial: 10, cap: 10, regen: 50 },
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

function newLevelId(): string {
  const stamp = Date.now().toString(36);
  const rand = Math.random().toString(16).slice(2, 6);
  return `lv-${stamp}-${rand}`;
}

function emptyLevel(): LevelJson {
  return {
    schemaVersion: 1,
    id: newLevelId(),
    name: "",
    mapId: "arena",
    mode: "placement",
    humans: LEVEL_WEAPON_ORDER.map((id) => ({
      id,
      enabled: true,
      ...DEFAULT_HUMANS[id],
    })),
    waves: [
      { zombies: [{ kind: ZOMBIE_IDS.normal, count: 40 }], interval: 1.8 },
      { zombies: [{ kind: ZOMBIE_IDS.normal, count: 50 }], interval: 1.8 },
      { zombies: [{ kind: ZOMBIE_IDS.normal, count: 60 }], interval: 1.8 },
    ],
  };
}

function cloneLevel(source: LevelJson, mode: EditorMode): LevelJson {
  const copy = structuredClone(source);
  copy.id = newLevelId();
  if (mode === "copy") copy.name = `${source.name} 副本`.slice(0, 24);
  return copy;
}

export class LevelEditorPage {
  private root: HTMLElement;
  private doc: LevelJson | undefined;
  private mode: EditorMode = "new";
  private toastText = "";
  private toastBad = false;
  /** 删除 / 保存进行中，避免重复点击 */
  private busy = false;
  /** dev-only 接口：只在 import.meta.env.DEV 分支里赋值，生产构建会整块剔除 */
  private saveImpl?: (level: LevelJson, overwrite: boolean) => Promise<LevelSaveResult>;
  private deleteImpl?: (id: string) => Promise<LevelDeleteResult>;

  constructor(private cb: EditorCallbacks) {
    this.root = document.createElement("div");
    this.root.className = "le-overlay hidden";
    this.root.innerHTML = `<div class="le-panel" role="dialog" aria-modal="true">
      <div class="le-head">
        <span class="le-title">关卡编辑器</span>
        <span class="le-id" id="leId"></span>
        <button class="le-close" id="leClose" title="关闭">✕</button>
      </div>
      <div class="le-body" id="leBody"></div>
      <div class="le-foot">
        <div class="le-errors" id="leErrors"></div>
        <div class="le-toast hidden" id="leToast"></div>
        <div class="le-actions">
          <button class="le-btn danger hidden" id="leDelete">🗑 删除关卡</button>
          <button class="le-btn hidden" id="leCopy">📄 复制为副本</button>
          <button class="le-btn" id="leCancel">取消</button>
          <button class="le-btn primary hidden" id="leSave">💾 保存到项目（dev）</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(this.root);

    this.root.addEventListener("click", (ev) => this.onDelegatedClick(ev));
    this.root.addEventListener("input", (ev) => this.onFieldInput(ev));
    this.root.addEventListener("change", (ev) => this.onFieldInput(ev));

    (this.root.querySelector("#leClose") as HTMLButtonElement).onclick = () => this.close();
    (this.root.querySelector("#leCancel") as HTMLButtonElement).onclick = () => this.close();
    (this.root.querySelector("#leSave") as HTMLButtonElement).onclick = () => void this.save();
    (this.root.querySelector("#leDelete") as HTMLButtonElement).onclick = () => void this.remove();
    (this.root.querySelector("#leCopy") as HTMLButtonElement).onclick = () => {
      if (!this.doc) return;
      this.open("copy", this.doc.id);
    };
  }

  get isOpen(): boolean {
    return !this.root.classList.contains("hidden");
  }

  open(mode: EditorMode, sourceId?: string): void {
    if (mode === "new") this.doc = emptyLevel();
    else {
      const sourceDef = sourceId ? findLevel(sourceId) : undefined;
      if (!sourceDef) return;
      this.doc = mode === "copy" ? cloneLevel(sourceDef, "copy") : structuredClone(sourceDef);
    }
    this.mode = mode;
    this.toastText = "";
    this.toastBad = false;
    this.busy = false;
    this.root.classList.remove("hidden");

    this.ensureDevModules();
    const saveBtn = this.root.querySelector<HTMLButtonElement>("#leSave")!;
    const deleteBtn = this.root.querySelector<HTMLButtonElement>("#leDelete")!;
    const copyBtn = this.root.querySelector<HTMLButtonElement>("#leCopy")!;
    if (mode === "edit") {
      saveBtn.classList.toggle("hidden", !import.meta.env.DEV);
      deleteBtn.classList.toggle("hidden", !import.meta.env.DEV);
      copyBtn.classList.add("hidden");
    } else {
      saveBtn.classList.toggle("hidden", !import.meta.env.DEV);
      deleteBtn.classList.add("hidden");
      copyBtn.classList.add("hidden");
    }
    this.render();
  }

  close(): void {
    this.root.classList.add("hidden");
    this.doc = undefined;
    this.cb.onClose();
  }

  /** dev-only 模块懒加载；生产构建下 import.meta.env.DEV 为 false，整块被剔除 */
  private ensureDevModules(): void {
    if (!import.meta.env.DEV || this.saveImpl) return;
    void import("./devSave")
      .then((mod) => {
        this.saveImpl = mod.saveLevelToProject;
      })
      .catch((err) => console.warn("[levelEditor] 开发态保存模块加载失败", err));
    void import("./devDelete")
      .then((mod) => {
        this.deleteImpl = mod.deleteLevelFromProject;
      })
      .catch((err) => console.warn("[levelEditor] 开发态删除模块加载失败", err));
  }

  // ============================================================
  // 表单渲染
  // ============================================================

  private render(): void {
    const doc = this.doc;
    if (!doc) return;
    (this.root.querySelector("#leId") as HTMLElement).textContent = doc.id;

    const name = escapeHtml(doc.name);
    const mapOptions = MAP_LIST.map(
      (m) => `<option value="${m.id}" ${m.id === doc.mapId ? "selected" : ""}>${escapeHtml(m.name)}（${m.id}）</option>`,
    ).join("");

    let humansHtml = "";
    for (const weapon of WEAPON_LIST) {
      const cfg = doc.humans.find((h) => h.id === weapon.id) ?? this.ensureHuman(weapon.id);
      humansHtml += `<div class="le-human-row">
        <label class="le-check">
          <input type="checkbox" data-field="human.enabled" data-id="${weapon.id}" ${cfg.enabled ? "checked" : ""} />
          <span>${escapeHtml(weapon.name)}</span>
        </label>
        <label>血量<input type="number" min="1" step="1" data-field="human.hp" data-id="${weapon.id}" value="${cfg.hp}" /></label>
        <label>初始<input type="number" min="0" step="1" data-field="human.initial" data-id="${weapon.id}" value="${cfg.initial}" /></label>
        <label>上限<input type="number" min="1" step="1" data-field="human.cap" data-id="${weapon.id}" value="${cfg.cap}" /></label>
        <label>恢复(s)<input type="number" min="0.1" step="0.1" data-field="human.regen" data-id="${weapon.id}" value="${cfg.regen}" /></label>
      </div>`;
    }

    let wavesHtml = "";
    doc.waves.forEach((wave, wi) => {
      let groups = "";
      wave.zombies.forEach((group, gi) => {
        const options = Object.values(ZOMBIE_IDS)
          .map(
            (id) => `<option value="${id}" ${id === group.kind ? "selected" : ""}>${escapeHtml(getZombieDef(id).name)}</option>`,
          )
          .join("");
        groups += `<div class="le-zombie-row">
          <select data-field="wave.zombie.kind" data-wave="${wi}" data-index="${gi}">${options}</select>
          <label>只数<input type="number" min="1" step="1" data-field="wave.zombie.count" data-wave="${wi}" data-index="${gi}" value="${group.count}" /></label>
          <button class="le-mini danger" data-action="removeZombie" data-wave="${wi}" data-index="${gi}" title="删除这一行">✕</button>
        </div>`;
      });
      wavesHtml += `<div class="le-wave">
        <div class="le-wave-head">
          <span class="le-wave-title">第 ${wi + 1} 波</span>
          <label class="le-interval">结束后间隔(s)<input type="number" min="0" step="0.1" data-field="wave.interval" data-wave="${wi}" value="${wave.interval ?? 1.8}" /></label>
          <button class="le-mini" data-action="addZombie" data-wave="${wi}">＋ 兵种</button>
          <button class="le-mini danger" data-action="removeWave" data-wave="${wi}" ${doc.waves.length <= 1 ? "disabled" : ""}>删除波</button>
        </div>
        <div class="le-zombie-list">${groups}</div>
      </div>`;
    });

    (this.root.querySelector("#leBody") as HTMLElement).innerHTML = `
      <div class="le-general">
        <label class="le-name">名称
          <input type="text" data-field="name" maxlength="24" value="${name}" placeholder="1–24 字，全局唯一" />
        </label>
        <label>绑定地图
          <select data-field="mapId">${mapOptions}</select>
        </label>
      </div>

      <section class="le-section">
        <h3>人类种类（武器）</h3>
        <p class="le-tip">每种武器一档血量；关闭表示本关不提供该人类。</p>
        <div class="le-humans">${humansHtml}</div>
      </section>

      <section class="le-section">
        <h3>波次</h3>
        <p class="le-tip">每波可以包含多种僵尸；间隔是该波清空后到下一波的等待时间。</p>
        <div class="le-waves">${wavesHtml}</div>
        <button class="le-add-wave" data-action="addWave">＋ 新增一波</button>
      </section>
    `;

    // 只读写保护（正常流程不会打开内置关，这里兜底）
    const readonly = this.mode === "edit" && this.isSourceReadOnly();
    if (readonly) {
      (this.root.querySelector("#leBody") as HTMLElement)
        .querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select")
        .forEach((el) => (el.disabled = true));
      (this.root.querySelector("#leSave") as HTMLButtonElement).classList.add("hidden");
      (this.root.querySelector("#leDelete") as HTMLButtonElement).classList.add("hidden");
      (this.root.querySelector("#leCopy") as HTMLButtonElement).classList.remove("hidden");
    }

    this.refreshErrors();
  }

  private isSourceReadOnly(): boolean {
    const doc = this.doc;
    if (!doc) return false;
    return Boolean(findLevel(doc.id)) && isReadOnlyLevel(doc.id);
  }

  private ensureHuman(id: string): LevelHumanConfig {
    const doc = this.doc!;
    const cfg: LevelHumanConfig = {
      id,
      enabled: false,
      ...DEFAULT_HUMANS[id],
    };
    doc.humans.push(cfg);
    return cfg;
  }

  private onFieldInput(ev: Event): void {
    const target = ev.target as HTMLInputElement | HTMLSelectElement;
    const field = target.dataset.field;
    const doc = this.doc;
    if (!field || !doc) return;

    if (field === "name") {
      doc.name = target.value;
    } else if (field === "mapId") {
      doc.mapId = target.value;
    } else if (field.startsWith("human.")) {
      const key = field.slice("human.".length) as "enabled" | "hp" | "initial" | "cap" | "regen";
      const cfg = doc.humans.find((h) => h.id === target.dataset.id);
      if (!cfg) return;
      if (key === "enabled") cfg.enabled = (target as HTMLInputElement).checked;
      else cfg[key] = Math.max(key === "initial" ? 0 : 0.1, Number(target.value) || 0);
    } else if (field.startsWith("wave.")) {
      const wi = Number(target.dataset.wave);
      const wave = doc.waves[wi];
      if (!wave) return;
      if (field === "wave.interval") {
        wave.interval = Math.max(0, Number(target.value) || 0);
      } else {
        const gi = Number(target.dataset.index);
        const group = wave.zombies[gi];
        if (!group) return;
        if (field === "wave.zombie.kind") group.kind = target.value;
        else group.count = Math.max(1, Math.round(Number(target.value) || 1));
      }
    }
    this.refreshErrors();
  }

  private onDelegatedClick(ev: MouseEvent): void {
    const el = (ev.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el) return;
    const doc = this.doc;
    if (!doc) return;
    const action = el.dataset.action;
    const wi = Number(el.dataset.wave);

    if (action === "addWave") {
      const prev = doc.waves[doc.waves.length - 1];
      const count = prev ? prev.zombies.reduce((s, g) => s + g.count, 0) + 10 : 40;
      doc.waves.push({ zombies: [{ kind: ZOMBIE_IDS.normal, count }], interval: 1.8 });
      this.render();
    } else if (action === "removeWave") {
      if (doc.waves.length <= 1) return;
      doc.waves.splice(wi, 1);
      this.render();
    } else if (action === "addZombie") {
      const wave = doc.waves[wi];
      if (!wave) return;
      wave.zombies.push({ kind: ZOMBIE_IDS.normal, count: 20 });
      this.render();
    } else if (action === "removeZombie") {
      const wave = doc.waves[wi];
      if (!wave || wave.zombies.length <= 1) return;
      wave.zombies.splice(Number(el.dataset.index), 1);
      this.render();
    }
  }

  private refreshErrors(): void {
    const doc = this.doc;
    if (!doc) return;
    const errors = validateLevelJson(doc);
    const box = this.root.querySelector<HTMLElement>("#leErrors")!;
    if (errors.length === 0) {
      box.innerHTML = "";
      box.classList.add("hidden");
    } else {
      box.classList.remove("hidden");
      box.innerHTML = errors.slice(0, 4).map((e) => `<div>• ${escapeHtml(e)}</div>`).join("");
    }
    const toast = this.root.querySelector<HTMLElement>("#leToast")!;
    toast.textContent = this.toastText;
    toast.classList.toggle("hidden", !this.toastText);
    toast.classList.toggle("bad", this.toastBad);
  }

  private toast(text: string, bad = false): void {
    this.toastText = text;
    this.toastBad = bad;
    this.refreshErrors();
  }

  // ============================================================
  // 保存 / 删除（dev-only）
  // ============================================================

  private async save(): Promise<void> {
    if (this.busy) return;
    const doc = this.doc;
    if (!doc) return;
    if (!import.meta.env.DEV) {
      this.toast("生产构建下不能保存到项目", true);
      return;
    }

    const name = doc.name.trim();
    if (name.length === 0) {
      this.toast("请填写关卡名称", true);
      return;
    }
    const errors = validateLevelJson({ ...doc, name });
    if (errors.length > 0) {
      this.toast(`还有 ${errors.length} 条校验错误：${errors[0]}`, true);
      return;
    }
    const conflict = LEVELS.find((l) => l.id !== doc.id && l.title.trim() === name);
    if (conflict) {
      this.toast(`关卡名称「${name}」已被「${conflict.title}」使用，请换一个名称`, true);
      return;
    }
    doc.name = name;

    this.busy = true;
    const saveBtn = this.root.querySelector<HTMLButtonElement>("#leSave")!;
    const label = saveBtn.textContent ?? "";
    saveBtn.disabled = true;
    saveBtn.textContent = "保存中…";
    try {
      if (!this.saveImpl) {
        this.toast("开发态保存模块尚未就绪，请稍后再试", true);
        return;
      }
      let result = await this.saveImpl(doc, false);
      if (result.status === 409 && result.code === "name_taken") {
        this.toast(result.message || "关卡名称已被占用，请换一个名称", true);
        return;
      }
      if (result.status === 409) {
        const ok = window.confirm(
          result.message || `「${doc.id}」已存在，覆盖前会备份到 .bak，继续？`,
        );
        if (!ok) {
          this.toast("已取消保存");
          return;
        }
        result = await this.saveImpl(doc, true);
      }
      if (!result.ok) {
        this.toast(result.message || "保存失败", true);
        return;
      }
      await this.cb.onSaved(doc.id);
      this.root.classList.add("hidden");
      this.doc = undefined;
    } catch (err) {
      this.toast(`写入项目失败：${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      this.busy = false;
      saveBtn.textContent = label;
      saveBtn.disabled = false;
    }
  }

  private async remove(): Promise<void> {
    if (this.busy) return;
    const doc = this.doc;
    if (!doc) return;
    if (!import.meta.env.DEV) {
      this.toast("生产构建下不能删除关卡", true);
      return;
    }
    const confirmed = window.confirm(
      `确定删除关卡「${doc.name}」（${doc.id}）？\n` +
        "删除前会把文件备份到 public/levels/.bak/，删除后名称可复用。",
    );
    if (!confirmed) return;

    this.busy = true;
    const deleteBtn = this.root.querySelector<HTMLButtonElement>("#leDelete")!;
    const label = deleteBtn.textContent ?? "";
    deleteBtn.disabled = true;
    deleteBtn.textContent = "删除中…";
    try {
      if (!this.deleteImpl) {
        this.toast("开发态删除模块尚未就绪，请稍后再试", true);
        return;
      }
      const result = await this.deleteImpl(doc.id);
      if (!result.ok) {
        this.toast(result.message || "删除失败", true);
        return;
      }
      await this.cb.onDeleted(doc.id);
      this.root.classList.add("hidden");
      this.doc = undefined;
    } catch (err) {
      this.toast(`删除失败：${err instanceof Error ? err.message : String(err)}`, true);
    } finally {
      this.busy = false;
      deleteBtn.textContent = label;
      deleteBtn.disabled = false;
    }
  }
}
