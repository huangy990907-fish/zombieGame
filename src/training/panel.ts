/**
 * 训练场控制面板 —— 右侧滑出的 DOM 面板。
 *
 * 负责三块 UI：
 *  1. 单位库 + 工具（生成 / 删除 / 清场）
 *  2. 选中单位的属性编辑器（直接写回单位字段，立即生效）
 *  3. 节奏控制与实时读数（DPS / 击杀耗时 / 承受伤害）
 *
 * 面板本身不碰游戏逻辑，只调用 TrainingSession 的公开方法。
 */
import { settings } from "../data/settings/runtime";
import { BUILTIN_MAP_IDS, MAP_LIST, type MapDef } from "../data/maps";
import { WEAPON_LIST, getWeaponDef } from "../data/weapons";
import { ZOMBIE_LIST, getZombieDef } from "../data/zombies";
import type { Human, Zombie } from "../core/world";
import {
  TRAIN_HUMAN_TYPES,
  TRAIN_ZOMBIE_TYPES,
  TrainingSession,
  type SelectedUnit,
} from "./session";

function hexColor(c: number): string {
  return `#${c.toString(16).padStart(6, "0")}`;
}

/** 地图名 / id 来自工坊导入的 JSON，写进 DOM 前必须转义 */
function escHtml(s: string): string {
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

function fmt(n: number, digits = 0): string {
  return n.toFixed(digits);
}

function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function fmtTtk(sum: number, count: number): string {
  return count > 0 ? `${(sum / count).toFixed(1)}s` : "—";
}

/** 通用滑块行 HTML（id 用来绑定事件和刷新数值） */
function sliderRow(
  label: string,
  id: string,
  value: number,
  min: number,
  max: number,
  step: number,
  digits = 0,
): string {
  return `<div class="tp-row">
    <label for="${id}">${label}</label>
    <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" />
    <span class="tp-val" id="${id}Val">${fmt(value, digits)}</span>
  </div>`;
}

export class TrainingPanel {
  private root: HTMLElement;
  private editorEl!: HTMLElement;
  private statsEl!: HTMLElement;
  private hintEl!: HTMLElement;
  private rhythmHintEl!: HTMLElement;
  private selectBtn!: HTMLButtonElement;
  private deleteBtn!: HTMLButtonElement;
  private mapSelectEl!: HTMLSelectElement;
  private mapInfoEl!: HTMLElement;
  private mapHintEl!: HTMLElement;
  private pauseBtn!: HTMLButtonElement;
  private slowBtn!: HTMLButtonElement;
  private normalBtn!: HTMLButtonElement;
  private libButtons: HTMLButtonElement[] = [];
  private active = false;
  private acc = 0;
  private editorKey = "";

  constructor(
    private readonly session: TrainingSession,
    private readonly onBack: () => void,
    /** 切换地图：由 main.ts 负责重建 World、静态层与回退提示 */
    private readonly onMapChange: (id: string) => void,
  ) {
    const root = document.getElementById("trainingPanel");
    if (!root) throw new Error("missing element #trainingPanel");
    this.root = root;
    this.build();
  }

  /** 把画布点击事件接进来：屏幕坐标 -> 逻辑坐标 */
  attachCanvas(canvas: HTMLCanvasElement): void {
    canvas.addEventListener("pointerdown", (e) => {
      if (!this.active) return;
      const rect = canvas.getBoundingClientRect();
      const map = this.session.world.map;
      const x = ((e.clientX - rect.left) / rect.width) * map.width;
      const y = ((e.clientY - rect.top) / rect.height) * map.height;
      this.session.handleClick(x, y);
    });
  }

  activate(): void {
    this.active = true;
    this.root.classList.add("open");
    this.editorKey = "";
    this.refreshMapOptions();
    this.refresh(1);
  }

  deactivate(): void {
    this.active = false;
    this.root.classList.remove("open");
  }

  // ============================================================
  // 静态骨架
  // ============================================================

  private build(): void {
    this.root.innerHTML = `
      <div class="tp-head">
        <span class="tp-title">🧪 训练场 <i>SANDBOX</i></span>
        <button class="tp-back" id="tpBack">← 主菜单</button>
      </div>

      <div class="tp-tools">
        <button id="tpToolSelect" class="active">🖱 选择/编辑</button>
        <button id="tpToolDelete">🗑 删除</button>
        <button id="tpClear">🧹 清场</button>
        <button id="tpResetStats">↺ 读数清零</button>
      </div>

      <div class="tp-section">
        <h3>地图</h3>
        <div class="tp-map-row">
          <select id="tpMapSelect" class="tp-select"></select>
          <span class="tp-chip" id="tpMapInfo"></span>
        </div>
        <div class="tp-hint" id="tpMapHint">切换地图会重建 World，并清空单位与全部实时读数。</div>
      </div>

      <div class="tp-section">
        <h3>僵尸单位</h3>
        <div class="tp-lib" id="tpZombieLib"></div>
        <h3>人类单位</h3>
        <div class="tp-lib" id="tpHumanLib"></div>
        <div class="tp-hint" id="tpHint"></div>
      </div>

      <div class="tp-section">
        <h3>选中单位</h3>
        <div id="tpEditor"></div>
      </div>

      <div class="tp-section">
        <h3>节奏控制</h3>
        <div class="tp-rhythm">
          <button id="tpPause">⏸ 暂停</button>
          <button id="tpStep">⏭ 单步</button>
          <button id="tpSlow">0.25x 慢放</button>
          <button id="tpNormal">1x 正常</button>
        </div>
        <div class="tp-hint" id="tpRhythmHint"></div>
      </div>

      <div class="tp-section">
        <h3>实时读数</h3>
        <div id="tpStats"></div>
      </div>
    `;

    this.editorEl = this.el("tpEditor");
    this.statsEl = this.el("tpStats");
    this.hintEl = this.el("tpHint");
    this.rhythmHintEl = this.el("tpRhythmHint");
    this.mapSelectEl = this.el("tpMapSelect") as HTMLSelectElement;
    this.mapInfoEl = this.el("tpMapInfo");
    this.mapHintEl = this.el("tpMapHint");

    this.buildLibraries();

    this.mapSelectEl.onchange = () => {
      const id = this.mapSelectEl.value;
      if (!id || id === this.session.world.map.id) return;
      this.onMapChange(id);
      this.editorKey = "";
      this.refreshMapOptions(`已切换到「${this.session.world.map.name}」：单位与读数已清空。`);
      this.refresh(1);
    };

    (this.el("tpBack") as HTMLButtonElement).onclick = () => this.onBack();
    this.selectBtn = this.el("tpToolSelect") as HTMLButtonElement;
    this.deleteBtn = this.el("tpToolDelete") as HTMLButtonElement;
    this.selectBtn.onclick = () => {
      this.session.tool = "select";
      this.session.armed = null;
      this.refresh(1);
    };
    this.deleteBtn.onclick = () => {
      this.session.tool = "delete";
      this.session.armed = null;
      this.refresh(1);
    };
    (this.el("tpClear") as HTMLButtonElement).onclick = () => {
      this.session.clearUnits();
      this.editorKey = "";
      this.refresh(1);
    };
    (this.el("tpResetStats") as HTMLButtonElement).onclick = () => {
      this.session.resetReadings();
      this.refresh(1);
    };

    this.pauseBtn = this.el("tpPause") as HTMLButtonElement;
    this.slowBtn = this.el("tpSlow") as HTMLButtonElement;
    this.normalBtn = this.el("tpNormal") as HTMLButtonElement;
    this.pauseBtn.onclick = () => {
      this.session.paused = !this.session.paused;
      this.refresh(1);
    };
    (this.el("tpStep") as HTMLButtonElement).onclick = () => {
      this.session.requestStep();
      this.refresh(1);
    };
    this.slowBtn.onclick = () => {
      this.session.speed = 0.25;
      this.session.paused = false;
      this.refresh(1);
    };
    this.normalBtn.onclick = () => {
      this.session.speed = 1;
      this.session.paused = false;
      this.refresh(1);
    };

    this.refresh(1);
  }

  private el(id: string): HTMLElement {
    const node = document.getElementById(id);
    if (!node) throw new Error(`missing element #${id}`);
    return node;
  }

  private buildLibraries(): void {
    const zombieLib = this.el("tpZombieLib");
    zombieLib.innerHTML = TRAIN_ZOMBIE_TYPES.map(
      (t) => `<button class="tp-lib-btn" data-kind="zombie" data-id="${t.id}">
        <span class="tp-dot" style="background:${hexColor(t.color)}"></span>
        <span class="tp-lib-name">${t.name}</span>
        <span class="tp-lib-sub">${t.hp} HP · ${t.speed} 速 · ${t.damage} 攻</span>
      </button>`,
    ).join("");

    const humanLib = this.el("tpHumanLib");
    humanLib.innerHTML = TRAIN_HUMAN_TYPES.map(
      (t) => `<button class="tp-lib-btn" data-kind="human" data-id="${t.id}">
        <span class="tp-dot" style="background:${hexColor(t.color)}"></span>
        <span class="tp-lib-name">${t.name}</span>
        <span class="tp-lib-sub">${t.range} 射程 · ${t.damage} 伤</span>
      </button>`,
    ).join("");

    this.libButtons = Array.from(
      this.root.querySelectorAll<HTMLButtonElement>(".tp-lib-btn"),
    );
    for (const btn of this.libButtons) {
      btn.onclick = () => {
        const kind = btn.dataset.kind === "human" ? "human" : "zombie";
        const id = btn.dataset.id ?? "";
        this.session.armed = { kind, id };
        this.session.tool = "select";
        this.refresh(1);
      };
    }
  }

  /**
   * 重建地图下拉：
   *  - 内置地图 / 工坊地图分组，工坊来源包含启动时注册的 `workshop-draft`
   *  - 当前地图不在注册表时单独列出，避免下拉显示错值
   */
  private refreshMapOptions(message?: string): void {
    const current = this.session.world.map;
    const optionOf = (m: MapDef): string =>
      `<option value="${escHtml(m.id)}">${escHtml(m.name)}（${escHtml(m.id)}）</option>`;

    const builtin = MAP_LIST.filter((m) => BUILTIN_MAP_IDS.has(m.id));
    const workshop = MAP_LIST.filter((m) => !BUILTIN_MAP_IDS.has(m.id));
    const groups: string[] = [];
    if (builtin.length > 0) {
      groups.push(`<optgroup label="内置地图">${builtin.map(optionOf).join("")}</optgroup>`);
    }
    if (workshop.length > 0) {
      groups.push(`<optgroup label="工坊地图">${workshop.map(optionOf).join("")}</optgroup>`);
    }
    if (!MAP_LIST.some((m) => m.id === current.id)) {
      groups.push(`<optgroup label="当前地图">${optionOf(current)}</optgroup>`);
    }
    this.mapSelectEl.innerHTML = groups.join("");
    this.mapSelectEl.value = current.id;

    const isBuiltin = BUILTIN_MAP_IDS.has(current.id);
    this.mapInfoEl.textContent = `${current.name} · ${isBuiltin ? "内置" : "工坊"} · ${current.width}×${current.height}`;
    this.mapInfoEl.classList.toggle("tp-workshop", !isBuiltin);
    this.mapHintEl.textContent =
      message ?? "切换地图会重建 World，并清空单位与全部实时读数。";
  }

  /** 工坊保存新图后刷新下拉；不重建当前 World，也不清空正在进行的会话 */
  reloadMaps(savedId?: string): void {
    if (savedId && this.session.world.map.id === savedId) {
      this.refreshMapOptions(
        `「${savedId}」已写入项目地图；当前训练仍用旧数据，请切到其它地图再切回。`,
      );
      return;
    }
    this.refreshMapOptions("地图列表已刷新：新图可在下拉中选择。");
  }

  // ============================================================
  // 周期刷新
  // ============================================================

  /** 由主循环每帧调用，内部按 0.12s 节流，避免每帧重排 DOM */
  refresh(dt: number): void {
    if (!this.active) return;
    this.acc += dt;
    if (this.acc < 0.12) return;
    this.acc = 0;

    this.rebuildEditorIfNeeded();
    this.refreshLibraries();
    this.refreshToolButtons();
    this.refreshRhythm();
    this.refreshHint();
    this.refreshLiveHp();
    this.refreshStats();
  }

  private refreshLibraries(): void {
    const armed = this.session.armed;
    for (const btn of this.libButtons) {
      const kind = btn.dataset.kind === "human" ? "human" : "zombie";
      const id = btn.dataset.id ?? "";
      btn.classList.toggle(
        "active",
        armed !== null && armed.kind === kind && armed.id === id,
      );
    }
  }

  private refreshToolButtons(): void {
    const armed = this.session.armed;
    this.selectBtn.classList.toggle("active", this.session.tool === "select" && armed === null);
    this.deleteBtn.classList.toggle("active", this.session.tool === "delete");
  }

  private refreshRhythm(): void {
    this.pauseBtn.textContent = this.session.paused ? "▶ 继续" : "⏸ 暂停";
    this.pauseBtn.classList.toggle("active", this.session.paused);
    this.slowBtn.classList.toggle("active", this.session.speed === 0.25 && !this.session.paused);
    this.normalBtn.classList.toggle("active", this.session.speed === 1 && !this.session.paused);
    this.rhythmHintEl.textContent = this.session.paused
      ? "已暂停 · 可点「单步」前进 1/60 秒"
      : this.session.speed === 0.25
        ? "0.25x 慢放 · 观察弹道与命中"
        : "1x 正常运行";
  }

  private refreshHint(): void {
    const armed = this.session.armed;
    if (armed) {
      const list = armed.kind === "zombie" ? TRAIN_ZOMBIE_TYPES : TRAIN_HUMAN_TYPES;
      const name = list.find((t) => t.id === armed.id)?.name ?? armed.id;
      this.hintEl.textContent = `已选「${name}」：点击战场空地连续生成（再次点类型可换）`;
      return;
    }
    if (this.session.tool === "delete") {
      this.hintEl.textContent = "删除模式：点击战场上的单位删除它";
      return;
    }
    this.hintEl.textContent = "点击战场上的单位选中并编辑；先点上方类型再点空地生成";
  }

  // ============================================================
  // 选中单位编辑器
  // ============================================================

  private rebuildEditorIfNeeded(): void {
    const sel = this.session.getSelected();
    const key = sel
      ? sel.kind === "human"
        ? `h:${sel.human.id}`
        : `z:${sel.zombie.id}`
      : "";
    if (key === this.editorKey) return;
    this.editorKey = key;

    if (!sel) {
      this.editorEl.innerHTML =
        '<div class="tp-empty">未选中单位。点击战场单位，或从上方单位库选类型后生成。</div>';
      return;
    }

    if (sel.kind === "zombie") this.buildZombieEditor(sel);
    else this.buildHumanEditor(sel.human);
  }

  private buildZombieEditor(sel: Extract<SelectedUnit, { kind: "zombie" }>): void {
    const z = sel.zombie;
    const def = getZombieDef(z.kind);
    const maxHp = Math.round(z.maxHp ?? z.hp);
    const bite = z.biteCycle ?? def.bite;

    this.editorEl.innerHTML = `
      <div class="tp-unit-head">
        <span class="tp-unit-name" style="color:${hexColor(def.color)}">${def.name}</span>
        <span class="tp-chip">僵尸 #${z.id}</span>
        <span class="tp-chip tp-live" id="tpLiveHp"></span>
      </div>
      ${sliderRow("血量", "tpZombieHp", maxHp, 1, 1000, 5)}
      ${sliderRow("移动速度", "tpZombieSpeed", Math.round(z.speed), 5, 200, 1)}
      ${sliderRow("撕咬间隔", "tpZombieBite", bite, 0.1, 3, 0.05, 2)}
      ${sliderRow("攻击力", "tpZombieDamage", Math.round(z.damage), 1, 100, 1)}
      <div class="tp-hint">撕咬间隔越小，啃人/拆门窗越快；攻击力只影响咬人掉血</div>
      <button class="tp-del" id="tpDeleteUnit">删除该单位</button>
    `;

    const bind = (id: string, apply: (v: number) => void, digits = 0): void => {
      const input = document.getElementById(id) as HTMLInputElement;
      const val = document.getElementById(`${id}Val`) as HTMLSpanElement;
      input.oninput = () => {
        const v = Number(input.value);
        apply(v);
        val.textContent = fmt(v, digits);
      };
    };
    bind("tpZombieHp", (v) => this.session.setZombieHp(z, v));
    bind("tpZombieSpeed", (v) => {
      z.speed = v;
    });
    bind("tpZombieBite", (v) => {
      z.biteCycle = v;
    }, 2);
    bind("tpZombieDamage", (v) => {
      z.damage = v;
    });

    (document.getElementById("tpDeleteUnit") as HTMLButtonElement).onclick = () => {
      this.session.deleteSelected();
      this.editorKey = "";
      this.refresh(1);
    };
  }

  private buildHumanEditor(h: Human): void {
    const def = getWeaponDef(h.weapon);
    const speed = Math.round(h.speedOverride ?? settings().human.speed);
    const sight = Math.round(h.sightOverride ?? settings().human.sight);
    const dmgMul = h.dmgMul ?? 1;
    const cdMul = h.cdMul ?? 1;
    const maxHp = Math.round(h.maxHp ?? h.hp);

    const weaponOptions = WEAPON_LIST.map(
      (w) => `<option value="${w.id}" ${w.id === h.weapon ? "selected" : ""}>${w.name}</option>`,
    ).join("");

    this.editorEl.innerHTML = `
      <div class="tp-unit-head">
        <span class="tp-unit-name" style="color:${hexColor(def.color)}">${def.name}</span>
        <span class="tp-chip">人类 #${h.id}</span>
        <span class="tp-chip tp-live" id="tpLiveHp"></span>
      </div>
      <div class="tp-row">
        <label for="tpHumanWeapon">武器</label>
        <select id="tpHumanWeapon" class="tp-select">${weaponOptions}</select>
        <span class="tp-val">切换</span>
      </div>
      ${sliderRow("血量", "tpHumanHp", maxHp, 1, 500, 5)}
      ${sliderRow("移动速度", "tpHumanSpeed", speed, 10, 150, 1)}
      ${sliderRow("视野", "tpHumanSight", sight, 100, 900, 10)}
      ${sliderRow("伤害倍率", "tpHumanDmg", dmgMul, 0.2, 5, 0.05, 2)}
      ${sliderRow("射速倍率", "tpHumanCd", cdMul, 0.2, 5, 0.05, 2)}
      <label class="tp-check">
        <input type="checkbox" id="tpHumanInvincible" ${h.invincible ? "checked" : ""} />
        无敌（免疫撕咬掉血与异变）
      </label>
      <button class="tp-del" id="tpDeleteUnit">删除该单位</button>
    `;

    const weaponSelect = document.getElementById("tpHumanWeapon") as HTMLSelectElement;
    weaponSelect.onchange = () => {
      this.session.setHumanWeapon(h, weaponSelect.value);
      this.editorKey = "";
      this.refresh(1);
    };

    const bind = (id: string, apply: (v: number) => void, digits = 0): void => {
      const input = document.getElementById(id) as HTMLInputElement;
      const val = document.getElementById(`${id}Val`) as HTMLSpanElement;
      input.oninput = () => {
        const v = Number(input.value);
        apply(v);
        val.textContent = fmt(v, digits);
      };
    };
    bind("tpHumanHp", (v) => this.session.setHumanHp(h, v));
    bind("tpHumanSpeed", (v) => {
      h.speedOverride = v;
    });
    bind("tpHumanSight", (v) => {
      h.sightOverride = v;
    });
    bind("tpHumanDmg", (v) => {
      h.dmgMul = v;
    }, 2);
    bind("tpHumanCd", (v) => {
      h.cdMul = v;
    }, 2);

    const inv = document.getElementById("tpHumanInvincible") as HTMLInputElement;
    inv.onchange = () => {
      h.invincible = inv.checked;
    };

    (document.getElementById("tpDeleteUnit") as HTMLButtonElement).onclick = () => {
      this.session.deleteSelected();
      this.editorKey = "";
      this.refresh(1);
    };
  }

  /** 单独刷新血量读数（滑块不回写，避免和拖拽冲突） */
  private refreshLiveHp(): void {
    const live = document.getElementById("tpLiveHp");
    if (!live) return;
    const sel = this.session.getSelected();
    if (!sel) return;
    if (sel.kind === "zombie") {
      const z: Zombie = sel.zombie;
      live.textContent = `HP ${Math.max(0, Math.ceil(z.hp))} / ${Math.round(z.maxHp ?? z.hp)}`;
    } else {
      const h: Human = sel.human;
      live.textContent = `HP ${Math.round(h.hp)} / ${Math.round(h.maxHp ?? h.hp)}`;
    }
  }

  // ============================================================
  // 读数面板
  // ============================================================

  private refreshStats(): void {
    const counts = this.session.countUnits();
    const aliveByKind = new Map<string, number>();
    for (const z of this.session.world.zombies) {
      aliveByKind.set(z.kind, (aliveByKind.get(z.kind) ?? 0) + 1);
    }

    const weaponRows = WEAPON_LIST.map((w) => {
      const s = this.session.weaponStat(w.id);
      return `<tr>
        <td><span class="tp-dot" style="background:${hexColor(w.color)}"></span>${w.name}</td>
        <td>${Math.round(s.damage)}</td>
        <td>${fmt(this.session.averageDps(w.id), 1)}</td>
        <td class="tp-hot">${fmt(this.session.recentDps(w.id), 1)}</td>
        <td>${s.kills}</td>
        <td>${fmtTtk(s.ttkSum, s.ttkCount)}</td>
      </tr>`;
    }).join("");

    const zombieRows = ZOMBIE_LIST.map((d) => {
      const s = this.session.zombieStat(d.id);
      return `<tr>
        <td><span class="tp-dot" style="background:${hexColor(d.color)}"></span>${d.name}</td>
        <td>${aliveByKind.get(d.id) ?? 0}</td>
        <td>${Math.round(s.damage)}</td>
        <td>${s.kills}</td>
        <td>${fmtTtk(s.ttkSum, s.ttkCount)}</td>
      </tr>`;
    }).join("");

    const hs = this.session.humanStat;
    const ts = this.session.teslaStat;
    const teslaAvg = ts.volleys > 0 ? ts.hits / ts.volleys : 0;
    this.statsEl.innerHTML = `
      <div class="tp-statline">
        ⏱ ${fmtTime(this.session.activeTime)} · 人类 ${counts.humans} · 僵尸 ${counts.zombies} · 击杀 ${this.session.totalKills()}
      </div>
      <div class="tp-statline">
        🩸 人类被咬 ${hs.bites} 次 · 掉血 ${Math.round(hs.damage)} · 异变 ${hs.turns}
      </div>
      <div class="tp-statline">
        ⚡ 电击枪放电 ${ts.volleys} 次 · 命中 ${ts.hits} 只 · 平均 ${teslaAvg.toFixed(2)} 只/次 · 单体加成 ${ts.singleBonus} 次
      </div>
      <table class="tp-table">
        <thead><tr><th>武器</th><th>总伤</th><th>DPS</th><th>近4s</th><th>击杀</th><th>均杀</th></tr></thead>
        <tbody>${weaponRows}</tbody>
      </table>
      <table class="tp-table">
        <thead><tr><th>僵尸类型</th><th>存活</th><th>承伤</th><th>击杀</th><th>均杀</th></tr></thead>
        <tbody>${zombieRows}</tbody>
      </table>
      <div class="tp-hint">武器表与「承伤」统计人类对僵尸造成的伤害；「人类被咬 / 掉血 / 异变」是僵尸对人类的反向读数，两者不混算。DPS = 累计伤害 / 运行时间，「近4s」是最近 4 秒滚动窗口。电击枪单独按「每次放电」计口径：平均命中 = 命中数 / 放电次数，单体加成 = 首个目标 96px 内没有其他僵尸时的 ×2.2 加成</div>
    `;
  }
}
