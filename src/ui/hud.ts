/**
 * HUD —— 用 DOM 覆盖在画布上显示战况，比在引擎里画文字简单得多。
 *
 * 顶栏：兵种配比 VS 本波尸潮总数
 * 底栏：各兵种存活数 / 人类·僵尸总数 / 波次 / 两条进度条
 *
 * 每 0.1 秒刷新一次文本，避免每帧操作 DOM。
 */
import { WEAPON_LIST } from "../data/weapons";
import type { Game } from "../core/game";

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node;
}

export class Hud {
  private lineup = el("lineup");
  private subbar = el("subbar");
  private humanCount = el("humanCount");
  private zombieCount = el("zombieCount");
  private humanBar = el("humanBar");
  private zombieBar = el("zombieBar");
  private waveLabel = el("waveLabel");
  private phaseLabel = el("phaseLabel");
  private accum = 0;

  constructor(private game: Game) {
    // 顶栏：关卡名 VS 本波尸潮总数
    this.lineup.innerHTML =
      '<span class="unit">关卡 <b id="hudLevelName">—</b></span>' +
      '<span class="vs">VS</span><span class="total" id="waveTotal">0</span> 尸潮';

    // 底栏兵种计数容器（按注册表生成，新增武器自动出现）
    let sub = "";
    for (const def of WEAPON_LIST) {
      sub += `<span class="item">${def.name}<b id="wk-${def.id}">0</b></span>`;
    }
    this.subbar.innerHTML = sub;
  }

  /** 刷新显示，内部做 0.1s 节流 */
  update(dt: number): void {
    this.accum += dt;
    if (this.accum < 0.1) return;
    this.accum = 0;

    const g = this.game;
    const humans = g.world.humans.length;
    const zombies = g.world.zombies.length;
    const byWeapon = g.aliveByWeapon();

    this.humanCount.textContent = String(humans);
    this.zombieCount.textContent = String(zombies);
    this.waveLabel.textContent =
      g.phase === "prepare"
        ? `准备阶段 · 共 ${g.waveCount} 波`
        : `第 ${Math.max(1, g.wave)}/${g.waveCount} 波`;
    const levelName = document.getElementById("hudLevelName");
    if (levelName) levelName.textContent = g.levelName || "未选择关卡";

    for (const def of WEAPON_LIST) {
      const node = document.getElementById(`wk-${def.id}`);
      if (node) node.textContent = String(byWeapon.get(def.id) ?? 0);
    }
    const total = document.getElementById("waveTotal");
    if (total) total.textContent = String(g.waveSize);

    let phase = "";
    if (g.paused) phase = "已暂停";
    else if (g.phase === "prepare") phase = g.placedAny ? "点击开始迎战" : "点击人类区放置人类";
    else if (g.phase === "victory") phase = "人类胜利";
    else if (g.phase === "defeat") phase = "人类全灭";
    else if (g.phase === "intermission") phase = "准备下一波";
    this.phaseLabel.textContent = phase;

    const hp = Math.min(100, (humans / Math.max(1, g.placedTotal)) * 100);
    this.humanBar.style.width = `${hp}%`;
    const zp = Math.min(100, (zombies / Math.max(1, g.waveSize)) * 100);
    this.zombieBar.style.width = `${zp}%`;
  }
}
