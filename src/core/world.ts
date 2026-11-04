/**
 * World —— 存放所有游戏实体的数据容器。
 *
 * 这里只有“数据和数据操作”，没有玩法逻辑：
 *  - 四类实体：人类 / 丧尸 / 子弹 / 特效，都用普通数组存放
 *  - 两张空间哈希表（丧尸一张、人类一张），每帧由 rebuildGrids() 重建
 *  - 一张流场表（丧尸找路用）
 *
 * 玩法逻辑分别在 systems/ai.ts、systems/combat.ts，
 * 流程调度在 core/game.ts。
 */
import {
  OPENINGS,
  SETTINGS,
  WALLS,
  WEAPONS,
  WORLD,
} from "../config";
import type { HumanMode, Rect } from "../config";
import { FlowField } from "../systems/flowField";
import { gaussClamped, insideRect, randRange, segRectHit } from "../utils/math";
import { SpatialHash } from "../utils/spatialHash";

export interface Human {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  /** WEAPONS 的下标：0 机枪 / 1 喷火 / 2 霰弹 / 3 火箭 */
  weapon: number;
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
}

export interface Zombie {
  id: number;
  x: number;
  y: number;
  /** ZOMBIE_DEFS 下标：0 普通 / 1 狂奔 */
  kind: 0 | 1;
  hp: number;
  speed: number;
  /** 随机相位，用于行走摇摆，避免尸群完全同步 */
  phase: number;
  /** 撕咬冷却 */
  bite: number;
  /** 重新索敌的计时 */
  retarget: number;
  /** 追击目标坐标 */
  tx: number;
  ty: number;
  alive: boolean;
}

export type BulletKind = "bullet" | "rocket";

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
}

/**
 * 运行时的门窗实例（配置模板在 config.OPENINGS，每局各复制一份）。
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

export type EffectKind = "blast" | "ember";

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
}

/** 子弹擦边容差：贴着开口边缘 10px 内的墙算“打在门框/窗框上”，弹道放行 */
const BULLET_GRAZE = 10;

/** 预计算：把墙段朝相邻开口的一侧收缩 BULLET_GRAZE，子弹才不至于全糊在墙沿上 */
const BULLET_WALLS: Rect[] = (() => {
  return WALLS.map((w) => {
    const r = { ...w };
    const horizontal = w.h <= w.w; // 横墙（上/下），开口在左右两端
    for (const o of OPENINGS) {
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
})();

export class World {
  humans: Human[] = [];
  zombies: Zombie[] = [];
  bullets: Bullet[] = [];
  effects: Effect[] = [];
  /**
   * 本局的门窗实例 —— 重开时按 SETTINGS.opening 重建，
   * maxHp 受滑块影响；hp 被啃到归零后 broken。
   */
  openings: Opening[] = OPENINGS.map((def) => {
    const maxHp = def.kind === "door" ? SETTINGS.opening.doorHp : SETTINGS.opening.winHp;
    return {
      kind: def.kind,
      rect: def.rect,
      hp: maxHp,
      maxHp,
      passSpeed: def.kind === "window" ? SETTINGS.opening.winPassSpeed : 1,
      broken: false,
    };
  });
  /** 防守岗哨点，由 Game.assignPosts() 开局分配 */
  posts: Post[] = [];
  /** 当前行为模式（Game 每帧同步进来） */
  mode: HumanMode = "defend";
  zombieGrid = new SpatialHash<Zombie>(WORLD.width, WORLD.height, 56);
  humanGrid = new SpatialHash<Human>(WORLD.width, WORLD.height, 56);
  flow = new FlowField();
  time = 0;
  /** 统计：击杀数 / 被感染数 */
  kills = 0;
  infected = 0;
  private nextId = 1;

  /**
   * 点是否卡在墙体或“完好”的门窗里 —— 丧尸移动碰撞用。
   * 破损的门窗不算：僵尸可以从破口钻进来。
   */
  solidAt(x: number, y: number, pad = 0): boolean {
    for (const w of WALLS) {
      if (insideRect(x, y, w, pad)) return true;
    }
    for (const o of this.openings) {
      if (!o.broken && insideRect(x, y, o.rect, pad)) return true;
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
    for (const w of BULLET_WALLS) {
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
    for (const w of WALLS) {
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

  spawnHuman(x: number, y: number, weapon: number): void {
    this.humans.push({
      id: this.nextId++,
      x,
      y,
      vx: 0,
      vy: 0,
      hp: SETTINGS.human.hp,
      weapon,
      ammo: WEAPONS[weapon].magazine,
      reloadTimer: 0,
      fire: 0,
      burst: 0,
      target: null,
      sight: randRange(0, 0.35),
      turning: 0,
      facing: randRange(-Math.PI, Math.PI),
      wx: x,
      wy: y,
      wTimer: 0,
      post: -1,
      alive: true,
    });
  }

  /**
   * 生成一只丧尸 —— 属性按正态分布在 SETTINGS.zombie.jitter 幅度内随机。
   * 均值用 SETTINGS.zombie.normal / runner，极端值自动夹住下限（避免非正 hp/speed）。
   */
  spawnZombie(x: number, y: number, kind: 0 | 1, hpScale = 1): void {
    const zType = SETTINGS.zombie[kind === 0 ? "normal" : "runner"];
    const j = SETTINGS.zombie.jitter;
    const hp = gaussClamped(zType.hp, j, zType.hp * 0.2, zType.hp * 2) * hpScale;
    const speed = gaussClamped(zType.speed, j, zType.speed * 0.45, zType.speed * 1.8);
    this.zombies.push({
      id: this.nextId++,
      x,
      y,
      kind,
      hp,
      speed,
      phase: randRange(0, Math.PI * 2),
      bite: 0,
      retarget: randRange(0, 0.3),
      tx: x,
      ty: y,
      alive: true,
    });
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

/** 原地压缩数组：保留 alive 的项，顺序不保证（视觉上无所谓） */
function compactAlive<T extends { alive: boolean }>(arr: T[]): void {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].alive) arr[w++] = arr[i];
  }
  arr.length = w;
}
