/**
 * 放置模式的库存面板 —— 卡片式展示每种人类的库存 / 上限 / 恢复进度。
 *
 * 只读取 Game 的 inventory，不持有逻辑状态：
 *  - 点击卡片切换当前放置种类
 *  - 准备阶段显示「开始」按钮，点击后由 main.ts 调 game.beginBattle()
 *  - 每 0.1 秒刷新一次，避免每帧重排 DOM
 */
import type { Game } from "../core/game";
import { getWeaponDef } from "../data/weapons";

const WEAPON_ICONS: Record<string, string> = {
  mg: "🔫",
  flame: "🔥",
  shotgun: "💥",
  rocket: "🚀",
  tesla: "⚡",
};

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node;
}

export class InventoryPanel {
  private root = el("inventoryPanel");
  private cardsEl = el("invCards");
  private hintEl = el("invHint");
  private startBtn = el("btnPlacementStart") as HTMLButtonElement;
  private signature = "";
  private accum = 0;

  constructor(private game: Game, onStart: () => void) {
    this.startBtn.addEventListener("click", onStart);
    this.cardsEl.addEventListener("click", (ev) => {
      const card = (ev.target as HTMLElement).closest<HTMLElement>("[data-id]");
      if (!card) return;
      this.game.selectWeapon(card.dataset.id!);
      this.signature = "";
      this.update(0);
    });
  }

  show(): void {
    this.root.classList.remove("hidden");
    this.signature = "";
    this.update(0);
  }

  hide(): void {
    this.root.classList.add("hidden");
  }

  update(dt: number): void {
    this.accum += dt;
    if (this.accum < 0.1) return;
    this.accum = 0;
    if (this.root.classList.contains("hidden")) return;

    const g = this.game;
    const sig = [
      g.phase,
      g.selectedWeapon,
      g.placedAny,
      g.placedTotal,
      ...g.inventory.map((s) => `${s.id}:${s.stock}/${s.cap}:${Math.floor(s.timer * 10)}`),
    ].join("|");
    if (sig === this.signature) return;
    this.signature = sig;

    this.startBtn.classList.toggle("hidden", g.phase !== "prepare");

    let hint = "点击人类区空地放置人类";
    if (g.phase === "prepare") {
      hint = g.placedAny
        ? `已放置 ${g.placedTotal} 名 · 点击「开始」迎战 ${g.waveCount} 波尸潮`
        : "先在人类区放置至少 1 名人类，再点击开始";
    } else if (g.phase === "wave") {
      hint = `第 ${g.wave}/${g.waveCount} 波 · 可继续放置人类`;
    } else if (g.phase === "intermission") {
      hint = `下一波倒计时 ${Math.max(0, Math.ceil(g.countdown))} 秒 · 可继续放置人类`;
    } else if (g.phase === "victory") {
      hint = "所有波次已清除";
    } else if (g.phase === "defeat") {
      hint = "人类全灭";
    }
    this.hintEl.textContent = hint;

    let html = "";
    g.inventory.forEach((slot, index) => {
      const def = getWeaponDef(slot.id);
      const selected = slot.id === g.selectedWeapon;
      const empty = slot.stock <= 0;
      const progress = slot.stock >= slot.cap ? 0 : Math.min(1, slot.timer / slot.regen);
      html += `<button class="inv-card ${selected ? "selected" : ""} ${empty ? "empty" : ""}"
                       data-id="${slot.id}" title="${def.name} · 血量 ${slot.hp}">
        <span class="inv-key">${index + 1}</span>
        <span class="inv-icon">${WEAPON_ICONS[slot.id] ?? "🔫"}</span>
        <span class="inv-name">${def.name}</span>
        <span class="inv-stock">${slot.stock}<em> / ${slot.cap}</em></span>
        <span class="inv-progress"><i style="width:${(progress * 100).toFixed(1)}%"></i></span>
      </button>`;
    });
    this.cardsEl.innerHTML = html;
  }
}
