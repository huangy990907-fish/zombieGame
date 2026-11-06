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
import { effectiveHuman, effectiveWeapon, effectiveZombie, openingTuning, settings } from "../data/settings/runtime";
import { zombieBodyDiameter } from "../data/zombies";
import type { HumanMode, Rect, ZombieMode } from "../data/types";
import { FlowField, openingNetWidth } from "../systems/flowField";
import { gaussClamped, insideRect, randRange, segRectHit } from "../utils/math";
import { SpatialHash } from "../utils/spatialHash";

export interface Human {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  /** 武器 id：如 "mg" / "flame" / "shotgun" / "rocket" */
  weapon: string;
  /** 当前弹匣剩余弹药 */
  ammo: number;
  /** >0 表示正在换弹，倒计时结束后回满弹药 */
  reloadTimer: number;
  /** 开火冷却，>0 时不能射击；喷火时表示两次伤害结算的间隔 */
  fire: number;
  /** >0 表示喷火正在持续喷射，剩余喷射时间；其他武器恒为 0 */
  burst: number;
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
  /** 闲逛目标点 */
  wx: number;
  wy: number;
  /** 闲逛目标点的刷新计时 */
  wTimer: number;
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
  /** 漫游朝向（弧度）；仅 mode === "wander" 时由行为层推进 */
  wanderAngle: number;
  /** 漫游当前动作的剩余时间（秒）：移动段与停顿段共用 */
  wanderTimer: number;
  /** 漫游是否处于停顿段 */
  wanderRest: boolean;
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
}

/**
 * 运行时的门窗实例（配置模板在 MapDef.openings，每局各复制一份）。
 * hp 被丧尸啃到归零后 broken，僵尸即可穿过；窗穿过时还会被窗檐减速。
 */
export interface Opening {
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

export type EffectKind = "blast" | "ember" | "arc";

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
  /** arc 闪电折线的顶点序列（世界坐标）；渲染层据此画不规则折线 */
  points?: Array<{ x: number; y: number }>;
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
  humans: Human[] = [];
  zombies: Zombie[] = [];
  bullets: Bullet[] = [];
  effects: Effect[] = [];
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

  constructor(readonly map: MapDef = DEFAULT_MAP) {
    const tuning = openingTuning(map);
    this.openings = map.openings.map((def) => {
      const maxHp = def.kind === "door" ? tuning.doorHp : tuning.winHp;
      return {
        kind: def.kind,
        rect: def.rect,
        hp: maxHp,
        maxHp,
        passSpeed: def.kind === "window" ? tuning.winPassSpeed : 1,
        broken: false,
      };
    });
    this.zombieGrid = new SpatialHash<Zombie>(map.width, map.height, 56);
    this.humanGrid = new SpatialHash<Human>(map.width, map.height, 56);
    this.flow = new FlowField(map);
    this.minOpeningWidth = Math.min(...map.openings.map((o) => openingNetWidth(o.rect)));
    this.bulletWalls = computeBulletWalls(map);
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
   * 点是否卡在墙体或“完好”的门窗里 —— 丧尸移动碰撞用。
   * 破损的门窗不算：僵尸可以从破口钻进来。
   * bodyDiameter > 0 时，破损但净宽小于该直径的开口也算实体墙：
   * 这是通用体型规则，不为某一种僵尸写特例（胖子 22 进不了 18 的窗）。
   */
  solidAt(x: number, y: number, pad = 0, bodyDiameter = 0): boolean {
    for (const w of this.map.walls) {
      if (insideRect(x, y, w, pad)) return true;
    }
    for (const o of this.openings) {
      const tooNarrow = bodyDiameter > 0 && openingNetWidth(o.rect) < bodyDiameter;
      if ((!o.broken || tooNarrow) && insideRect(x, y, o.rect, pad)) return true;
    }
    return false;
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

  spawnHuman(x: number, y: number, weapon: string): Human {
    const def = effectiveWeapon(weapon);
    const hp = effectiveHuman().hp;
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
      wx: x,
      wy: y,
      wTimer: 0,
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
      wanderAngle: randRange(-Math.PI, Math.PI),
      wanderTimer: 0,
      wanderRest: false,
      alive: true,
    };
    this.zombies.push(zombie);
    return zombie;
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
