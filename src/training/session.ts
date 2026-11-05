/**
 * 训练场会话 —— 一个完全独立的沙盒 World。
 *
 * 设计原则：不复制任何玩法逻辑。
 *  - 单位生成 / AI / 弹道 / 伤害全部走现有的 World + systems/ai + systems/combat
 *  - 这里只负责「编辑操作」「统计」「固定步长推进」三件事
 *  - 编辑只写单位自身的可选覆盖字段（Human.speedOverride 等），
 *    永远不修改全局 SETTINGS / WEAPONS，退出训练场即丢弃整个 World
 *
 * 统计通过 World.onDamage / World.onKill 两个钩子采集：
 *  - 伤害按武器下标聚合，得到每个武器的累计伤害、DPS、最近 4 秒 DPS
 *  - 击杀按僵尸类型 + 武器聚合，并记录「从出生到死亡」的击杀耗时
 */
import { HUMAN_BOUNDS, WEAPONS, WORLD, ZOMBIE_DEFS } from "../config";
import { World } from "../core/world";
import type { DamageSource, Human, Zombie } from "../core/world";
import { updateHumans, updateZombies } from "../systems/ai";
import { updateCombat } from "../systems/combat";
import { clamp, dist2 } from "../utils/math";
import type { FloatingText } from "../render/renderer";

/** 逻辑固定步长（和正式对局一致：1/60 秒） */
export const STEP = 1 / 60;

export type TrainTool = "select" | "delete";
export type UnitKind = "human" | "zombie";

export interface ZombieOption {
  index: number;
  name: string;
  color: number;
  hp: number;
  speed: number;
}

export interface HumanOption {
  index: number;
  name: string;
  color: number;
  range: number;
  damage: number;
  cooldown: number;
}

/** 单位库：直接来自现有配置，新增僵尸/武器类型会自动出现在面板里 */
export const TRAIN_ZOMBIE_TYPES: ZombieOption[] = ZOMBIE_DEFS.map((d, index) => ({
  index,
  name: d.name,
  color: d.color,
  hp: d.hp,
  speed: d.speed,
}));

export const TRAIN_HUMAN_TYPES: HumanOption[] = WEAPONS.map((w, index) => ({
  index,
  name: w.name,
  color: w.color,
  range: w.range,
  damage: w.damage,
  cooldown: w.cooldown,
}));

export interface WeaponStat {
  damage: number;
  hits: number;
  kills: number;
  ttkSum: number;
  ttkCount: number;
}

export interface ZombieTypeStat {
  damage: number;
  kills: number;
  ttkSum: number;
  ttkCount: number;
  spawns: number;
}

/** 面板需要区分人类 / 僵尸，用判别联合避免类型断言 */
export type SelectedUnit =
  | { kind: "human"; human: Human }
  | { kind: "zombie"; zombie: Zombie };

/** 最近 DPS 的时间窗：8 个 0.5 秒槽 = 4 秒 */
const BUCKET_SEC = 0.5;
const BUCKET_SLOTS = 8;
const BUCKET_WINDOW = BUCKET_SEC * BUCKET_SLOTS;

/** 飘字数量上限，避免高射速 + 大量单位时 DOM/Text 对象爆掉 */
const MAX_FLOATERS = 160;

export class TrainingSession {
  world = new World();
  paused = false;
  /** 速度倍率：1 = 正常，0.25 = 慢放 */
  speed = 1;
  /** 累计运行时间（秒，不含暂停），统计时间窗与击杀耗时都以它为基准 */
  activeTime = 0;

  selectedId: number | null = null;
  selectedKind: UnitKind | null = null;

  /** 当前待生成的单位类型；非 null 时点画布 = 生成 */
  armed: { kind: UnitKind; index: number } | null = null;
  /** select = 点选编辑，delete = 点单位删除 */
  tool: TrainTool = "select";

  readonly floaters: FloatingText[] = [];
  readonly weaponStats: WeaponStat[] = WEAPONS.map(() => ({
    damage: 0,
    hits: 0,
    kills: 0,
    ttkSum: 0,
    ttkCount: 0,
  }));
  readonly zombieStats: ZombieTypeStat[] = ZOMBIE_DEFS.map(() => ({
    damage: 0,
    kills: 0,
    ttkSum: 0,
    ttkCount: 0,
    spawns: 0,
  }));

  /** 每个丧尸的出生时间（训练场生成 / 波次生成都记），用于算击杀耗时 */
  private spawnTimes = new Map<number, number>();
  private stepPending = false;
  private acc = 0;
  private buckets: number[][] = WEAPONS.map(() => new Array(BUCKET_SLOTS).fill(0));
  private stamps: number[][] = WEAPONS.map(() => new Array(BUCKET_SLOTS).fill(-1));

  constructor() {
    this.installHooks();
  }

  /** 每次进入训练场都重置：新的空 World + 清零的统计，退出即丢弃 */
  reset(): void {
    this.world = new World();
    this.installHooks();
    this.paused = false;
    this.speed = 1;
    this.stepPending = false;
    this.acc = 0;
    this.selectedId = null;
    this.selectedKind = null;
    this.armed = null;
    this.tool = "select";
    this.spawnTimes.clear();
    this.resetReadings();
  }

  /** 只重置读数，不清单位（方便比较同一批单位的另一组武器） */
  resetReadings(): void {
    this.activeTime = 0;
    this.floaters.length = 0;
    for (const s of this.weaponStats) {
      s.damage = 0;
      s.hits = 0;
      s.kills = 0;
      s.ttkSum = 0;
      s.ttkCount = 0;
    }
    for (const s of this.zombieStats) {
      s.damage = 0;
      s.kills = 0;
      s.ttkSum = 0;
      s.ttkCount = 0;
      s.spawns = 0;
    }
    for (const z of this.world.zombies) this.spawnTimes.set(z.id, 0);
    for (const b of this.buckets) b.fill(0);
    for (const s of this.stamps) s.fill(-1);
  }

  // ============================================================
  // 统计钩子（挂在 World 上，普通对局不会挂）
  // ============================================================

  private installHooks(): void {
    this.world.onDamage = (z, amount, source) => this.recordDamage(z, amount, source);
    this.world.onKill = (z, source) => this.recordKill(z, source);
  }

  private recordDamage(z: Zombie, amount: number, source?: DamageSource): void {
    if (amount <= 0) return;
    const typeStat = this.zombieStats[z.kind];
    typeStat.damage += amount;

    let color = 0xffffff;
    if (source && source.weapon >= 0 && source.weapon < this.weaponStats.length) {
      const ws = this.weaponStats[source.weapon];
      ws.damage += amount;
      ws.hits++;
      this.bucketAdd(source.weapon, amount);
      color = WEAPONS[source.weapon].color;
    }

    if (this.floaters.length < MAX_FLOATERS) {
      this.floaters.push({
        x: z.x + (Math.random() - 0.5) * 10,
        y: z.y - 8,
        text: String(Math.max(1, Math.round(amount))),
        color,
        age: 0,
        life: 0.55,
        vy: -34,
      });
    }
  }

  private recordKill(z: Zombie, source?: DamageSource): void {
    const typeStat = this.zombieStats[z.kind];
    typeStat.kills++;

    const bornAt = this.spawnTimes.get(z.id);
    if (bornAt !== undefined) {
      this.spawnTimes.delete(z.id);
      const ttk = Math.max(0, this.activeTime - bornAt);
      typeStat.ttkSum += ttk;
      typeStat.ttkCount++;
      if (source && source.weapon >= 0 && source.weapon < this.weaponStats.length) {
        const ws = this.weaponStats[source.weapon];
        ws.kills++;
        ws.ttkSum += ttk;
        ws.ttkCount++;
      }
    } else if (source && source.weapon >= 0 && source.weapon < this.weaponStats.length) {
      this.weaponStats[source.weapon].kills++;
    }
  }

  private bucketAdd(weapon: number, amount: number): void {
    const slot = Math.floor(this.activeTime / BUCKET_SEC);
    const idx = slot % BUCKET_SLOTS;
    if (this.stamps[weapon][idx] !== slot) {
      this.stamps[weapon][idx] = slot;
      this.buckets[weapon][idx] = 0;
    }
    this.buckets[weapon][idx] += amount;
  }

  /** 最近 4 秒的实时 DPS */
  recentDps(weapon: number): number {
    let sum = 0;
    for (const v of this.buckets[weapon]) sum += v;
    const window = Math.min(BUCKET_WINDOW, Math.max(0.5, this.activeTime));
    return sum / window;
  }

  /** 整个会话的平均 DPS */
  averageDps(weapon: number): number {
    return this.weaponStats[weapon].damage / Math.max(0.1, this.activeTime);
  }

  totalKills(): number {
    return this.zombieStats.reduce((acc, s) => acc + s.kills, 0);
  }

  // ============================================================
  // 时间推进：暂停 / 单步 / 慢放 都由 advance() 统一处理
  // ============================================================

  /** 请求前进固定一帧（会自动暂停，方便逐帧观察） */
  requestStep(): void {
    this.paused = true;
    this.stepPending = true;
  }

  /** 由主循环每帧调用，real 是真实经过的秒数 */
  advance(real: number): void {
    if (this.stepPending) {
      this.stepPending = false;
      this.tick(STEP);
      return;
    }
    if (this.paused) {
      this.acc = 0;
      return;
    }
    this.acc += real * this.speed;
    let steps = 0;
    while (this.acc >= STEP && steps < 15) {
      this.tick(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (this.acc > 0.5) this.acc = 0;
  }

  /** 和 Game.tick 相同的固定步长逻辑，只是去掉波次状态机 */
  tick(dt: number): void {
    this.activeTime += dt;
    this.world.time += dt;
    this.world.mode = "attack";

    this.world.rebuildGrids();
    updateHumans(this.world, dt);
    updateZombies(this.world, dt);
    updateCombat(this.world, dt);
    this.world.ageEffects(dt);
    this.world.compact();
    this.ageFloaters(dt);
    this.dropDeadSelection();
  }

  private ageFloaters(dt: number): void {
    let w = 0;
    for (let i = 0; i < this.floaters.length; i++) {
      const f = this.floaters[i];
      f.age += dt;
      f.y += f.vy * dt;
      if (f.age < f.life) this.floaters[w++] = f;
    }
    this.floaters.length = w;
  }

  private dropDeadSelection(): void {
    if (this.getSelected() === null) {
      this.selectedId = null;
      this.selectedKind = null;
    }
  }

  // ============================================================
  // 编辑操作
  // ============================================================

  /** 生成一只指定类型的丧尸；落在墙里返回 null */
  spawnZombie(kind: number, x: number, y: number): Zombie | null {
    const cx = clamp(x, 8, WORLD.width - 8);
    const cy = clamp(y, 8, WORLD.height - 8);
    if (this.world.solidAt(cx, cy, 3)) return null;
    const z = this.world.spawnZombie(cx, cy, kind === 1 ? 1 : 0);
    z.maxHp = z.hp;
    this.spawnTimes.set(z.id, this.activeTime);
    this.zombieStats[z.kind].spawns++;
    return z;
  }

  /** 生成一个指定武器的人类；人类的可行走范围会被夹到房间内 */
  spawnHuman(weapon: number, x: number, y: number): Human {
    const cx = clamp(x, HUMAN_BOUNDS.x0, HUMAN_BOUNDS.x1);
    const cy = clamp(y, HUMAN_BOUNDS.y0, HUMAN_BOUNDS.y1);
    const h = this.world.spawnHuman(cx, cy, weapon);
    h.post = -1;
    return h;
  }

  /** 画布点击的统一入口：按当前工具决定生成 / 删除 / 选中 */
  handleClick(x: number, y: number): boolean {
    if (this.armed) {
      if (this.armed.kind === "zombie") return this.spawnZombie(this.armed.index, x, y) !== null;
      this.spawnHuman(this.armed.index, x, y);
      return true;
    }
    if (this.tool === "delete") {
      return this.deleteAt(x, y);
    }
    return this.selectAt(x, y);
  }

  selectAt(x: number, y: number, radius = 24): boolean {
    const hit = this.nearestUnit(x, y, radius);
    if (!hit) {
      this.selectedId = null;
      this.selectedKind = null;
      return false;
    }
    this.selectedId = hit.unit.id;
    this.selectedKind = hit.kind;
    return true;
  }

  deleteAt(x: number, y: number, radius = 24): boolean {
    const hit = this.nearestUnit(x, y, radius);
    if (!hit) return false;
    this.removeUnit(hit.kind, hit.unit.id);
    return true;
  }

  deleteSelected(): boolean {
    if (this.selectedId === null || this.selectedKind === null) return false;
    return this.removeUnit(this.selectedKind, this.selectedId);
  }

  private removeUnit(kind: UnitKind, id: number): boolean {
    const arr = kind === "human" ? this.world.humans : this.world.zombies;
    const idx = arr.findIndex((u) => u.id === id);
    if (idx < 0) return false;
    arr.splice(idx, 1);
    this.spawnTimes.delete(id);
    if (this.selectedId === id) {
      this.selectedId = null;
      this.selectedKind = null;
    }
    return true;
  }

  /** 清场：一键清空所有单位、弹道、特效与飘字 */
  clearUnits(): void {
    this.world.humans.length = 0;
    this.world.zombies.length = 0;
    this.world.bullets.length = 0;
    this.world.effects.length = 0;
    this.floaters.length = 0;
    this.spawnTimes.clear();
    this.selectedId = null;
    this.selectedKind = null;
  }

  private nearestUnit(
    x: number,
    y: number,
    radius: number,
  ): { kind: UnitKind; unit: Human | Zombie } | null {
    const r2 = radius * radius;
    let best: { kind: UnitKind; unit: Human | Zombie } | null = null;
    let bestD = r2;
    for (const h of this.world.humans) {
      const d = dist2(x, y, h.x, h.y);
      if (d <= bestD) {
        bestD = d;
        best = { kind: "human", unit: h };
      }
    }
    for (const z of this.world.zombies) {
      const d = dist2(x, y, z.x, z.y);
      if (d <= bestD) {
        bestD = d;
        best = { kind: "zombie", unit: z };
      }
    }
    return best;
  }

  getSelected(): SelectedUnit | null {
    if (this.selectedId === null || this.selectedKind === null) return null;
    if (this.selectedKind === "human") {
      const h = this.world.humans.find((u) => u.id === this.selectedId);
      return h ? { kind: "human", human: h } : null;
    }
    const z = this.world.zombies.find((u) => u.id === this.selectedId);
    return z ? { kind: "zombie", zombie: z } : null;
  }

  /** 渲染层画选中框用 */
  selectionRing(): { x: number; y: number; radius: number } | null {
    const sel = this.getSelected();
    if (!sel) return null;
    if (sel.kind === "human") return { x: sel.human.x, y: sel.human.y, radius: 14 };
    return { x: sel.zombie.x, y: sel.zombie.y, radius: ZOMBIE_DEFS[sel.zombie.kind].radius + 10 };
  }

  // ============================================================
  // 单个单位的属性编辑
  // ============================================================

  setZombieHp(z: Zombie, hp: number): void {
    const v = Math.max(1, hp);
    z.maxHp = v;
    z.hp = v;
  }

  setHumanHp(h: Human, hp: number): void {
    const v = Math.max(1, hp);
    h.maxHp = v;
    h.hp = v;
  }

  /** 切换武器时把弹匣 / 冷却 / 喷火状态一并归位，避免弹药数量错位 */
  setHumanWeapon(h: Human, weapon: number): void {
    h.weapon = weapon;
    h.ammo = WEAPONS[weapon].magazine;
    h.reloadTimer = 0;
    h.fire = 0;
    h.burst = 0;
    h.target = null;
  }

  /** 面板显示用：当前存活的人类 / 丧尸数量 */
  countUnits(): { humans: number; zombies: number } {
    return { humans: this.world.humans.length, zombies: this.world.zombies.length };
  }
}
