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
import { HUMAN_BODY_DIAMETER, HUMAN_DEF } from "../data/humans";
import { DEFAULT_MAP, resolveMap, type MapDef } from "../data/maps";
import { applySettings, settings } from "../data/settings/runtime";
import type { HumanMode, SettingsOverrides, SpawnRegion } from "../data/types";
import { LOADOUT, WEAPON_IDS } from "../data/weapons";
import { ZOMBIE_IDS, getZombieDef, zombieBodyDiameter } from "../data/zombies";
import { findLevel } from "../levels";
import { clamp, randRange } from "../utils/math";
import type { Post } from "./world";
import { createWorld } from "./world";

export type Phase = "wave" | "intermission" | "victory" | "defeat";

/** 岗位间距：人类身体直径（2 × 碰撞半径） */
const POST_SPACING = HUMAN_DEF.radius * 2;
/** 门岗火力线到墙内侧的距离：给门口的“通过时间”留出杀伤窗口 */
const DOOR_FIRELINE = 90;
/** 门岗沿门洞两侧各外扩的距离，覆盖门框 */
const DOOR_POST_MARGIN = 8;
/** 窗岗火力线到窗中心的距离（紧贴窗洞后方，偏离太多会被墙沿挡子弹） */
const WINDOW_FIRELINE = 40;
/** 预备队占开局人数的比例（arena 50 人 → 10 人） */
const RESERVE_RATIO = 0.2;
/** 预备队行列间距上限，小房间按可用空间压缩 */
const RESERVE_ROW_GAP = 70;
const RESERVE_COL_GAP = 70;

type WallSide = "left" | "right" | "top" | "bottom";

/** 开口贴在哪面墙上：按开口中心到四面墙的距离取最近的一侧 */
function sideOfOpening(map: MapDef, rect: { x: number; y: number; w: number; h: number }): WallSide {
  const { room } = map;
  const cx = rect.x + rect.w * 0.5;
  const cy = rect.y + rect.h * 0.5;
  const options: Array<{ side: WallSide; d: number }> = [
    { side: "left", d: Math.abs(cx - room.left) },
    { side: "right", d: Math.abs(room.right - cx) },
    { side: "top", d: Math.abs(cy - room.top) },
    { side: "bottom", d: Math.abs(room.bottom - cy) },
  ];
  options.sort((a, b) => a.d - b.d);
  return options[0].side;
}

/** 按长度比例把岗位名额分给多扇门；每扇门至少 1 个（名额够时） */
function splitByLength(total: number, lengths: number[]): number[] {
  const n = lengths.length;
  if (n === 0) return [];
  if (total <= 0) return lengths.map(() => 0);
  if (total < n) return lengths.map((_, i) => (i < total ? 1 : 0));
  const extra = total - n;
  const sum = lengths.reduce((a, b) => a + b, 0) || 1;
  const raws = lengths.map((len) => (extra * len) / sum);
  const counts = raws.map((v) => 1 + Math.floor(v));
  let remain = total - counts.reduce((a, b) => a + b, 0);
  const fractions = raws
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remain > 0; k++, remain--) counts[fractions[k % n].i]++;
  return counts;
}

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
  /** 当前波次，1 开始 */
  wave = 0;
  phase: Phase = "intermission";
  paused = false;
  /** 速度倍率 1 / 2 / 4 / 8 */
  speed = 1;
  /** 人类行为模式，顶栏按钮实时切换；重开不清除 */
  mode: HumanMode = "defend";
  /** 本波还剩多少丧尸没入场 */
  spawnLeft = 0;
  /** 本波还没入场的狂奔丧尸数量 */
  runnersLeft = 0;
  spawnTimer = 0;
  /** 波间隔倒计时 */
  countdown = 1.5;
  /** 本波丧尸总数（HUD 显示用） */
  waveSize = 0;
  elapsed = 0;

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
    this.wave = 0;
    this.phase = "intermission";
    this.paused = false;
    this.speed = 1;
    this.spawnLeft = 0;
    this.runnersLeft = 0;
    this.spawnTimer = 0;
    this.countdown = 1.5;
    this.waveSize = 0;
    this.elapsed = 0;
    this.spawnInitialHumans();
    this.assignPosts();
  }

  /** 按 LOADOUT 配比生成初始人类，并按当前初始人数做归一化 */
  private spawnInitialHumans(): void {
    const total = settings().human.start;
    const loadoutSum = LOADOUT.reduce((a, b) => a + b.count, 0) || 1;
    const roster: string[] = [];
    for (const entry of LOADOUT) {
      const n = Math.round((entry.count / loadoutSum) * total);
      for (let i = 0; i < n; i++) roster.push(entry.id);
    }
    // 四舍五入可能差 1-2 个，补齐
    while (roster.length < total) roster.push(LOADOUT[0].id);
    while (roster.length > total) roster.pop();
    for (let i = roster.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = roster[i];
      roster[i] = roster[j];
      roster[j] = tmp;
    }
    const zones = this.map.humanZones.length > 0 ? this.map.humanZones : [this.map.humanBounds];
    for (const w of roster) {
      const zone = this.pickRegion(zones, this.map.humanBounds);
      this.spawnHumanInZone(zone, w);
    }
  }

  /**
   * 在指定出生区随机取一个可用落点生成人类。
   * 出生区可能包含内部墙体（自定义地图），落到墙里就就近找空地；
   * 整块区域都不可用时退回人类活动区，避免单位卡在墙内。
   */
  private spawnHumanInZone(zone: SpawnRegion, weapon: string): void {
    const spot =
      this.world.findFreeSpot(
        randRange(zone.x0, zone.x1),
        randRange(zone.y0, zone.y1),
        HUMAN_BODY_DIAMETER,
        zone,
      ) ??
      this.world.findFreeSpot(
        (zone.x0 + zone.x1) * 0.5,
        (zone.y0 + zone.y1) * 0.5,
        HUMAN_BODY_DIAMETER,
        this.map.humanBounds,
      );
    if (!spot) return;
    this.world.spawnHuman(spot.x, spot.y, weapon);
  }

  /**
   * 防守分岗（1B 泛化）：不再依赖开口下标，也不假设“左门 / 上下窗”。
   *
   * 名额规则：
   *  - 预备队 = 开局人数 × 20%（arena 50 人 → 10）
   *  - 每扇窗按净宽推导人数与间距：线宽 = 窗净宽 + 2 × 身体直径，
   *    人数 = floor(线宽 / 间距) + 1（arena 16px 窗 → 4 人，间距 12px）
   *  - 剩余名额按门洞长度比例分给所有门（arena 1 门 → 32）
   *  - 岗位坐标由开口中心、墙内侧法线与房间几何推导，并夹在人类活动区内
   */
  private assignPosts(): void {
    const ws = this.world;
    ws.posts.length = 0;
    const b = this.map.humanBounds;
    const clampPost = (p: Post): Post => ({
      x: clamp(p.x, b.x0, b.x1),
      y: clamp(p.y, b.y0, b.y1),
      ox: p.ox,
      oy: p.oy,
    });

    const doors = ws.openings.filter((o) => o.kind === "door");
    const windows = ws.openings.filter((o) => o.kind === "window");
    const start = Math.max(0, settings().human.start);
    const reserveTotal = Math.max(1, Math.round(start * RESERVE_RATIO));

    // 窗岗：紧贴窗洞正后方，人数随净宽增长
    const windowPosts: Post[] = [];
    for (const w of windows) {
      const cx = w.rect.x + w.rect.w * 0.5;
      const cy = w.rect.y + w.rect.h * 0.5;
      const side = sideOfOpening(this.map, w.rect);
      const vertical = side === "left" || side === "right";
      const inward = side === "left" ? 1 : side === "right" ? -1 : side === "top" ? 1 : -1;
      const netLen = vertical ? w.rect.h : w.rect.w;
      const count = Math.max(2, Math.floor((netLen + POST_SPACING * 2) / POST_SPACING) + 1);
      for (let i = 0; i < count; i++) {
        const along = (i - (count - 1) * 0.5) * POST_SPACING;
        const x = vertical ? cx + inward * WINDOW_FIRELINE : cx + along;
        const y = vertical ? cy + along : cy + inward * WINDOW_FIRELINE;
        windowPosts.push(
          clampPost({
            x: x + randRange(-2, 2),
            y: y + randRange(-2, 2),
            ox: cx,
            oy: cy,
          }),
        );
      }
    }

    // 门岗：剩余名额按门洞长度分配，火力线在墙内侧 90px
    const doorTotal = Math.max(0, start - reserveTotal - windowPosts.length);
    const doorSides = doors.map((d) => sideOfOpening(this.map, d.rect));
    const doorLengths = doors.map((d, i) => {
      const vertical = doorSides[i] === "left" || doorSides[i] === "right";
      return vertical ? d.rect.h : d.rect.w;
    });
    const doorCounts = splitByLength(doorTotal, doorLengths);
    const doorPosts: Post[] = [];
    doors.forEach((d, di) => {
      const side = doorSides[di];
      const vertical = side === "left" || side === "right";
      const inward = side === "left" ? 1 : side === "right" ? -1 : side === "top" ? 1 : -1;
      const cx = d.rect.x + d.rect.w * 0.5;
      const cy = d.rect.y + d.rect.h * 0.5;
      const netLen = vertical ? d.rect.h : d.rect.w;
      const anchor = vertical
        ? side === "left"
          ? d.rect.x + d.rect.w
          : d.rect.x
        : side === "top"
          ? d.rect.y + d.rect.h
          : d.rect.y;
      const line = anchor + inward * DOOR_FIRELINE;
      const count = doorCounts[di];
      for (let i = 0; i < count; i++) {
        const along =
          count > 1
            ? -DOOR_POST_MARGIN + (i / (count - 1)) * (netLen + DOOR_POST_MARGIN * 2)
            : netLen * 0.5;
        doorPosts.push(
          clampPost({
            x: vertical ? line + inward * randRange(-4, 4) : cx + along,
            y: vertical ? cy + along : line + inward * randRange(-4, 4),
            ox: cx,
            oy: cy,
          }),
        );
      }
    });

    // 预备队：房间中部 2 列，行距按可用高度压缩；目标取最近的门中心
    const reservePosts: Post[] = [];
    const rowGap = Math.min(RESERVE_ROW_GAP, (b.y1 - b.y0) / Math.max(1, Math.ceil(reserveTotal / 2) - 1));
    const rows = Math.ceil(reserveTotal / 2);
    const cx = (b.x0 + b.x1) * 0.5;
    const cy = (b.y0 + b.y1) * 0.5;
    const startY = cy - ((rows - 1) * rowGap) / 2;
    const targets = doors.length > 0 ? doors : windows.length > 0 ? windows : ws.openings;
    for (let i = 0; i < reserveTotal; i++) {
      const px = cx + (i % 2 === 0 ? -RESERVE_COL_GAP : RESERVE_COL_GAP) * 0.5;
      const py = startY + Math.floor(i / 2) * rowGap;
      let tx = (this.map.room.left + this.map.room.right) * 0.5;
      let ty = (this.map.room.top + this.map.room.bottom) * 0.5;
      let best = Infinity;
      for (const o of targets) {
        const ox = o.rect.x + o.rect.w * 0.5;
        const oy = o.rect.y + o.rect.h * 0.5;
        const d2 = (px - ox) ** 2 + (py - oy) ** 2;
        if (d2 < best) {
          best = d2;
          tx = ox;
          ty = oy;
        }
      }
      reservePosts.push(
        clampPost({
          x: px + randRange(-3, 3),
          y: py + randRange(-3, 3),
          ox: tx,
          oy: ty,
        }),
      );
    }

    ws.posts.push(...doorPosts, ...windowPosts, ...reservePosts);

    // 分岗顺序：喷火/霰弹 守门 -> 机枪填门岗缺额 ->
    // 其余武器（火箭/电击枪/剩余机枪）补窗岗 -> 再剩下的进预备队
    let di = 0;
    let wi = 0;
    let ri = 0;
    for (const h of ws.humans) {
      if ((h.weapon === WEAPON_IDS.flame || h.weapon === WEAPON_IDS.shotgun) && di < doorPosts.length) {
        h.post = di++;
      } else if (h.weapon === WEAPON_IDS.mg && di < doorPosts.length) {
        h.post = di++;
      } else if (wi < windowPosts.length) {
        h.post = doorPosts.length + wi++;
      } else if (ri < reservePosts.length) {
        h.post = doorPosts.length + windowPosts.length + ri++;
      }
    }
  }

  /** 开始第 n 波：算本波规模、狂奔占比，并补充少量兵员 */
  private beginWave(n: number): void {
    this.wave = n;
    const s = settings().wave;
    this.waveSize = Math.round(s.base * Math.pow(s.growth, n - 1));
    this.spawnLeft = this.waveSize;
    this.runnersLeft = Math.round(this.waveSize * Math.min(0.55, 0.25 + n * 0.015));
    this.spawnTimer = 0;
    this.phase = "wave";
    sound.play(SFX.WAVE_START);

    // 每波少量补充兵员，避免被一波打崩后彻底没法看
    const zones = this.map.humanZones.length > 0 ? this.map.humanZones : [this.map.humanBounds];
    const add = Math.min(s.reinforce, Math.max(0, settings().human.cap - this.world.humans.length));
    for (let i = 0; i < add; i++) {
      const zone = this.pickRegion(zones, this.map.humanBounds);
      this.spawnHumanInZone(zone, this.randomWeapon());
    }
  }

  /** 按 LOADOUT 配比随机抽一个兵种 id */
  private randomWeapon(): string {
    const total = LOADOUT.reduce((a, b) => a + b.count, 0);
    let r = Math.random() * total;
    for (const entry of LOADOUT) {
      r -= entry.count;
      if (r <= 0) return entry.id;
    }
    return LOADOUT[0].id;
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

  /** 生成一只丧尸：按剩余比例决定普通/狂奔，血量随波次上浮 */
  private spawnOne(): void {
    let kind = ZOMBIE_IDS.normal;
    if (this.runnersLeft > 0) {
      const odds = this.runnersLeft / Math.max(1, this.spawnLeft);
      if (Math.random() < odds) {
        kind = ZOMBIE_IDS.runner;
        this.runnersLeft--;
      }
    }
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

    if (this.phase === "wave") this.spawnTick(dt);

    this.world.rebuildGrids();
    updateHumans(this.world, dt);
    updateZombies(this.world, dt);
    updateCombat(this.world, dt);
    this.world.ageEffects(dt);
    this.world.compact();

    if (this.phase === "wave") {
      if (this.world.humans.length === 0) {
        this.phase = "defeat";
        sound.play(SFX.DEFEAT);
        return;
      }
      if (this.spawnLeft === 0 && this.world.zombies.length === 0) {
        if (this.wave >= settings().wave.count) {
          this.phase = "victory";
          sound.play(SFX.VICTORY);
        } else {
          this.phase = "intermission";
          this.countdown = 1.8;
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
