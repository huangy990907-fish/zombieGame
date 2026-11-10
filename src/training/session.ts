/**
 * 训练场会话 —— 一个完全独立的沙盒 World。
 *
 * 设计原则：不复制任何玩法逻辑。
 *  - 单位生成 / AI / 弹道 / 伤害全部走现有的 World + systems/ai + systems/combat
 *  - 这里只负责「编辑操作」「统计」「固定步长推进」三件事
 *  - 编辑只写单位自身的可选覆盖字段（Human.speedOverride 等），
 *    永远不修改全局设置 / 武器定义，退出训练场即丢弃整个 World
 *
 * 统计通过 World.onDamage / World.onKill 两个钩子采集：
 *  - 伤害按武器 id 聚合，得到每个武器的累计伤害、DPS、最近 4 秒 DPS
 *  - 击杀按僵尸类型 id + 武器 id 聚合，并记录「从出生到死亡」的击杀耗时
 *
 * 新增僵尸 / 武器时，只要在 data 注册表里加一行，这里的单位库与统计桶会自动出现。
 */
import { HUMAN_BODY_DIAMETER } from "../data/humans";
import { DEFAULT_MAP, resolveMap, type MapDef } from "../data/maps";
import { TILE_SIZE } from "../data/maps/schema";
import { effectiveWeapon } from "../data/settings/runtime";
import type { Rect } from "../data/types";
import { WEAPON_LIST, getWeaponDef } from "../data/weapons";
import { ZOMBIE_LIST, getZombieDef, zombieBodyDiameter } from "../data/zombies";
import { createWorld } from "../core/world";
import type { DamageSource, Human, World, Zombie } from "../core/world";
import { updateHumans, updateZombies } from "../systems/ai";
import { updateCombat } from "../systems/combat";
import { clamp, dist2 } from "../utils/math";
import type { FloatingText } from "../render/renderer";

/** 逻辑固定步长（和正式对局一致：1/60 秒） */
export const STEP = 1 / 60;

export type TrainTool = "select" | "delete" | "grass" | "water" | "terrain-erase";
export type UnitKind = "human" | "zombie";

/** 把同种地形格合并成矩形（草丛 / 水池画笔后重算导航阻挡用） */
function mergeCellRects(cells: Set<number>, cols: number, rows: number): Rect[] {
  interface Band {
    x: number;
    w: number;
    y: number;
  }
  const rects: Rect[] = [];
  let bands: Band[] = [];
  const emit = (band: Band, endY: number): void => {
    rects.push({
      x: band.x * TILE_SIZE,
      y: band.y * TILE_SIZE,
      w: band.w * TILE_SIZE,
      h: (endY - band.y) * TILE_SIZE,
    });
  };
  for (let y = 0; y < rows; y++) {
    const runs: Band[] = [];
    for (let x = 0; x < cols; x++) {
      if (!cells.has(y * cols + x)) continue;
      const start = x;
      while (x + 1 < cols && cells.has(y * cols + x + 1)) x++;
      runs.push({ x: start, w: x - start + 1, y });
    }
    const next: Band[] = [];
    for (const band of bands) {
      const hit = runs.findIndex((r) => r.x === band.x && r.w === band.w);
      if (hit >= 0) {
        next.push(band);
        runs.splice(hit, 1);
      } else {
        emit(band, y);
      }
    }
    bands = next.concat(runs);
  }
  for (const band of bands) emit(band, rows);
  return rects;
}

export interface ZombieOption {
  id: string;
  name: string;
  color: number;
  hp: number;
  speed: number;
  /** 每次撕咬对人类的伤害 */
  damage: number;
}

export interface HumanOption {
  id: string;
  name: string;
  color: number;
  range: number;
  damage: number;
  cooldown: number;
}

/** 单位库：直接来自注册表，新增僵尸/武器类型会自动出现在面板里 */
export const TRAIN_ZOMBIE_TYPES: ZombieOption[] = ZOMBIE_LIST.map((d) => ({
  id: d.id,
  name: d.name,
  color: d.color,
  hp: d.hp,
  speed: d.speed,
  damage: d.damage,
}));

export const TRAIN_HUMAN_TYPES: HumanOption[] = WEAPON_LIST.map((w) => ({
  id: w.id,
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

/**
 * 人类挨咬统计 —— 与武器 DPS 表完全分开：
 * 武器表记录“人类对僵尸造成的伤害”，这里记录“僵尸对人类造成的伤害”。
 */
export interface HumanStat {
  /** 被咬次数（每次成功撕咬算一次） */
  bites: number;
  /** 累计掉血 */
  damage: number;
  /** 异变完成数量 */
  turns: number;
}

/**
 * 电击枪链式统计 —— 独立于武器 DPS 表：
 * 记录每次放电实际命中的僵尸数、单体加成触发次数与平均每发命中数。
 */
export interface TeslaStat {
  /** 放电次数（有首个目标的射击） */
  volleys: number;
  /** 累计命中僵尸数（含链式跳跃） */
  hits: number;
  /** 触发单体加成的次数 */
  singleBonus: number;
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

function emptyWeaponStat(): WeaponStat {
  return { damage: 0, hits: 0, kills: 0, ttkSum: 0, ttkCount: 0 };
}

function emptyZombieStat(): ZombieTypeStat {
  return { damage: 0, kills: 0, ttkSum: 0, ttkCount: 0, spawns: 0 };
}

export class TrainingSession {
  world: World = createWorld(DEFAULT_MAP);
  /** 构造 / reset 时显式传入的地图（直接传 MapDef 时保留引用，供未注册的自定义图使用） */
  private preferredMap: MapDef | undefined = undefined;
  /** 构造 / reset 时显式指定的地图 id；未指定则沿用当前地图 */
  private preferredMapId: string | undefined = undefined;
  /** 未经地形画笔修改的原始地图，reset 时回到它（画笔改动不跨会话保留） */
  private baseMap: MapDef = DEFAULT_MAP;
  /** 最近一次地图解析是否回退默认图（main.ts 据此提示） */
  mapFallback = false;
  /** 最近一次请求的地图 id */
  requestedMapId: string | undefined = undefined;
  /** 地形画笔改动后回调（main.ts 用它重建渲染静态层） */
  onTerrainChanged?: () => void;
  paused = false;
  /** 速度倍率：1 = 正常，0.25 = 慢放 */
  speed = 1;
  /** 累计运行时间（秒，不含暂停），统计时间窗与击杀耗时都以它为基准 */
  activeTime = 0;

  selectedId: number | null = null;
  selectedKind: UnitKind | null = null;

  /** 当前待生成的单位类型 id；非 null 时点画布 = 生成 */
  armed: { kind: UnitKind; id: string } | null = null;
  /** select = 点选编辑，delete = 点单位删除 */
  tool: TrainTool = "select";

  readonly floaters: FloatingText[] = [];
  /** 统计桶 key = 武器 id */
  readonly weaponStats = new Map<string, WeaponStat>(
    WEAPON_LIST.map((w) => [w.id, emptyWeaponStat()]),
  );
  /** 统计桶 key = 僵尸类型 id */
  readonly zombieStats = new Map<string, ZombieTypeStat>(
    ZOMBIE_LIST.map((z) => [z.id, emptyZombieStat()]),
  );
  /** 人类挨咬统计（独立于武器 DPS 表） */
  readonly humanStat: HumanStat = { bites: 0, damage: 0, turns: 0 };
  /** 电击枪链式统计（独立于武器 DPS 表） */
  readonly teslaStat: TeslaStat = { volleys: 0, hits: 0, singleBonus: 0 };

  /** 每个丧尸的出生时间（训练场生成 / 波次生成都记），用于算击杀耗时 */
  private spawnTimes = new Map<number, number>();
  private stepPending = false;
  private acc = 0;
  private buckets = new Map<string, number[]>(
    WEAPON_LIST.map((w) => [w.id, new Array<number>(BUCKET_SLOTS).fill(0)]),
  );
  private stamps = new Map<string, number[]>(
    WEAPON_LIST.map((w) => [w.id, new Array<number>(BUCKET_SLOTS).fill(-1)]),
  );

  /**
   * @param mapOrId 初始地图（MapDef 或 id）；省略时用默认地图。
   *               id 不存在会回退默认图并置 mapFallback。
   */
  constructor(mapOrId?: MapDef | string) {
    if (typeof mapOrId === "string") this.preferredMapId = mapOrId;
    else if (mapOrId) this.preferredMap = mapOrId;
    this.applyMap(mapOrId ?? DEFAULT_MAP);
    this.installHooks();
  }

  /** 按地图重建沙盒 World；流场与空间索引由 createWorld 一并重建 */
  private applyMap(mapOrId: MapDef | string): void {
    const resolved = resolveMap(mapOrId);
    this.mapFallback = resolved.fallback;
    this.requestedMapId = resolved.requestedId;
    this.baseMap = resolved.map;
    this.world = createWorld(resolved.map);
  }

  /** 每次进入训练场都重置：空的 World + 清零的统计，退出即丢弃 */
  reset(mapOrId?: MapDef | string): void {
    if (typeof mapOrId === "string") this.preferredMapId = mapOrId;
    else if (mapOrId) this.preferredMap = mapOrId;
    this.applyMap(mapOrId ?? this.preferredMap ?? this.preferredMapId ?? this.baseMap);
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
    for (const s of this.weaponStats.values()) {
      Object.assign(s, emptyWeaponStat());
    }
    for (const s of this.zombieStats.values()) {
      Object.assign(s, emptyZombieStat());
    }
    this.humanStat.bites = 0;
    this.humanStat.damage = 0;
    this.humanStat.turns = 0;
    this.teslaStat.volleys = 0;
    this.teslaStat.hits = 0;
    this.teslaStat.singleBonus = 0;
    for (const z of this.world.zombies) this.spawnTimes.set(z.id, 0);
    for (const b of this.buckets.values()) b.fill(0);
    for (const s of this.stamps.values()) s.fill(-1);
  }

  /** 取/建某个武器的统计桶，未知 id 也不会崩 */
  weaponStat(id: string): WeaponStat {
    let s = this.weaponStats.get(id);
    if (!s) {
      s = emptyWeaponStat();
      this.weaponStats.set(id, s);
      this.buckets.set(id, new Array<number>(BUCKET_SLOTS).fill(0));
      this.stamps.set(id, new Array<number>(BUCKET_SLOTS).fill(-1));
    }
    return s;
  }

  /** 取/建某个僵尸类型的统计桶，未知 id 也不会崩 */
  zombieStat(id: string): ZombieTypeStat {
    let s = this.zombieStats.get(id);
    if (!s) {
      s = emptyZombieStat();
      this.zombieStats.set(id, s);
    }
    return s;
  }

  // ============================================================
  // 统计钩子（挂在 World 上，普通对局不会挂）
  // ============================================================

  private installHooks(): void {
    this.world.onDamage = (z, amount, source) => this.recordDamage(z, amount, source);
    this.world.onKill = (z, source) => this.recordKill(z, source);
    this.world.onHumanDamage = (_h, amount) => {
      this.humanStat.bites++;
      this.humanStat.damage += amount;
    };
    this.world.onHumanTurn = () => {
      this.humanStat.turns++;
    };
    this.world.onTeslaVolley = (hits, singleBonus) => {
      this.teslaStat.volleys++;
      this.teslaStat.hits += hits;
      if (singleBonus) this.teslaStat.singleBonus++;
    };
  }

  private recordDamage(z: Zombie, amount: number, source?: DamageSource): void {
    if (amount <= 0) return;
    this.zombieStat(z.kind).damage += amount;

    let color = 0xffffff;
    if (source?.weapon) {
      const ws = this.weaponStat(source.weapon);
      ws.damage += amount;
      ws.hits++;
      this.bucketAdd(source.weapon, amount);
      color = effectiveWeapon(source.weapon).color;
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
    const typeStat = this.zombieStat(z.kind);
    typeStat.kills++;

    const bornAt = this.spawnTimes.get(z.id);
    if (bornAt !== undefined) {
      this.spawnTimes.delete(z.id);
      const ttk = Math.max(0, this.activeTime - bornAt);
      typeStat.ttkSum += ttk;
      typeStat.ttkCount++;
      if (source?.weapon) {
        const ws = this.weaponStat(source.weapon);
        ws.kills++;
        ws.ttkSum += ttk;
        ws.ttkCount++;
      }
    } else if (source?.weapon) {
      this.weaponStat(source.weapon).kills++;
    }
  }

  private bucketAdd(weapon: string, amount: number): void {
    const bucket = this.buckets.get(weapon);
    const stamp = this.stamps.get(weapon);
    if (!bucket || !stamp) return;
    const slot = Math.floor(this.activeTime / BUCKET_SEC);
    const idx = slot % BUCKET_SLOTS;
    if (stamp[idx] !== slot) {
      stamp[idx] = slot;
      bucket[idx] = 0;
    }
    bucket[idx] += amount;
  }

  /** 最近 4 秒的实时 DPS */
  recentDps(weapon: string): number {
    const bucket = this.buckets.get(weapon);
    if (!bucket) return 0;
    let sum = 0;
    for (const v of bucket) sum += v;
    const window = Math.min(BUCKET_WINDOW, Math.max(0.5, this.activeTime));
    return sum / window;
  }

  /** 整个会话的平均 DPS */
  averageDps(weapon: string): number {
    return this.weaponStat(weapon).damage / Math.max(0.1, this.activeTime);
  }

  totalKills(): number {
    let total = 0;
    for (const s of this.zombieStats.values()) total += s.kills;
    return total;
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
    this.world.tickTerrain(dt);
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

  /** 生成一只指定类型 id 的丧尸；落在墙里 / 自己钻不过的开口里返回 null */
  spawnZombie(kind: string, x: number, y: number): Zombie | null {
    const cx = clamp(x, 8, this.world.map.width - 8);
    const cy = clamp(y, 8, this.world.map.height - 8);
    const body = zombieBodyDiameter(getZombieDef(kind));
    if (this.world.solidAt(cx, cy, 3, body)) return null;
    const z = this.world.spawnZombie(cx, cy, kind);
    z.maxHp = z.hp;
    this.spawnTimes.set(z.id, this.activeTime);
    this.zombieStat(z.kind).spawns++;
    return z;
  }

  /** 生成一个指定武器 id 的人类；可行走范围夹到房间内，落在墙里返回 null */
  spawnHuman(weapon: string, x: number, y: number): Human | null {
    const bounds = this.world.map.humanBounds;
    const cx = clamp(x, bounds.x0, bounds.x1);
    const cy = clamp(y, bounds.y0, bounds.y1);
    if (this.world.solidAt(cx, cy, 0, HUMAN_BODY_DIAMETER)) return null;
    const h = this.world.spawnHuman(cx, cy, weapon);
    h.post = -1;
    return h;
  }

  /** 画布点击的统一入口：按当前工具决定地形绘制 / 生成 / 删除 / 选中 */
  handleClick(x: number, y: number): boolean {
    if (this.tool === "grass") return this.paintTerrain(x, y, "grass");
    if (this.tool === "water") return this.paintTerrain(x, y, "water");
    if (this.tool === "terrain-erase") return this.paintTerrain(x, y, "clear");
    if (this.armed) {
      if (this.armed.kind === "zombie") return this.spawnZombie(this.armed.id, x, y) !== null;
      return this.spawnHuman(this.armed.id, x, y) !== null;
    }
    if (this.tool === "delete") {
      return this.deleteAt(x, y);
    }
    return this.selectAt(x, y);
  }

  /**
   * 训练场地形画笔：在 16px 格上画 / 擦草丛与水池。
   * 复制当前地图后再改，避免污染从工坊 / 目录共享出来的 MapDef；
   * 改完由 World 重建流场与区域缓存，并通知渲染层重画静态层。
   */
  paintTerrain(x: number, y: number, kind: "grass" | "water" | "clear"): boolean {
    const map = this.world.map;
    const cols = Math.ceil(map.width / TILE_SIZE);
    const rows = Math.ceil(map.height / TILE_SIZE);
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return false;
    const cell = ty * cols + tx;
    const cellRect: Rect = { x: tx * TILE_SIZE, y: ty * TILE_SIZE, w: TILE_SIZE, h: TILE_SIZE };
    // 墙体 / 门窗上不画地形，避免视觉与碰撞打架
    const overlaps = (r: Rect): boolean =>
      cellRect.x < r.x + r.w && r.x < cellRect.x + cellRect.w && cellRect.y < r.y + r.h && r.y < cellRect.y + cellRect.h;
    if (map.walls.some(overlaps) || map.openings.some((o) => overlaps(o.rect))) return false;

    const grass = new Set<number>();
    for (const r of map.grassTiles) grass.add(Math.floor(r.y / TILE_SIZE) * cols + Math.floor(r.x / TILE_SIZE));
    const water = new Set<number>();
    for (const r of map.waterTiles) water.add(Math.floor(r.y / TILE_SIZE) * cols + Math.floor(r.x / TILE_SIZE));

    const hadGrass = grass.has(cell);
    const hadWater = water.has(cell);
    if (kind === "grass" && hadGrass) return false;
    if (kind === "water" && hadWater) return false;
    if (kind === "clear" && !hadGrass && !hadWater) return false;

    grass.delete(cell);
    water.delete(cell);
    if (kind === "grass") grass.add(cell);
    else if (kind === "water") water.add(cell);

    const toRects = (cells: Set<number>): Rect[] =>
      [...cells].map((c) => ({
        x: (c % cols) * TILE_SIZE,
        y: Math.floor(c / cols) * TILE_SIZE,
        w: TILE_SIZE,
        h: TILE_SIZE,
      }));
    const next: MapDef = {
      ...map,
      grassTiles: toRects(grass),
      waterTiles: toRects(water),
      waterBlockers: mergeCellRects(water, cols, rows),
    };
    this.world.applyTerrainMap(next);
    this.onTerrainChanged?.();
    return true;
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

  /** 清场：一键清空所有单位、弹道、特效、毒液与飘字 */
  clearUnits(): void {
    this.world.humans.length = 0;
    this.world.zombies.length = 0;
    this.world.bullets.length = 0;
    this.world.effects.length = 0;
    this.world.poison.length = 0;
    this.world.poisonShots.length = 0;
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
    // 选中圈套住整个体型（胖子视觉半径 22），不是只套碰撞核心
    return { x: sel.zombie.x, y: sel.zombie.y, radius: sel.zombie.bodyDiameter * 0.5 + 10 };
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
  setHumanWeapon(h: Human, weapon: string): void {
    const def = getWeaponDef(weapon);
    h.weapon = def.id;
    h.ammo = def.magazine;
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
