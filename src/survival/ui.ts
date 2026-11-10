/**
 * 「尸潮求生」DOM UI：选图页、局内 HUD、升级三选一、失败结算。
 * 不持有游戏状态，所有数据从 SurvivalSession 读取；样式沿用深色紫色调。
 */
import { isDevModeEnabled } from "../core/devMode";
import type { SurvivalUpgradeDef } from "../data/survival/config";
import { getWeaponDef } from "../data/weapons";
import type { SurvivalSession } from "./session";

/** 二段选武器时展示的一句话说明（名称 / 颜色来自武器定义） */
const WEAPON_DESC: Record<string, string> = {
  mg: "高射速直线弹道",
  flame: "持续喷射，锥形灼烧",
  shotgun: "一次多颗弹丸，近距离爆发",
  rocket: "范围爆炸伤害",
  tesla: "链式电弧，单体目标强化",
};

export interface SurvivalMapOption {
  id: string;
  name: string;
  readOnly: boolean;
}

interface SurvivalUiCallbacks {
  onStart(mapId: string): void;
  onUpgrade(id: string): void;
  onWeaponPick(id: string): void;
  onReplay(): void;
  onMenu(): void;
  onWorkshop(): void;
  /** 暂停菜单：继续 / 重开 / 退出（退出不结算） */
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
}

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

export function formatSurvivalTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export class SurvivalUi {
  private selectEl = document.getElementById("survivalSelect") as HTMLElement;
  private mapListEl = document.getElementById("survivalMapList") as HTMLElement;
  private recordLineEl = document.getElementById("survivalRecordLine") as HTMLElement;
  private startBtn = document.getElementById("btnSurvivalStart") as HTMLButtonElement;
  private workshopBtn = document.getElementById("btnSurvivalWorkshop") as HTMLButtonElement;

  private hudEl = document.getElementById("survivalHud") as HTMLElement;
  private hpFill = document.getElementById("svHpFill") as HTMLElement;
  private hpText = document.getElementById("svHpText") as HTMLElement;
  private xpFill = document.getElementById("svXpFill") as HTMLElement;
  private xpText = document.getElementById("svXpText") as HTMLElement;
  private levelEl = document.getElementById("svLevel") as HTMLElement;
  private timeEl = document.getElementById("svTime") as HTMLElement;
  private killsEl = document.getElementById("svKills") as HTMLElement;
  private tierEl = document.getElementById("svTier") as HTMLElement;
  private pauseEl = document.getElementById("survivalPause") as HTMLElement;
  private reloadEl = document.getElementById("svReload") as HTMLElement;
  private reloadFill = document.getElementById("svReloadFill") as HTMLElement;
  private reloadText = document.getElementById("svReloadText") as HTMLElement;
  private weaponsEl = document.getElementById("svWeapons") as HTMLElement;

  private upgradeEl = document.getElementById("survivalUpgrade") as HTMLElement;
  private upgradeSubtitleEl = document.getElementById("survivalUpgradeSubtitle") as HTMLElement;
  private upgradeCardsEl = document.getElementById("survivalUpgradeCards") as HTMLElement;
  private defeatEl = document.getElementById("survivalDefeat") as HTMLElement;
  private defeatStatsEl = document.getElementById("survivalDefeatStats") as HTMLElement;
  private defeatBestEl = document.getElementById("survivalDefeatBest") as HTMLElement;

  private maps: SurvivalMapOption[] = [];
  private selectedMapId = "";
  private lastChoicesKey = "";
  private lastWeaponsKey = "";
  private lastDefeatKey = "";

  constructor(private readonly session: SurvivalSession, cbs: SurvivalUiCallbacks) {
    document.getElementById("btnSurvivalBack")?.addEventListener("click", () => cbs.onMenu());
    document.getElementById("btnSurvivalMenu")?.addEventListener("click", () => cbs.onMenu());
    document.getElementById("btnSurvivalReplay")?.addEventListener("click", () => cbs.onReplay());
    document.getElementById("btnSurvivalResume")?.addEventListener("click", () => cbs.onResume());
    document.getElementById("btnSurvivalRestart")?.addEventListener("click", () => cbs.onRestart());
    document.getElementById("btnSurvivalQuit")?.addEventListener("click", () => cbs.onQuit());
    this.workshopBtn.addEventListener("click", () => cbs.onWorkshop());
    this.startBtn.addEventListener("click", () => {
      if (this.selectedMapId) cbs.onStart(this.selectedMapId);
    });

    this.mapListEl.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>("[data-map-id]");
      if (!row) return;
      this.selectedMapId = row.dataset.mapId ?? "";
      this.renderMaps();
    });

    this.upgradeCardsEl.addEventListener("click", (e) => {
      const weapon = (e.target as HTMLElement).closest<HTMLElement>("[data-weapon-id]");
      if (weapon) {
        const id = weapon.dataset.weaponId;
        if (id) cbs.onWeaponPick(id);
        return;
      }
      const card = (e.target as HTMLElement).closest<HTMLElement>("[data-upgrade-id]");
      if (!card) return;
      const id = card.dataset.upgradeId;
      if (id) cbs.onUpgrade(id);
    });
  }

  /** 进入 /survival 时展示选图页 */
  showSelect(maps: SurvivalMapOption[], defaultId: string): void {
    this.maps = maps;
    this.selectedMapId = this.maps.some((m) => m.id === defaultId)
      ? defaultId
      : (this.maps[0]?.id ?? "");
    this.renderMaps();

    const rec = this.session.record;
    this.recordLineEl.textContent =
      rec.bestTime > 0 || rec.bestLevel > 0
        ? `最佳存活 ${formatSurvivalTime(rec.bestTime)} · 最高等级 Lv ${rec.bestLevel}`
        : "还没有记录，活过第一分钟吧";
    this.workshopBtn.classList.toggle("hidden", !isDevModeEnabled());

    this.defeatEl.classList.add("hidden");
    this.defeatEl.classList.remove("active");
    this.upgradeEl.classList.add("hidden");
    this.upgradeEl.classList.remove("active");
    this.pauseEl.classList.add("hidden");
    this.pauseEl.classList.remove("active");
    this.hudEl.classList.add("hidden");
    this.selectEl.classList.remove("hidden");
    // 下一帧再激活，让 CSS opacity 过渡生效
    requestAnimationFrame(() => this.selectEl.classList.add("active"));
  }

  /** 开始 / 重开后进入局内 */
  showGame(): void {
    this.selectEl.classList.remove("active");
    this.selectEl.classList.add("hidden");
    this.upgradeEl.classList.add("hidden");
    this.upgradeEl.classList.remove("active");
    this.defeatEl.classList.add("hidden");
    this.defeatEl.classList.remove("active");
    this.pauseEl.classList.add("hidden");
    this.pauseEl.classList.remove("active");
    this.lastChoicesKey = "";
    this.lastWeaponsKey = "";
    this.lastDefeatKey = "";
    this.hudEl.classList.remove("hidden");
  }

  /** 离开路由时全隐藏 */
  hideAll(): void {
    this.selectEl.classList.remove("active");
    this.selectEl.classList.add("hidden");
    this.upgradeEl.classList.remove("active");
    this.upgradeEl.classList.add("hidden");
    this.defeatEl.classList.remove("active");
    this.defeatEl.classList.add("hidden");
    this.pauseEl.classList.remove("active");
    this.pauseEl.classList.add("hidden");
    this.hudEl.classList.add("hidden");
  }

  /** 开发者模式开关变化时同步工坊入口 */
  refreshDevMode(): void {
    this.workshopBtn.classList.toggle("hidden", !isDevModeEnabled());
  }

  /** 每帧同步 HUD 与状态弹层（只在 survival 路由调用） */
  sync(): void {
    const s = this.session;
    if (s.state === "idle") return;
    this.hudEl.classList.remove("hidden");

    const hp = Math.max(0, s.hp);
    const maxHp = Math.max(1, s.maxHp);
    this.hpFill.style.width = `${(hp / maxHp) * 100}%`;
    this.hpText.textContent = `${Math.ceil(hp)} / ${Math.round(maxHp)}`;

    const xpNeed = Math.max(1, s.xpNeed);
    this.xpFill.style.width = `${(s.xp / xpNeed) * 100}%`;
    this.xpText.textContent = `${Math.floor(s.xp)} / ${xpNeed}`;
    this.levelEl.textContent = s.level.toString();

    this.timeEl.textContent = formatSurvivalTime(s.elapsed);
    this.killsEl.textContent = `击杀 ${s.kills}`;
    this.tierEl.textContent = `强度 ${s.tier + 1}`;
    if (s.state === "paused") {
      this.pauseEl.classList.remove("hidden");
      this.pauseEl.classList.add("active");
    } else if (!this.pauseEl.classList.contains("hidden")) {
      this.pauseEl.classList.remove("active");
      this.pauseEl.classList.add("hidden");
    }

    // 武器栏：主武器 + 副武器（双持时用色块图标列出第二把）
    const weaponsKey = s.weapons.join(",");
    if (weaponsKey !== this.lastWeaponsKey) {
      this.lastWeaponsKey = weaponsKey;
      this.renderWeapons(s.weapons);
    }

    // 换弹：只在换弹期间出现，进度按剩余时间反推
    const reload = s.reload;
    if (reload) {
      const p = Math.max(0, Math.min(1, 1 - reload.remaining / reload.total));
      this.reloadEl.classList.remove("hidden");
      this.reloadFill.style.width = `${p * 100}%`;
      this.reloadText.textContent = `换弹中 ${reload.remaining.toFixed(1)}s`;
    } else {
      this.reloadEl.classList.add("hidden");
    }

    if (s.state === "choosing") {
      if (s.weaponPicks.length > 0) {
        // 二段武器选择：展示全部未持有武器
        const key = `w|${s.weaponPicks.join(",")}`;
        if (key !== this.lastChoicesKey) {
          this.lastChoicesKey = key;
          this.renderWeaponPicks(s.weaponPicks);
        }
      } else {
        // 带上抽卡序号：即使两次抽到的 id 与顺序完全一样，也按新一轮重新渲染
        const key = `${s.choiceSeq}|${s.choices.map((c) => c.id).join(",")}`;
        if (key !== this.lastChoicesKey) {
          this.lastChoicesKey = key;
          this.renderUpgradeChoices(s.choices);
        }
      }
      this.upgradeEl.classList.remove("hidden");
      requestAnimationFrame(() => this.upgradeEl.classList.add("active"));
    } else if (!this.upgradeEl.classList.contains("hidden")) {
      this.upgradeEl.classList.remove("active");
      this.upgradeEl.classList.add("hidden");
    }

    if (s.state === "defeat") {
      const key = `${s.elapsed}|${s.level}|${s.kills}|${s.record.bestTime}|${s.record.bestLevel}`;
      if (key !== this.lastDefeatKey) {
        this.lastDefeatKey = key;
        this.defeatStatsEl.textContent = `存活 ${formatSurvivalTime(s.elapsed)} · 等级 Lv ${s.level} · 击杀 ${s.kills}`;
        this.defeatBestEl.textContent = `最佳存活 ${formatSurvivalTime(s.record.bestTime)} · 最高等级 Lv ${s.record.bestLevel}`;
      }
      this.defeatEl.classList.remove("hidden");
      requestAnimationFrame(() => this.defeatEl.classList.add("active"));
    }
  }

  private renderMaps(): void {
    const html = this.maps
      .map((m) => {
        const selected = m.id === this.selectedMapId ? " selected" : "";
        const tag = m.readOnly ? '<span class="sv-map-tag">内置</span>' : '<span class="sv-map-tag workshop">工坊</span>';
        return `<button class="sv-map-row${selected}" data-map-id="${escapeHtml(m.id)}">
          <span class="sv-map-name">${escapeHtml(m.name)}</span>
          ${tag}
        </button>`;
      })
      .join("");
    this.mapListEl.innerHTML = html;
    this.startBtn.disabled = !this.selectedMapId;
  }

  /** HUD 武器栏：主武器在前，副武器带「副」标记与自己的颜色图标 */
  private renderWeapons(ids: string[]): void {
    this.weaponsEl.innerHTML = ids
      .map((id, i) => {
        const def = getWeaponDef(id);
        const color = `#${def.color.toString(16).padStart(6, "0")}`;
        return `<span class="sv-weapon${i > 0 ? " secondary" : ""}">
          <span class="sv-weapon-dot" style="background:${color}"></span>
          <span class="sv-weapon-name">${escapeHtml(def.name)}</span>
          ${i > 0 ? '<span class="sv-weapon-tag">副</span>' : ""}
        </span>`;
      })
      .join("");
  }

  /** 二段选武器：用与三选一相同的卡片样式，点击装备为副武器 */
  private renderWeaponPicks(ids: string[]): void {
    this.upgradeSubtitleEl.textContent = `选择一把武器作为副武器（数字键 1–${ids.length} 也可选择）`;
    this.upgradeCardsEl.innerHTML = ids
      .map((id, i) => {
        const def = getWeaponDef(id);
        const color = `#${def.color.toString(16).padStart(6, "0")}`;
        return `<button class="sv-upgrade-card" data-weapon-id="${escapeHtml(id)}">
          <span class="sv-upgrade-index">${i + 1}</span>
          <span class="sv-upgrade-name"><span class="sv-weapon-dot" style="background:${color}"></span>${escapeHtml(def.name)}</span>
          <span class="sv-upgrade-desc">${escapeHtml(WEAPON_DESC[id] ?? "新武器")}</span>
        </button>`;
      })
      .join("");
  }

  private renderUpgradeChoices(choices: SurvivalUpgradeDef[]): void {
    this.upgradeSubtitleEl.textContent = `选择一项强化（数字键 1–${choices.length} 也可选择）`;
    this.upgradeCardsEl.innerHTML = choices
      .map(
        (c, i) => `<button class="sv-upgrade-card" data-upgrade-id="${escapeHtml(c.id)}">
          <span class="sv-upgrade-index">${i + 1}</span>
          <span class="sv-upgrade-name">${escapeHtml(c.name)}</span>
          <span class="sv-upgrade-desc">${escapeHtml(c.desc)}</span>
        </button>`,
      )
      .join("");
  }
}
