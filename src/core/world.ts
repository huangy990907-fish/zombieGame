/**
 * World —— 存放所有游戏实体的数据容器。
 *
 * 这里只有“数据和数据操作”，没有玩法逻辑：
 *  - 四类实体：人类 / 丧尸 / 子弹 / 特效，都用普通数组存放
 *  - 两张空间哈希表（丧尸一张、人类一张），每帧由 rebuildGrids() 重建
 *  - 一张流场表（丧尸找路用）
 *  - 一张地图定义（所有几何与开口都从这里取，不再读全局常量）
 *
 * 玩法逻辑分别在 systems/ai.ts、systems/combat.ts，
 * 流程调度在 core/game.ts。
 */
import { DEFAULT_MAP, type MapDef } from "../data/maps";
import { TILE_SIZE } from "../data/maps/schema";
import { TERRAIN } from "../data/terrain";
import { effectiveHuman, effectiveWeapon, effectiveZombie, openingInstance, setActiveMap, settings } from "../data/settings/runtime";
import { getZombieDef, zombieBodyDiameter } from "../data/zombies";
import type { HumanMode, Rect, SpawnRegion, ZombieMode } from "../data/types";
import { FlowField, openingNetWidth } from "../systems/flowField";
import { findFreePoint, isBlockedForBody } from "../systems/collision";
import { RegionMap } from "../systems/regions";
import { sound, SFX } from "../audio/manager";
import { gaussClamped, randRange, segRectHit } from "../utils/math";
import { SpatialHash } from "../utils/spatialHash";

/** 草丛格运行时状态：0 正常 / 1 燃烧 / 2 休眠 / 3 重生中 */
export interface GrassTileState {
  x: number;
  y: number;
  phase: 0 | 1 | 2 | 3;
  timer: number;
}

/**
 * 腐蚀毒液池 —— 世界级运行时状态，与草丛一样由 tickTerrain 统一推进。
 * 只伤害人类、不伤害丧尸；不阻挡单位 / 子弹 / 视线。
 * 多团重叠时“同位置取最高”：伤害取最大值、减速取最强值，不叠加。
 */
export interface PoisonPool {
  x: number;
  y: number;
  radius: number;
  /** 剩余时长（秒） */
  remaining: number;
  /** 初始时长（秒），渲染淡出用 */
  total: number;
  /** 每秒伤害 */
  dps: number;
  /** 池内人类移速倍率 */
  speedMul: number;
}

/** 某点毒液的有效效果（多团重叠时已取最高 / 最强） */
export interface PoisonEffect {
  dps: number;
  speedMul: number;
}

/**
 * 腐蚀者吐出的抛物线毒液弹。
 * 飞行途中只有视觉表现：不造成伤害、不伤僵尸、不挡子弹与视线；
 * 落地（t >= dur）才在落点生成一团 PoisonPool。
 */
export interface PoisonShot {
  /** 起点（吐出瞬间腐蚀者位置） */
  x0: number;
  y0: number;
  /** 当前坐标（每帧按线性插值推进；高度由渲染层按抛物线补） */
  x: number;
  y: number;
  /** 锁定落点（吐出瞬间人类所在位置，之后不再追踪） */
  tx: number;
  ty: number;
  /** 已飞行时间 / 总飞行时间（秒） */
  t: number;
  dur: number;
  radius: number;
  duration: number;
  dps: number;
  speedMul: number;
}

export interface Human {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  /** 武器 id：如 "mg" / "flame" / "shotgun" / "rocket" */
  weapon: string;
  /** 第二把武器 id（尸潮求生双持）；null / 未设置表示只有主武器 */
  weapon2?: string | null;
  /** 当前弹匣剩余弹药 */
  ammo: number;
  /** 第二把武器的弹匣剩余弹药 */
  ammo2?: number;
  /** >0 表示正在换弹，倒计时结束后回满弹药 */
  reloadTimer: number;
  /** 第二把武器的换弹倒计时 */
  reload2?: number;
  /** 开火冷却，>0 时不能射击；喷火时表示两次伤害结算的间隔 */
  fire: number;
  /** 第二把武器的开火冷却 */
  fire2?: number;
  /** >0 表示喷火正在持续喷射，剩余喷射时间；其他武器恒为 0 */
  burst: number;
  /** 第二把武器若为喷火时的持续喷射计时 */
  burst2?: number;
  /** 当前锁定的丧尸（可能已经死亡，用前要检查 alive） */
  target: Zombie | null;
  /** 重新索敌的计时：每隔一小段时间才做一次大范围查询，省性能 */
  sight: number;
  /** >0 表示已被咬、正在转化，倒计时结束后倒戈成丧尸 */
  turning: number;
  /**
   * 受伤后血条剩余可见时间（秒）。每次被咬重置为 3 秒，
   * 归零后血条淡出；只影响渲染，不参与玩法。
   */
  hurtTimer: number;
  /** 朝向（弧度） */
  facing: number;
  /** 被飞扑者压制的剩余时间（秒）；>0 时不能开火、移速降低、持续掉血 */
  pinTimer: number;
  /** 当前压制自己的飞扑者 id；null 表示未被压制 */
  pinBy: number | null;
  /** 闲逛目标点 */
  wx: number;
  wy: number;
  /** 闲逛目标点的刷新计时 */
  wTimer: number;
  /** 躲毒液：选定的安全落点（不在毒液范围内、可站立） */
  safeX: number;
  safeY: number;
  /** 躲毒液：安全落点的重算倒计时 */
  safeTimer: number;
  /**
   * 防守岗哨下标（world.posts 的下标），-1 表示未分岗。
   * 防守模式下有岗的人站桩守开口，没岗的自由交战。
   */
  post: number;
  alive: boolean;
  /*
   * 下面这些字段是「训练场」专用的单个单位覆盖值：
   * 普通对局里全部是 undefined，逻辑层的 `??` 回落到全局设置 / 武器定义，
   * 所以对正式对局的数值和行为没有任何影响。
   */
  /** 血量上限（训练场面板显示 / 重设血量用） */
  maxHp?: number;
  /** 覆盖全局移动速度 */
  speedOverride?: number;
  /** 覆盖全局视野 */
  sightOverride?: number;
  /** 伤害倍率，默认 1 */
  dmgMul?: number;
  /** 射速倍率，默认 1（越大射击间隔越短） */
  cdMul?: number;
  /** 无敌：完全免疫撕咬掉血与异变（训练场专用） */
  invincible?: boolean;
  /**
   * 「尸潮求生」的玩家操控标记：true 时不走 AI 走位 / 闲逛，
   * 改用 moveX / moveY 输入移动，索敌与开火仍复用 AI 逻辑。
   */
  manual?: boolean;
  moveX?: number;
  moveY?: number;
  /** 覆盖武器散布（弧度半宽）；生存模式单人射击用，未设置时沿用武器定义 */
  spreadOverride?: number;
  /** 承伤倍率：撕咬伤害乘以该值；未设置时按 1（生存模式单独调低） */
  damageTakenMul?: number;
  /** 通用属性：每次开火额外增加的投射物数量（0..4；电击枪为额外弧线数） */
  extraProjectiles?: number;
  /** 暴击率 0..1；未设置 = 不会暴击 */
  critChance?: number;
  /** 暴击伤害倍率（如 1.5 = 150%）；未设置按 1 */
  critMul?: number;
}

export interface Zombie {
  id: number;
  x: number;
  y: number;
  /** 僵尸类型 id：如 "normal" / "runner" / "fat" */
  kind: string;
  hp: number;
  speed: number;
  /** 物理碰撞半径（生成时快照，设置面板不覆盖半径） */
  radius: number;
  /** 通行直径 = 身体直径(2r)；开口净宽小于它时不可通过（胖子 22 > 窗 18） */
  bodyDiameter: number;
  /** 随机相位，用于行走摇摆，避免尸群完全同步 */
  phase: number;
  /** 撕咬冷却 */
  bite: number;
  /** 每次撕咬对人类的伤害（生成时按定义快照，训练场可单独调整） */
  damage: number;
  /** 受击减速：当前最强一次减速的移速倍率（1 = 未减速） */
  slowMul: number;
  /** 受击减速：剩余恢复时间（秒）；0 表示已完全恢复 */
  slowTimer: number;
  /** 受击闪白剩余时间（秒），只影响渲染 */
  flash: number;
  /** 喷火持续伤害上一次结算减速的 world.time，用于每秒最多一次的限制 */
  lastFlameSlow: number;
  /** 重新索敌的计时 */
  retarget: number;
  /** 追击目标坐标（漫游时保留最后一次索敌坐标，仅供扩展逻辑参考） */
  tx: number;
  ty: number;
  /** 行为状态：hunt 索敌进攻 / wander 场上零人类时漫游 */
  mode: ZombieMode;
  /**
   * breach 追击：当前要破除的开口 id（走向它、只啃它）。
   * null 表示本区有人类、直接追人，或处在无解漫游状态。
   */
  goalOpening: string | null;
  /**
   * 选定 goalOpening 时，破开它之后仍需付出的等效距离（像素）。
   * 换目标时用「到门口的距离 + 剩余破拆时间折算 + 这段后续距离」
   * 和别的候选路线比较，避免刚破一扇门就全场改道。
   */
  goalOnward: number;
  /** breach 追击：本区没有活人且找不到破口路径时，退化为漫游，不贴墙顶门 */
  stranded: boolean;
  /** 漫游朝向（弧度）；仅 mode === "wander" 时由行为层推进 */
  wanderAngle: number;
  /** 漫游当前动作的剩余时间（秒）：移动段与停顿段共用 */
  wanderTimer: number;
  /** 漫游是否处于停顿段 */
  wanderRest: boolean;
  /**
   * 飞扑者状态机：0 无 / 1 蓄力 / 2 飞扑。扑空或挣脱后回到 0，
   * 由 leapCooldown 控制攻击冷却（冷却期间照常移动）。
   * 非飞扑者恒为 0，不参与任何判定。
   */
  leapPhase: 0 | 1 | 2;
  /** 当前蓄力 / 飞扑状态的剩余时间（秒） */
  leapTimer: number;
  /**
   * 扑空或挣脱后的攻击冷却（秒）：>0 时照常移动，但不会蓄力 / 飞扑。
   * 非飞扑者恒为 0。
   */
  leapCooldown: number;
  /** 蓄力时锁定的目标人类 id；null 表示没有目标 */
  leapTargetId: number | null;
  /** 飞扑方向（单位向量），起跳瞬间锁定，保证直线扑出 */
  leapDX: number;
  leapDY: number;
  /** 正在压制的人类 id；非空时原地不动 */
  pinTargetId: number | null;
  /** 腐蚀者吐毒冷却（秒），0 表示可以吐 */
  spit: number;
  /** 母体下一次产卵的倒计时（秒）；非母体恒为 0 */
  spawnerTimer: number;
  /** 尖叫者下一次尖叫的倒计时（秒）；非尖叫者恒为 0 */
  screamTimer: number;
  /** 被尖叫强化的剩余时间（秒）；>0 时按下面的倍率生效 */
  buffTimer: number;
  /** 强化：移速 / 攻击力 / 承伤倍率（未强化时均为 1） */
  buffSpeedMul: number;
  buffDamageMul: number;
  buffTakenMul: number;
  /** 由哪只母体产出；null 表示自然出怪 */
  spawnedBy: number | null;
  /** 击杀经验折算倍率（母体子体 0.7，自然出怪 1） */
  xpMul: number;
  alive: boolean;
  /** 训练场用：血量上限（面板显示 / 重设血量） */
  maxHp?: number;
  /** 训练场用：覆盖该个体的撕咬间隔 */
  biteCycle?: number;
}

export type BulletKind = "bullet" | "rocket";

/** 伤害来源 —— 训练场做「按武器聚合」的 DPS 统计时用 */
export interface DamageSource {
  /** 武器 id；null 表示无来源（例如场景伤害） */
  weapon: string | null;
  /** 开火的人类 id */
  humanId: number;
}

export interface Bullet {
  x: number;
  y: number;
  /** 上一帧位置，碰撞检测用线段而不是点，防止高速穿透 */
  px: number;
  py: number;
  vx: number;
  vy: number;
  damage: number;
  kind: BulletKind;
  /** 爆炸半径（仅火箭） */
  blast: number;
  life: number;
  alive: boolean;
  /** 训练场统计用：产生这颗子弹的武器 id / 人类 id / 伤害倍率 */
  weapon?: string;
  ownerId?: number;
  dmgMul?: number;
  /** 剩余可穿透目标数（0 = 命中即消失）；狙击枪由武器定义写入 */
  pierceLeft?: number;
  /** 穿透后每个目标相对上一个的伤害倍率 */
  pierceFalloff?: number;
  /** 该弹道已命中过的僵尸 id，避免同一目标被重复结算 */
  hitIds?: number[];
  /** 曳光拖尾长度（像素），0 / 缺省表示不画 */
  tracer?: number;
}

/**
 * 运行时的门窗实例（配置模板在 MapDef.openings，每局各复制一份）。
 * hp 被丧尸啃到归零后 broken，僵尸即可穿过；窗穿过时还会被窗檐减速。
 */
export interface Opening {
  /** 与 MapDef.openings 的 id 一致，便于编辑器 / 存档按实例定位 */
  id: string;
  kind: "door" | "window";
  rect: Rect;
  hp: number;
  maxHp: number;
  passSpeed: number;
  broken: boolean;
}

/** 防守岗哨：(x,y) 是站位，(ox,oy) 是负责看守的开口中心（站定时朝这瞄准） */
export interface Post {
  x: number;
  y: number;
  ox: number;
  oy: number;
}

export type EffectKind = "blast" | "ember" | "arc" | "ring" | "blood";

/** 纯视觉特效，不参与逻辑 */
export interface Effect {
  kind: EffectKind;
  x: number;
  y: number;
  angle: number;
  radius: number;
  color: number;
  age: number;
  life: number;
  /** ember 粒子的漂移速度（像素/秒），ageEffects 里推进；不填则原地消散 */
  vx?: number;
  vy?: number;
  /** arc 电弧的顶点序列（世界坐标）；渲染层据此画抖动曲线 */
  points?: Array<{ x: number; y: number }>;
  /** arc 的视觉强度（首跳 1，之后随链式衰减递减）；渲染层据此缩放线宽与亮度 */
  strength?: number;
}

/** 子弹擦边容差：贴着开口边缘 10px 内的墙算“打在门框/窗框上”，弹道放行 */
const BULLET_GRAZE = 10;

/** 预计算：把墙段朝相邻开口的一侧收缩 BULLET_GRAZE，子弹才不至于全糊在墙沿上 */
function computeBulletWalls(map: MapDef): Rect[] {
  return map.walls.map((w) => {
    const r = { ...w };
    const horizontal = w.h <= w.w; // 横墙（上/下），开口在左右两端
    for (const o of map.openings) {
      if (horizontal) {
        // 开口紧贴墙段右端 / 左端（门窗与墙同厚，坐标严丝合缝）
        if (Math.abs(o.rect.x - (w.x + w.w)) < 1) r.w -= BULLET_GRAZE;
        else if (Math.abs(o.rect.x + o.rect.w - w.x) < 1) {
          r.x += BULLET_GRAZE;
          r.w -= BULLET_GRAZE;
        }
      } else {
        // 竖墙（左/右），开口在上下两端
        if (Math.abs(o.rect.y - (w.y + w.h)) < 1) r.h -= BULLET_GRAZE;
        else if (Math.abs(o.rect.y + o.rect.h - w.y) < 1) {
          r.y += BULLET_GRAZE;
          r.h -= BULLET_GRAZE;
        }
      }
    }
    return r;
  });
}

export class World {
  /** 当前地图（训练场地形画笔会替换成画过地形的副本） */
  map: MapDef;
  humans: Human[] = [];
  zombies: Zombie[] = [];
  bullets: Bullet[] = [];
  effects: Effect[] = [];
  /** 飞行中的腐蚀毒液弹；落地后转成 poison 池 */
  poisonShots: PoisonShot[] = [];
  /** 本局的门窗实例 —— 重开时按地图默认值 + 玩家覆盖值重建 */
  openings: Opening[];
  /** 防守岗哨点，由 Game.assignPosts() 开局分配 */
  posts: Post[] = [];
  /** 当前行为模式（Game 每帧同步进来） */
  mode: HumanMode = "defend";
  zombieGrid: SpatialHash<Zombie>;
  humanGrid: SpatialHash<Human>;
  flow: FlowField;
  /** 按通行直径缓存的流场：普通 11 / 狂奔 9 都共用 flow，胖子另建一张绕开窗洞 */
  private flowCache = new Map<number, FlowField>();
  /** 按通行直径缓存的连通区域图：完好门窗是边界，破口按体型放行 */
  private regionCache = new Map<number, RegionMap>();
  /** 以“活人”为源的追击流场：同区追人时绕过墙体，按体型缓存并定期刷新 */
  private humanFlowCache = new Map<number, { field: FlowField; built: number }>();
  /** 以“指定破口目标”为源的流场：跨区走向要破除的开口，按“体型+开口 id”缓存 */
  private openingFlowCache = new Map<string, FlowField>();
  /** 开口 id -> 运行时实例，供 breach 追击按 id 定位目标（O(1)） */
  private readonly openingIndex = new Map<string, Opening>();
  /** 全场最窄开口的净宽：通行直径不超过它的单位直接复用 flow */
  private readonly minOpeningWidth: number;
  time = 0;
  /**
   * 每帧刷新一次的存活人类数量（含正在转化倒计时中的）。
   * 行为层用它决定丧尸处于索敌还是漫游，避免每只丧尸各扫一遍人类数组。
   */
  livingHumans = 0;
  /** 统计：击杀数 / 被感染数 */
  kills = 0;
  infected = 0;
  /*
   * 训练场统计钩子 —— 默认 undefined，正式对局不会调用，零开销。
   * 训练场挂上这两个回调来收集伤害来源、击杀与击杀耗时。
   */
  onDamage?: (z: Zombie, amount: number, source?: DamageSource) => void;
  onKill?: (z: Zombie, source?: DamageSource) => void;
  /** 人类被撕咬（训练场统计“被咬次数 / 掉血”，与武器伤害表分开） */
  onHumanDamage?: (h: Human, amount: number) => void;
  /** 人类异变完成（训练场统计转化数） */
  onHumanTurn?: (h: Human) => void;
  /** 电击枪一次放电结算（训练场统计命中数 / 单体加成次数） */
  onTeslaVolley?: (hits: number, singleBonus: boolean) => void;
  private nextId = 1;
  private readonly bulletWalls: Rect[];
  /** 单位 / 寻路共同使用的阻挡矩形：墙体 + 水池（子弹与视线仍只用墙体） */
  private blockers: Rect[];
  /** 草丛逐格运行时状态（燃烧 / 休眠 / 重生） */
  grass: GrassTileState[];
  /**
   * 腐蚀毒液池运行时状态（吐出的 + 腐蚀者死亡留下的）。
   * 与草丛同属地形级状态，由 tickTerrain 统一推进。
   */
  poison: PoisonPool[];
  /** 草丛瓦片索引：<列主序格子号, grass 下标>，用于 O(1) 位置查询 */
  private readonly grassIndex = new Map<number, number>();
  private readonly grassCols: number;

  constructor(map: MapDef = DEFAULT_MAP) {
    // 先切设置口径，再按每扇开口自己的 JSON 默认值建实例
    this.map = map;
    setActiveMap(map);
    this.openings = map.openings.map((def) => {
      const { maxHp, passSpeed } = openingInstance(def);
      return {
        id: def.id,
        kind: def.kind,
        rect: def.rect,
        hp: maxHp,
        maxHp,
        passSpeed,
        broken: false,
      };
    });
    this.zombieGrid = new SpatialHash<Zombie>(map.width, map.height, 56);
    this.humanGrid = new SpatialHash<Human>(map.width, map.height, 56);
    this.flow = new FlowField(map);
    this.minOpeningWidth = Math.min(...map.openings.map((o) => openingNetWidth(o.rect)));
    this.bulletWalls = computeBulletWalls(map);
    // 水池并入导航阻挡，但不进入 bulletWalls / sightBlocked
    this.blockers = [...map.walls, ...map.waterBlockers];
    this.grassCols = Math.ceil(map.width / TILE_SIZE);
    this.grass = map.grassTiles.map<GrassTileState>((r) => ({ x: r.x, y: r.y, phase: 0, timer: 0 }));
    this.poison = [];
    this.grass.forEach((g, i) => {
      const tx = Math.floor(g.x / TILE_SIZE);
      const ty = Math.floor(g.y / TILE_SIZE);
      this.grassIndex.set(ty * this.grassCols + tx, i);
    });
    for (const o of this.openings) this.openingIndex.set(o.id, o);
  }

  /**
   * 训练场地形画笔：替换地图的地形数据并重建阻挡 / 草丛 / 流场 / 区域缓存，保留单位。
   * 只用于训练场沙盒；正式对局的地图不会在运行中变化。
   */
  applyTerrainMap(map: MapDef): void {
    const prevGrass = new Map<string, GrassTileState>();
    for (const g of this.grass) prevGrass.set(`${g.x},${g.y}`, g);
    this.map = map;
    setActiveMap(map);
    this.flow = new FlowField(map);
    this.blockers = [...map.walls, ...map.waterBlockers];
    this.grass = map.grassTiles.map<GrassTileState>((r) => {
      const old = prevGrass.get(`${r.x},${r.y}`);
      return old ? old : { x: r.x, y: r.y, phase: 0, timer: 0 };
    });
    this.grassIndex.clear();
    this.grass.forEach((g, i) => {
      const tx = Math.floor(g.x / TILE_SIZE);
      const ty = Math.floor(g.y / TILE_SIZE);
      this.grassIndex.set(ty * this.grassCols + tx, i);
    });
    this.flowCache.clear();
    this.regionCache.clear();
    this.humanFlowCache.clear();
    this.openingFlowCache.clear();
  }

  /** 草丛格子的有效程度：0 = 完全失效，1 = 正常；重生期间线性恢复 */
  grassEffectAt(x: number, y: number): number {
    const g = this.grassTileAt(x, y);
    if (!g) return 0;
    if (g.phase === 0) return 1;
    if (g.phase === 3) {
      return Math.min(1, Math.max(0, 1 - g.timer / TERRAIN.grass.regrowFade));
    }
    return 0;
  }

  /** 点燃包含该点的草丛格；持续喷火会不断刷新燃烧计时 */
  igniteGrassAt(x: number, y: number): void {
    const g = this.grassTileAt(x, y);
    if (!g) return;
    g.phase = 1;
    g.timer = TERRAIN.grass.burnTime;
  }

  /** 推进草丛的燃烧 / 休眠 / 重生计时（各会话每帧调用一次） */
  tickTerrain(dt: number): void {
    for (const g of this.grass) {
      if (g.phase === 1) {
        g.timer -= dt;
        if (g.timer <= 0) {
          g.phase = 2;
          g.timer = TERRAIN.grass.regrowDelay;
        }
      } else if (g.phase === 2) {
        g.timer -= dt;
        if (g.timer <= 0) {
          g.phase = 3;
          g.timer = TERRAIN.grass.regrowFade;
        }
      } else if (g.phase === 3) {
        g.timer -= dt;
        if (g.timer <= 0) {
          g.phase = 0;
          g.timer = 0;
        }
      }
    }
    this.tickPoison(dt);
    this.tickPoisonShots(dt);
  }

  /**
   * 吐出一发抛物线毒液弹。落点在吐出瞬间锁定，飞行途中不追踪，
   * 所以人类可以在 0.6–0.8 秒的飞行时间里走位躲开。
   * 飞行本身不结算任何伤害，落地后由 tickPoisonShots 生成毒液池。
   */
  spitPoison(
    x0: number,
    y0: number,
    tx: number,
    ty: number,
    radius: number,
    duration: number,
    dps: number,
    speedMul: number,
  ): void {
    const dist = Math.hypot(tx - x0, ty - y0);
    // 飞行时长按距离换算并夹在 0.6–0.8 秒：太近也要看得见飞行过程
    const dur = Math.max(0.6, Math.min(0.8, dist / 300));
    this.poisonShots.push({
      x0,
      y0,
      x: x0,
      y: y0,
      tx,
      ty,
      t: 0,
      dur,
      radius,
      duration,
      dps,
      speedMul,
    });
  }

  /** 推进毒液弹；落地瞬间生成毒液池并留下溅射特效 */
  private tickPoisonShots(dt: number): void {
    if (this.poisonShots.length === 0) return;
    let write = 0;
    for (let i = 0; i < this.poisonShots.length; i++) {
      const s = this.poisonShots[i];
      s.t += dt;
      const p = Math.min(1, s.t / s.dur);
      s.x = s.x0 + (s.tx - s.x0) * p;
      s.y = s.y0 + (s.ty - s.y0) * p;
      if (p < 1) {
        this.poisonShots[write++] = s;
        continue;
      }
      this.addPoison(s.tx, s.ty, s.radius, s.duration, s.dps, s.speedMul);
      // 落地音效：只在这一刻响，抛出时静音（120ms 限频，多枚同时落地不会叠炸）
      sound.play(SFX.ZOMBIE_SPLAT, 0.85);
      // 落地溅射：一圈扩散环 + 几团绿色小雾，与飞行中的毒液弹明显区分
      this.effects.push({
        kind: "ring",
        x: s.tx,
        y: s.ty,
        angle: 0,
        radius: s.radius * 0.6,
        color: 0x84cc16,
        age: 0,
        life: 0.3,
      });
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + Math.random() * 0.4;
        const speed = 40 + Math.random() * 30;
        this.effects.push({
          kind: "ember",
          x: s.tx + Math.cos(a) * s.radius * 0.35,
          y: s.ty + Math.sin(a) * s.radius * 0.35,
          angle: a,
          radius: 2.2 + Math.random() * 1.4,
          color: 0xa3e635,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          age: 0,
          life: 0.2 + Math.random() * 0.12,
        });
      }
    }
    this.poisonShots.length = write;
  }

  /**
   * 添加一团毒液。同位置（中心相距 ≤ 8px）已有更强或同强的毒液时只刷新计时，
   * 否则替换掉较弱的一团，避免同位置叠出多份伤害。
   */
  addPoison(x: number, y: number, radius: number, duration: number, dps: number, speedMul: number): void {
    if (duration <= 0 || radius <= 0) return;
    for (let i = 0; i < this.poison.length; i++) {
      const p = this.poison[i];
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy <= 64) {
        if (p.dps >= dps) {
          // 已有更强：只合并范围 / 时长 / 更强减速，不叠加伤害
          p.radius = Math.max(p.radius, radius);
          p.speedMul = Math.min(p.speedMul, speedMul);
          p.remaining = Math.max(p.remaining, duration);
          p.total = Math.max(p.total, duration);
          return;
        }
        this.poison.splice(i, 1);
        break;
      }
    }
    this.poison.push({ x, y, radius, remaining: duration, total: duration, dps, speedMul });
  }

  /** 某点的有效毒液效果；多团重叠时伤害取最高、减速取最强，不叠加 */
  poisonEffectAt(x: number, y: number): PoisonEffect | null {
    let dps = 0;
    let speedMul = 1;
    let found = false;
    for (const p of this.poison) {
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy > p.radius * p.radius) continue;
      found = true;
      if (p.dps > dps) dps = p.dps;
      if (p.speedMul < speedMul) speedMul = p.speedMul;
    }
    return found ? { dps, speedMul } : null;
  }

  /**
   * 推进毒液计时并结算池内人类伤害。
   * 只伤害人类：丧尸不受影响；不写 blockers / bulletWalls，因此不挡单位、子弹与视线。
   */
  private tickPoison(dt: number): void {
    let write = 0;
    for (const p of this.poison) {
      p.remaining -= dt;
      if (p.remaining > 0) this.poison[write++] = p;
    }
    this.poison.length = write;
    if (this.poison.length === 0) return;

    const turnTime = settings().human.turnTime;
    for (const h of this.humans) {
      if (!h.alive || h.invincible) continue;
      const effect = this.poisonEffectAt(h.x, h.y);
      if (!effect) continue;
      const taken = effect.dps * dt;
      const applied = Math.min(taken, Math.max(0, h.hp));
      h.hp = Math.max(0, h.hp - taken);
      if (applied > 0) h.hurtTimer = Math.max(h.hurtTimer, 1);
      if (h.hp <= 0 && h.turning <= 0) h.turning = turnTime;
    }
  }

  private grassTileAt(x: number, y: number): GrassTileState | undefined {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    if (tx < 0 || ty < 0 || tx >= this.grassCols) return undefined;
    const idx = this.grassIndex.get(ty * this.grassCols + tx);
    return idx === undefined ? undefined : this.grass[idx];
  }

  /** 按 id 取运行时开口实例（breach 追击的破口目标用） */
  opening(id: string): Opening | undefined {
    return this.openingIndex.get(id);
  }

  /**
   * 按通行直径取连通区域图；首次访问时构建，之后 O(1) 复用。
   * 不同体型对应不同的可穿越开口集合（胖子 22 钻不过 16 的窗）。
   */
  regionMap(bodyDiameter: number): RegionMap {
    let region = this.regionCache.get(bodyDiameter);
    if (!region) {
      region = new RegionMap(this.map, this.openings, bodyDiameter);
      this.regionCache.set(bodyDiameter, region);
    }
    return region;
  }

  /**
   * 把“当前体型过不去”的开口矩形并入墙体：完好的门窗、破损但过窄的开口。
   * 追击流场用它做障碍，避免把僵尸往还关着 / 钻不过的洞口引。
   * exceptId 用于“走向目标破口”的流场：目标开口本身要留作缺口。
   */
  private blockedOpeningRects(bodyDiameter: number, exceptId?: string): Rect[] {
    const blocked: Rect[] = [];
    for (const o of this.openings) {
      if (o.id === exceptId) continue;
      if (o.broken && openingNetWidth(o.rect) >= bodyDiameter) continue;
      blocked.push(o.rect);
    }
    return blocked;
  }

  /** 用“墙体 + 体型过不去的开口”合成一张只留通行缺口的导航地图 */
  private navMap(bodyDiameter: number, exceptId?: string): MapDef {
    return {
      ...this.map,
      walls: [...this.blockers, ...this.blockedOpeningRects(bodyDiameter, exceptId)],
      waterBlockers: [],
      openings: [],
    };
  }

  /**
   * 同区追击流场：以所有活人为源，障碍是墙体与“过不去”的开口。
   * 直扑人类遇到墙角 / 门框绕不过去时，沿这张场走。
   * 人类会移动，所以按固定间隔（0.6 秒）刷新，查询仍是 O(1)。
   */
  humanFlowFor(bodyDiameter: number): FlowField | null {
    const cached = this.humanFlowCache.get(bodyDiameter);
    if (cached && this.time - cached.built < 0.6) return cached.field;
    const sources: { x: number; y: number }[] = [];
    for (let i = 0; i < this.humans.length; i++) {
      const h = this.humans[i];
      if (h.alive) sources.push({ x: h.x, y: h.y });
    }
    if (sources.length === 0) return null;
    const field = new FlowField(this.navMap(bodyDiameter), 0, sources);
    this.humanFlowCache.set(bodyDiameter, { field, built: this.time });
    return field;
  }

  /**
   * 走向指定开口的流场：以该开口中心为源，其它过不去的开口按墙处理。
   * 跨区追击时用它绕过外墙 / 内墙，而不是朝开口中心走直线撞墙。
   * 开口破碎或换图时缓存整体清空。
   */
  openingFlow(openingId: string, bodyDiameter: number): FlowField | null {
    const op = this.opening(openingId);
    if (!op) return null;
    const key = `${bodyDiameter}:${openingId}`;
    let field = this.openingFlowCache.get(key);
    if (!field) {
      field = new FlowField(this.navMap(bodyDiameter, openingId), 0, [
        { x: op.rect.x + op.rect.w * 0.5, y: op.rect.y + op.rect.h * 0.5 },
      ]);
      this.openingFlowCache.set(key, field);
    }
    return field;
  }

  /**
   * 导航拓扑变化（开口被啃破）：立刻丢弃区域图 / 破口流场缓存，并让所有丧尸
   * 下一帧重新决策 —— 不等各自 0.3~0.6 秒的索敌节拍，做到“刚破口就同步”。
   * 原流场与破碎状态无关（开口从来不是流场障碍），不需要重建。
   */
  invalidateNavigation(): void {
    this.regionCache.clear();
    this.humanFlowCache.clear();
    this.openingFlowCache.clear();
    for (let i = 0; i < this.zombies.length; i++) this.zombies[i].retarget = 0;
  }

  /** 按通行直径取流场；所有开口都能过时直接复用共享流场（保持原行为） */
  flowFor(bodyDiameter: number): FlowField {
    if (bodyDiameter <= this.minOpeningWidth) return this.flow;
    let field = this.flowCache.get(bodyDiameter);
    if (!field) {
      field = new FlowField(this.map, bodyDiameter);
      this.flowCache.set(bodyDiameter, field);
    }
    return field;
  }

  /**
   * 点是否卡在墙体或不可穿越的开口里 —— 人类与丧尸共用的移动 / 生成阻挡判定。
   * 完好门窗一律阻挡；破损开口仅在净宽 >= 身体直径时放行。
   * bodyDiameter <= 0 表示不做体型过滤（只判墙体与完好开口）。
   * 具体条件集中在 systems/collision.ts，新地形只需在那里登记。
   */
  solidAt(x: number, y: number, pad = 0, bodyDiameter = 0): boolean {
    return isBlockedForBody(bodyDiameter, x, y, this.blockers, this.openings, pad);
  }

  /** 在指定区域内找最近的可用落点（生成人类 / 巡逻目标点用） */
  findFreeSpot(
    x: number,
    y: number,
    bodyDiameter: number,
    area: SpawnRegion,
    pad = 0,
  ): { x: number; y: number } | null {
    return findFreePoint(bodyDiameter, x, y, this.blockers, this.openings, area, pad);
  }

  /**
   * 子弹弹道是否被挡（与 sightBlocked 的区别）：
   *  - 完好的门挡弹；窗是玻璃，子弹照样穿过去
   *  - 墙体按“开口附近收缩 10px”的版本判定 —— 贴着门框/窗框边缘
   *    的擦边弹放行，否则偏轴守卫的子弹会全部糊在墙沿上
   */
  bulletBlocked(ax: number, ay: number, bx: number, by: number): boolean {
    for (const w of this.bulletWalls) {
      if (segRectHit(ax, ay, bx, by, w)) return true;
    }
    for (const o of this.openings) {
      if (o.kind === "door" && !o.broken && segRectHit(ax, ay, bx, by, o.rect)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 两点连线是否被挡住（人类视线 / 子弹弹道共用）。
   * 墙和完好的门都会挡；窗户是透明的 —— 能隔着玻璃观察和射击。
   * windowPad 给玻璃额外的侧向容差（视线用）：贴在窗沿两侧啃咬的
   * 丧尸也算“看得见”，否则守窗人看不到斜着贴墙的僵尸。
   * 子弹调用时 pad 传 0，严格按窗洞算，不会隔墙开枪。
   */
  sightBlocked(ax: number, ay: number, bx: number, by: number, windowPad = 0): boolean {
    for (const w of this.map.walls) {
      if (segRectHit(ax, ay, bx, by, w)) return true;
    }
    for (const o of this.openings) {
      if (o.kind === "door") {
        if (!o.broken && segRectHit(ax, ay, bx, by, o.rect)) return true;
      } else if (!o.broken) {
        const r = o.rect;
        const pr = {
          x: r.x - windowPad,
          y: r.y,
          w: r.w + windowPad * 2,
          h: r.h,
        };
        if (segRectHit(ax, ay, bx, by, pr)) return true;
      }
    }
    return false;
  }

  spawnHuman(x: number, y: number, weapon: string, hpOverride?: number): Human {
    const def = effectiveWeapon(weapon);
    const hp = hpOverride ?? effectiveHuman().hp;
    const human: Human = {
      id: this.nextId++,
      x,
      y,
      vx: 0,
      vy: 0,
      hp,
      maxHp: hp,
      weapon: def.id,
      ammo: def.magazine,
      reloadTimer: 0,
      fire: 0,
      burst: 0,
      target: null,
      sight: randRange(0, 0.35),
      turning: 0,
      hurtTimer: 0,
      facing: randRange(-Math.PI, Math.PI),
      pinTimer: 0,
      pinBy: null,
      wx: x,
      wy: y,
      wTimer: 0,
      safeX: x,
      safeY: y,
      safeTimer: 0,
      post: -1,
      alive: true,
    };
    this.humans.push(human);
    return human;
  }

  /**
   * 生成一只丧尸 —— 属性按正态分布在僵尸随机幅度内随机。
   * 均值来自实体定义 + 玩家覆盖值，极端值自动夹住下限（避免非正 hp/speed）。
   * 返回新建的个体，训练场需要它来做「生成后重设血量」等操作。
   */
  spawnZombie(x: number, y: number, kind: string, hpScale = 1): Zombie {
    const def = effectiveZombie(kind);
    const j = settings().zombie.jitter;
    const hp = gaussClamped(def.hp, j, def.hp * 0.2, def.hp * 2) * hpScale;
    const speed = gaussClamped(def.speed, j, def.speed * 0.45, def.speed * 1.8);
    const zombie: Zombie = {
      id: this.nextId++,
      x,
      y,
      kind: def.id,
      hp,
      maxHp: hp,
      speed,
      radius: def.radius,
      bodyDiameter: zombieBodyDiameter(def),
      phase: randRange(0, Math.PI * 2),
      bite: 0,
      damage: def.damage,
      slowMul: 1,
      slowTimer: 0,
      flash: 0,
      lastFlameSlow: -1000,
      retarget: randRange(0, 0.3),
      tx: x,
      ty: y,
      mode: "hunt",
      goalOpening: null,
      goalOnward: 0,
      stranded: false,
      wanderAngle: randRange(-Math.PI, Math.PI),
      wanderTimer: 0,
      wanderRest: false,
      leapPhase: 0,
      leapTimer: 0,
      leapCooldown: 0,
      leapTargetId: null,
      leapDX: 0,
      leapDY: 0,
      pinTargetId: null,
      spit: 0,
      spawnerTimer: def.spawner ? def.spawner.interval : 0,
      screamTimer: def.scream ? def.scream.interval : 0,
      buffTimer: 0,
      buffSpeedMul: 1,
      buffDamageMul: 1,
      buffTakenMul: 1,
      spawnedBy: null,
      xpMul: 1,
      alive: true,
    };
    this.zombies.push(zombie);
    return zombie;
  }

  /**
   * 在母体周围环形采样一个空地，产出一只子体。
   * 落点必须在地图内、不在墙体 / 水池里，并与母体身体保持间距；
   * 一圈找不到就换更大的半径，全部失败返回 null（由调用方等下一轮）。
   */
  spawnChild(mother: Zombie, kind: string, xpMul = 1): Zombie | null {
    const def = effectiveZombie(kind);
    const body = zombieBodyDiameter(def);
    const gap = mother.radius + body * 0.5 + 4;
    const minX = body * 0.5;
    const maxX = this.map.width - body * 0.5;
    const minY = body * 0.5;
    const maxY = this.map.height - body * 0.5;
    const steps = 16;
    for (let ring = 0; ring < 4; ring++) {
      const radius = gap + ring * (body + 10);
      const start = Math.random() * Math.PI * 2;
      for (let i = 0; i < steps; i++) {
        const ang = start + (i / steps) * Math.PI * 2;
        const x = mother.x + Math.cos(ang) * radius;
        const y = mother.y + Math.sin(ang) * radius;
        if (x < minX || x > maxX || y < minY || y > maxY) continue;
        if (this.solidAt(x, y, 0, body)) continue;
        const child = this.spawnZombie(x, y, kind);
        child.spawnedBy = mother.id;
        child.xpMul = xpMul;
        return child;
      }
    }
    return null;
  }

  /**
   * 全局 BOSS 血条数据：取场上血量最高的存活母体（多只时另外给出总数）。
   * 没有任何 BOSS 时返回 null，渲染层据此隐藏血条。
   */
  bossBarInfo(): { id: number; name: string; hp: number; maxHp: number; count: number } | null {
    let best: Zombie | null = null;
    let count = 0;
    for (let i = 0; i < this.zombies.length; i++) {
      const z = this.zombies[i];
      if (!z.alive || !getZombieDef(z.kind).boss) continue;
      count++;
      if (!best || z.hp > best.hp) best = z;
    }
    if (!best) return null;
    const def = getZombieDef(best.kind);
    return {
      id: best.id,
      name: def.name,
      hp: Math.max(0, best.hp),
      maxHp: best.maxHp ?? def.hp,
      count,
    };
  }

  /**
   * 刷新存活人类计数（每帧一次）。包含正在转化倒计时中的人类：
   * 只要还有任何一个没变成丧尸，丧尸就保持索敌进攻。
   * 返回值就是当前存活人数，方便行为层直接复用。
   */
  refreshLivingHumans(): number {
    let n = 0;
    for (let i = 0; i < this.humans.length; i++) {
      if (this.humans[i].alive) n++;
    }
    this.livingHumans = n;
    return n;
  }

  /** 每帧开头重建两张空间索引表 */
  rebuildGrids(): void {
    this.humanGrid.clear();
    for (let i = 0; i < this.humans.length; i++) this.humanGrid.insert(this.humans[i]);
    this.zombieGrid.clear();
    for (let i = 0; i < this.zombies.length; i++) this.zombieGrid.insert(this.zombies[i]);
  }

  /** 每帧末尾清除死亡实体：原地把活着的往前挪，不产生新数组 */
  compact(): void {
    compactAlive(this.humans);
    compactAlive(this.zombies);
    compactAlive(this.bullets);
    let w = 0;
    for (let i = 0; i < this.effects.length; i++) {
      const e = this.effects[i];
      if (e.age < e.life) this.effects[w++] = e;
    }
    this.effects.length = w;
  }

  ageEffects(dt: number): void {
    for (let i = 0; i < this.effects.length; i++) {
      const e = this.effects[i];
      e.age += dt;
      // ember 火星粒子带初速，边飞边散；其他特效原地消散
      if (e.vx !== undefined || e.vy !== undefined) {
        e.x += (e.vx ?? 0) * dt;
        e.y += (e.vy ?? 0) * dt;
      }
    }
  }
}

/** 按地图创建一个独立世界；默认地图保持原入口行为 */
export function createWorld(map: MapDef = DEFAULT_MAP): World {
  return new World(map);
}

/** 原地压缩数组：保留 alive 的项，顺序不保证（视觉上无所谓） */
function compactAlive<T extends { alive: boolean }>(arr: T[]): void {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].alive) arr[w++] = arr[i];
  }
  arr.length = w;
}
