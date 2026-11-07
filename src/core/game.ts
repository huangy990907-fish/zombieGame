/**
 * Game —— 游戏流程调度器（波次状态机 + 每帧逻辑编排）。
 *
 * 每帧调用顺序：
 *   spawnTick(补尸潮) -> rebuildGrids(重建空间索引)
 *   -> updateHumans -> updateZombies -> updateCombat
 *   -> ageEffects / compact(清扫) -> 波次结算
 *
 * 只负责“何时生成、何时结束”，具体行为在 systems/ 下。
 */
import { updateHumans, updateZombies } from "../systems/ai";
import { updateCombat } from "../systems/combat";
import { sound, SFX } from "../audio/manager";
import { HUMAN_BODY_DIAMETER } from "../data/humans";
import { DEFAULT_MAP, resolveMap, type MapDef } from "../data/maps";
import { applySettings, settings } from "../data/settings/runtime";
import type { HumanMode, SettingsOverrides, SpawnRegion } from "../data/types";
import { ZOMBIE_IDS, getZombieDef, zombieBodyDiameter } from "../data/zombies";
import type { LevelWave } from "../data/levels/schema";
import { findLevel, type LevelDef } from "../levels";
import { randRange } from "../utils/math";
import { createWorld } from "./world";

export type Phase = "prepare" | "wave" | "intermission" | "victory" | "defeat";

/** 库存槽：每种人类（= 武器）一档，独立计时恢复 */
export interface InventorySlot {
  id: string;
  /** 该武器人类血量（关卡配置） */
  hp: number;
  cap: number;
  stock: number;
  /** 恢复间隔（秒 / 个） */
  regen: number;
  /** 距下一个库存的累计时间 */
  timer: number;
}

export type PlacementResult = "ok" | "phase" | "empty" | "zone" | "blocked";

export class Game {
  /** 当前地图；随 start() 按关卡 mapId / 显式选择切换 */
  map: MapDef = DEFAULT_MAP;
  world = createWorld(this.map);
  /** 当前关卡 id，undefined = 还没选关卡 */
  levelId: string | undefined = undefined;
  /** 构造 / start 时显式指定的地图（直接传 MapDef 时保留引用，供未注册的自定义图使用） */
  private preferredMap: MapDef | undefined = undefined;
  /** 构造 / start 时显式指定的地图 id（优先于关卡 mapId，供调试与后续选图用） */
  private preferredMapId: string | undefined = undefined;
  /** 最近一次地图解析是否发生回退（main.ts 据此给出可见提示） */
  mapFallback = false;
  /** 最近一次请求的地图 id（回退时用于提示） */
  requestedMapId: string | undefined = undefined;
  /** 当前波次，1 开始；准备阶段为 0 */
  wave = 0;
  phase: Phase = "prepare";
  paused = false;
  /** 速度倍率 1 / 2 / 4 / 8 */
  speed = 1;
  /** 人类行为模式，顶栏按钮实时切换；重开不清除 */
  mode: HumanMode = "defend";
  /** 本波还剩多少丧尸没入场 */
  spawnLeft = 0;
  /** 本波待入场丧尸的出场顺序（按波次配置展开，支持一波多兵种） */
  private waveQueue: string[] = [];
  spawnTimer = 0;
  /** 波间隔倒计时 */
  countdown = 1.5;
  /** 本波丧尸总数（HUD 显示用） */
  waveSize = 0;
  elapsed = 0;

  /** 当前关卡定义（含配置的人类 / 波次） */
  level: LevelDef | undefined = undefined;
  /** 关卡名（HUD 顶栏显示） */
  levelName = "";
  /** 总波数 */
  waveCount = 0;
  /** 关卡波次配置 */
  private waves: LevelWave[] = [];
  /** 人类库存：每种启用的武器一档 */
  inventory: InventorySlot[] = [];
  /** 当前选中的武器（= 人类种类） */
  selectedWeapon: string | undefined = undefined;
  /** 玩家是否已经放下过至少一名人类（未放置不判负） */
  placedAny = false;
  /** 累计放置人数（HUD 血条分母） */
  placedTotal = 0;
  /** 是否已经点击「开始」进入战斗 */
  started = false;

  /**
   * @param mapOrId 初始地图；可传 MapDef 或地图 id。省略时用默认地图。
   *               id 不存在会回退默认图，并置 mapFallback 供上层提示。
   */
  constructor(mapOrId?: MapDef | string) {
    if (typeof mapOrId === "string") this.preferredMapId = mapOrId;
    else if (mapOrId) this.preferredMap = mapOrId;
    this.applyMap(mapOrId ?? DEFAULT_MAP);
    // 不自动 start() —— main.ts 在路由跳转到 play 时显式调 start(levelId)
    // 这样关卡 settings 才有机会在 World 构造前被 apply
  }

  /** 解析并记录地图；World 在构造 / start 处按新地图重建 */
  private applyMap(mapOrId: MapDef | string): void {
    const resolved = resolveMap(mapOrId);
    this.map = resolved.map;
    this.mapFallback = resolved.fallback;
    this.requestedMapId = resolved.requestedId;
  }

  /**
   * 开始 / 重开一局。
   * @param levelId 当前关卡 id；后续重开（顶栏按钮）可省略，沿用上次关卡
   * @param levelSettings 该关卡对设置的覆盖（可选）
   */
  start(levelId?: string, levelSettings?: SettingsOverrides): void {
    if (levelId) this.levelId = levelId;
    // 优先级：显式选择（构造参数）> 关卡 mapId > 当前地图（保留未注册的自定义图）
    const level = this.levelId ? findLevel(this.levelId) : undefined;
    this.applyMap(this.preferredMap ?? this.preferredMapId ?? level?.mapId ?? this.map);
    if (levelSettings) applySettings(levelSettings);

    this.world = createWorld(this.map);
    this.level = level;
    this.levelName = level?.title ?? "";
    this.waves = level?.waves ?? [];
    this.waveCount = this.waves.length;
    this.initInventory();
    this.wave = 0;
    this.phase = "prepare";
    this.paused = false;
    this.speed = 1;
    this.spawnLeft = 0;
    this.waveQueue = [];
    this.spawnTimer = 0;
    this.countdown = 0;
    this.waveSize = 0;
    this.elapsed = 0;
    this.placedAny = false;
    this.placedTotal = 0;
    this.started = false;
  }

  /** 关卡的人类库存初始化（每种启用的武器一档） */
  private initInventory(): void {
    this.inventory =
      this.level?.humans
        .filter((h) => h.enabled)
        .map((h) => ({
          id: h.id,
          hp: h.hp,
          cap: h.cap,
          stock: Math.min(h.initial, h.cap),
          regen: h.regen,
          timer: 0,
        })) ?? [];
    this.selectedWeapon = this.inventory[0]?.id;
  }

  /** 切换当前放置的人类种类 */
  selectWeapon(id: string): void {
    if (this.inventory.some((slot) => slot.id === id)) this.selectedWeapon = id;
  }

  /**
   * 在人类区放置一名当前选中的人类。
   * 返回 ok 时扣 1 库存；落点在区外 / 墙内 / 不可通行处不生成也不扣。
   */
  placeHuman(x: number, y: number): PlacementResult {
    if (this.phase === "victory" || this.phase === "defeat") return "phase";
    const slot = this.inventory.find((s) => s.id === this.selectedWeapon);
    if (!slot || slot.stock <= 0) return "empty";

    const zones: SpawnRegion[] =
      this.map.humanZones.length > 0 ? this.map.humanZones : [this.map.humanBounds];
    const inside = zones.some((z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1);
    if (!inside) return "zone";
    if (this.world.solidAt(x, y, 0, HUMAN_BODY_DIAMETER)) return "blocked";

    this.world.spawnHuman(x, y, slot.id, slot.hp);
    this.attachPost(x, y);
    slot.stock--;
    this.placedAny = true;
    this.placedTotal++;
    sound.play(SFX.UI_CLICK);
    return "ok";
  }

  /** 给新放置的人类挂一个守岗点：站位就是玩家放的位置，朝向最近的开口 */
  private attachPost(x: number, y: number): void {
    const human = this.world.humans[this.world.humans.length - 1];
    if (!human) return;
    let best = Infinity;
    let ox = (this.map.room.left + this.map.room.right) * 0.5;
    let oy = (this.map.room.top + this.map.room.bottom) * 0.5;
    for (const o of this.world.openings) {
      const cx = o.rect.x + o.rect.w * 0.5;
      const cy = o.rect.y + o.rect.h * 0.5;
      const d2 = (human.x - cx) ** 2 + (human.y - cy) ** 2;
      if (d2 < best) {
        best = d2;
        ox = cx;
        oy = cy;
      }
    }
    human.post = this.world.posts.length;
    this.world.posts.push({ x, y, ox, oy });
  }

  /** 点击「开始」：至少放过一名人类才放第一波 */
  beginBattle(): boolean {
    if (this.started) return true;
    if (!this.placedAny) {
      sound.play(SFX.UI_CLICK);
      return false;
    }
    this.started = true;
    this.beginWave(1);
    return true;
  }

  /** 库存恢复：每种独立计时，满仓停表 */
  private regenInventory(dt: number): void {
    for (const slot of this.inventory) {
      if (slot.stock >= slot.cap) {
        slot.timer = 0;
        continue;
      }
      slot.timer += dt;
      if (slot.timer >= slot.regen) {
        slot.timer -= slot.regen;
        slot.stock = Math.min(slot.cap, slot.stock + 1);
        if (slot.stock >= slot.cap) slot.timer = 0;
      }
    }
  }

  /** 开始第 n 波：按关卡配置展开本波丧尸队列（支持一波多兵种） */
  private beginWave(n: number): void {
    const config = this.waves[n - 1];
    if (!config) {
      this.phase = "victory";
      sound.play(SFX.VICTORY);
      return;
    }
    this.wave = n;
    this.waveQueue = [];
    for (const group of config.zombies) {
      for (let i = 0; i < group.count; i++) this.waveQueue.push(group.kind);
    }
    this.waveSize = this.waveQueue.length;
    this.spawnLeft = this.waveSize;
    this.spawnTimer = 0;
    this.phase = "wave";
    sound.play(SFX.WAVE_START);
  }

  /**
   * 多区域并集按面积加权抽一块（区域可以相交 / 重叠，权重按各自面积累加）。
   * 空集合回退 fallback，避免调用方再写一次兜底。
   */
  private pickRegion(regions: SpawnRegion[], fallback: SpawnRegion): SpawnRegion {
    if (regions.length === 0) return fallback;
    const areaOf = (r: SpawnRegion): number =>
      Math.max(0, (r.x1 - r.x0) * (r.y1 - r.y0));
    let total = 0;
    for (const r of regions) total += areaOf(r);
    if (total <= 0) return regions[regions.length - 1];
    let roll = Math.random() * total;
    for (const r of regions) {
      const area = areaOf(r);
      if (roll < area) return r;
      roll -= area;
    }
    return regions[regions.length - 1];
  }

  /** 生成一只丧尸：兵种来自本波队列，血量随波次上浮 */
  private spawnOne(): void {
    const kind = this.waveQueue.shift() ?? ZOMBIE_IDS.normal;
    // 出生点完全按地图显式区域选择：spawn 为主区域（可多块），再叠加可选的窗侧区域。
    // 按面积加权，大出生区放更多丧尸；不假设“左 / 上 / 下”的方位。
    const regions: SpawnRegion[] = [...this.map.spawn];
    if (this.map.windowSpawn.top) regions.push(this.map.windowSpawn.top);
    if (this.map.windowSpawn.bottom) regions.push(this.map.windowSpawn.bottom);
    const region = this.pickRegion(regions, this.map.spawn[0] ?? this.map.humanBounds);
    const body = zombieBodyDiameter(getZombieDef(kind));
    const spot = this.world.findFreeSpot(
      randRange(region.x0, region.x1),
      randRange(region.y0, region.y1),
      body,
      region,
    );
    if (!spot) return;
    this.world.spawnZombie(spot.x, spot.y, kind, 1 + (this.wave - 1) * 0.05);
  }

  /** 按固定速率往场里放丧尸，超出同屏上限则暂缓 */
  private spawnTick(dt: number): void {
    if (this.spawnLeft <= 0) return;
    this.spawnTimer -= dt;
    const s = settings().wave;
    const interval = 1 / Math.min(s.spawnMax, s.spawnBase + this.wave * s.spawnPerWave);
    let guard = 0;
    while (
      this.spawnTimer <= 0 &&
      this.spawnLeft > 0 &&
      this.world.zombies.length < s.maxAlive &&
      guard++ < 12
    ) {
      this.spawnOne();
      this.spawnLeft--;
      this.spawnTimer += interval;
    }
    if (this.spawnTimer < 0) this.spawnTimer = 0;
  }

  /** 逻辑主循环，固定 dt = 1/60 秒，由 main.ts 的累加器驱动 */
  tick(dt: number): void {
    this.elapsed += dt;
    this.world.time += dt;
    this.world.mode = this.mode;

    this.regenInventory(dt);
    if (this.phase === "wave") this.spawnTick(dt);

    this.world.rebuildGrids();
    updateHumans(this.world, dt);
    updateZombies(this.world, dt);
    updateCombat(this.world, dt);
    this.world.ageEffects(dt);
    this.world.tickTerrain(dt);
    this.world.compact();

    if (!this.started) return;

    if (this.phase === "wave") {
      // 玩家还没放过人时不算失败；转化倒计时中的人仍算“存在”
      if (this.placedAny && this.world.humans.length === 0) {
        this.phase = "defeat";
        sound.play(SFX.DEFEAT);
        return;
      }
      if (this.spawnLeft === 0 && this.world.zombies.length === 0) {
        if (this.wave >= this.waveCount) {
          this.phase = "victory";
          sound.play(SFX.VICTORY);
        } else {
          this.phase = "intermission";
          this.countdown = this.waves[this.wave - 1]?.interval ?? 1.8;
        }
      }
    } else if (this.phase === "intermission") {
      this.countdown -= dt;
      if (this.countdown <= 0) this.beginWave(this.wave + 1);
    }
  }

  /** 统计存活人类按兵种 id 的数量，HUD 底栏显示用 */
  aliveByWeapon(): Map<string, number> {
    const out = new Map<string, number>();
    for (let i = 0; i < this.world.humans.length; i++) {
      const id = this.world.humans[i].weapon;
      out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
  }
}
