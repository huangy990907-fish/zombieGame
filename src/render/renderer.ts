/**
 * 渲染层 —— 把 World 里的数据画出来。
 *
 * 只读数据不改数据，和逻辑层完全解耦：
 *  - 单位使用 src/art 的 32×32 像素精灵：纹理在启动时按 (精灵 id, 帧) 预生成并缓存，
 *    每帧只切 Sprite.texture，不新建 canvas / 纹理
 *  - Sprite 按数组下标复用（sync() 池化），不随实体生死反复创建销毁
 *  - 动画状态机（idle / walk / fire / 死亡定格）状态挂在渲染器本地 Map 上，按实体 id 索引
 *  - 转化中的人类 = human-defected 精灵 + 高频闪烁
 */
import { Application, CanvasSource, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { COMBO_SPRITES, SPRITE_LIST, SPRITE_SIZE, getNativeFrame, getSprite, type SpriteDef } from "../art";
import { DEFAULT_MAP, type MapDef } from "../data/maps";
import { effectiveZombie, settings } from "../data/settings/runtime";
import type { Human, World, Zombie } from "../core/world";
import { HUMAN_DIAMETER, humanSpriteId, spriteDef, spriteRotation, spriteScale, VISUAL_SCALE, zombieSpriteId } from "./pixel";

/** 单条伤害飘字（训练场用，渲染层只负责画，生命周期由训练场会话管理） */
export interface FloatingText {
  x: number;
  y: number;
  text: string;
  color: number;
  age: number;
  life: number;
  /** 每秒上飘速度（像素/秒） */
  vy: number;
}

/** 渲染附加信息：正式对局不传，训练场用它画选中框和飘字 */
export interface RenderExtra {
  selection?: { x: number; y: number; radius: number } | null;
  floating?: FloatingText[];
}

/** 圆点贴图的实心核心半径，缩放时以此为基准（只用于子弹/特效，单位已改用像素精灵） */
const CORE_R = 11;

/** 脚步帧切换所需累计移动距离（像素） */
const WALK_STEP_DIST = 9;
/** 判定“在移动”的速度阈值（像素/秒），低于它按 idle 处理 */
const MOVE_SPEED = 12;
/** 开火帧停留时长（秒），略长于机枪 0.1s 冷却 */
const FIRE_HOLD = 0.12;
/** 死亡定格时长（秒） */
const DEATH_LIFE = 0.85;
/** 单帧最多补几个倒地位移，避免重开/清场时一次性刷满屏 */
const DEATH_BURST_LIMIT = 24;
const DEATH_POOL_CAP = 48;

/** 单个单位的渲染本地状态（按实体 id 索引，实体死亡后清掉） */
interface UnitAnim {
  /** 上一帧位置，用来算移动速度 / 朝向 */
  lx: number;
  ly: number;
  /** 累计移动距离，驱动 walk1 / walk2 交替 */
  dist: number;
  /** 当前脚步帧：0 = walk1，1 = walk2 */
  step: 0 | 1;
  /** 本帧是否在移动 */
  moving: boolean;
  /** 平滑后的朝向（弧度，引擎坐标：0 指向 +x） */
  angle: number;
  /** 剩余开火帧显示时间 */
  fire: number;
  /** 上一帧的开火冷却值，用来识别“刚打出一发” */
  prevFire: number;
  /** 当前贴图键，只在变化时切纹理 */
  frame: string;
  /** 本帧是否被访问过（清理用） */
  seen: boolean;
}

/** 倒地定格：僵尸消失后在原地留一小会儿 */
interface DeathMark {
  x: number;
  y: number;
  angle: number;
  age: number;
}

export class Renderer {
  readonly app = new Application();
  private floorLayer = new Container();
  private trainingLayer = new Graphics();
  /** 倒地定格画在活单位下面 */
  private deathLayer = new Container();
  private unitLayer = new Container();
  private wallLayer = new Graphics();
  private openingLayer = new Graphics();
  private fxLayer = new Container();
  private selectionLayer = new Graphics();
  private textLayer = new Container();
  private dot!: Texture;
  /** (精灵 id|帧) -> 预生成的 Pixi 纹理；启动时一次性建好，运行中不再新建 */
  private textures = new Map<string, Texture>();
  private hAnim = new Map<number, UnitAnim>();
  private zAnim = new Map<number, UnitAnim>();
  private deaths: DeathMark[] = [];
  private hSprites: Sprite[] = [];
  private zSprites: Sprite[] = [];
  private bSprites: Sprite[] = [];
  private fxSprites: Sprite[] = [];
  private deathSprites: Sprite[] = [];
  private textPool: Text[] = [];
  private t = 0;
  private map: MapDef = DEFAULT_MAP;

  /** 初始化 PixiJS、生成贴图、画静态场景（地板网格 / 墙体） */
  async init(host: HTMLElement, map: MapDef = DEFAULT_MAP): Promise<void> {
    this.map = map;
    await this.app.init({
      width: map.width,
      height: map.height,
      background: 0x07070d,
      antialias: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
    });
    host.appendChild(this.app.canvas);
    this.dot = this.makeDotTexture();
    this.warmSpriteTextures();
    this.buildStatic();
    this.buildTrainingVisual();
    // 层级从下到上：训练场装饰 -> 地板 -> 倒地定格 -> 单位 -> 特效 -> 门窗 -> 墙体 -> 选中框 -> 飘字
    // 门窗在特效之上：火焰飞过门口会被盖住；墙体最后画，遮住飞出去的特效
    this.app.stage.addChild(
      this.floorLayer,
      this.trainingLayer,
      this.deathLayer,
      this.unitLayer,
      this.fxLayer,
      this.openingLayer,
      this.wallLayer,
      this.selectionLayer,
      this.textLayer,
    );
    this.trainingLayer.visible = false;
  }

  /**
   * 启动时把所有精灵的每一帧都预生成成 Pixi 纹理（13 个精灵 / 37 帧，开销一次性）。
   * nearest 采样：像素精灵缩放时不能做线性插值，否则边缘发糊。
   */
  private warmSpriteTextures(): void {
    for (const def of [...SPRITE_LIST, ...COMBO_SPRITES]) {
      for (const name of Object.keys(def.frames)) this.texture(def.id, name);
    }
  }

  /** 按 (精灵 id, 帧) 取纹理；未预热过的组合按需生成并缓存，之后每帧只切引用 */
  private texture(id: string, frame: string): Texture {
    const key = `${id}|${frame}`;
    const cached = this.textures.get(key);
    if (cached) return cached;
    const def = getSprite(id) ?? getSprite("human");
    if (!def) throw new Error(`找不到精灵 ${id}`);
    const canvas = getNativeFrame(def, frame, 1);
    const source = new CanvasSource({ resource: canvas, scaleMode: "nearest", autoGenerateMipmaps: false });
    const tex = new Texture({ source });
    this.textures.set(key, tex);
    return tex;
  }

  /** 切到训练场时显示训练场专属地面装饰；正式对局隐藏 */
  setTrainingVisual(active: boolean): void {
    this.trainingLayer.visible = active;
  }

  /** 用几层同心圆画一张“外圈发光、中心实心”的圆点贴图 */
  private makeDotTexture(): Texture {
    const g = new Graphics();
    g.circle(0, 0, 27).fill({ color: 0xffffff, alpha: 0.06 });
    g.circle(0, 0, 20).fill({ color: 0xffffff, alpha: 0.12 });
    g.circle(0, 0, 14).fill({ color: 0xffffff, alpha: 0.38 });
    g.circle(0, 0, CORE_R).fill(0xffffff);
    return this.app.renderer.generateTexture(g);
  }

  /** 静态内容：地板网格和墙体，只画一次 */
  private buildStatic(): void {
    const { width, height, room, walls: mapWalls } = this.map;
    const floor = new Graphics();
    floor.rect(0, 0, width, height).fill(0x07070d);
    for (let x = room.left; x < room.right; x += 48) {
      floor.moveTo(x, room.top).lineTo(x, room.bottom);
    }
    for (let y = room.top; y < room.bottom; y += 48) {
      floor.moveTo(room.left, y).lineTo(room.right, y);
    }
    floor.stroke({ width: 1, color: 0x141d2a, alpha: 0.85 });
    this.floorLayer.addChild(floor);

    const walls = this.wallLayer;
    for (const w of mapWalls) {
      walls.rect(w.x, w.y, w.w, w.h).fill(0x16202e);
      walls.rect(w.x, w.y, w.w, w.h).stroke({ width: 1, color: 0x3a516b, alpha: 0.95 });
    }
    walls.rect(0, 0, width, height).stroke({ width: 1, color: 0x1b2230, alpha: 1 });
  }

  /**
   * 训练场地面装饰：全场冷青色网格 + 场地虚线圈 + 靶心标记。
   * 和正式对局「只有房间内暗蓝网格」区分开，但保持同一套深色底 + 霓虹线条风格。
   */
  private buildTrainingVisual(): void {
    const g = this.trainingLayer;
    const { width, height, room } = this.map;
    g.clear();

    // 全场网格（正式对局网格只画在房间内，这里铺满整张画布，一眼就能看出是训练场）
    for (let x = 0; x <= width; x += 48) g.moveTo(x, 0).lineTo(x, height);
    for (let y = 0; y <= height; y += 48) g.moveTo(0, y).lineTo(width, y);
    g.stroke({ width: 1, color: 0x16414f, alpha: 0.65 });

    // 房间区域：青色虚线边框
    this.dashedRect(g, room.left, room.top, room.right - room.left, room.bottom - room.top, 16, 9);
    g.stroke({ width: 2, color: 0x22d3ee, alpha: 0.38 });

    // 四角标记
    const corner = 30;
    const corners: Array<[number, number, number, number]> = [
      [room.left, room.top, 1, 1],
      [room.right, room.top, -1, 1],
      [room.left, room.bottom, 1, -1],
      [room.right, room.bottom, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      g.moveTo(cx, cy + sy * corner).lineTo(cx, cy).lineTo(cx + sx * corner, cy);
    }
    g.stroke({ width: 3, color: 0x22d3ee, alpha: 0.5 });

    // 靶心：中心大圆 + 四个四分之一位置的小圆环
    const cx = (room.left + room.right) * 0.5;
    const cy = (room.top + room.bottom) * 0.5;
    g.circle(cx, cy, 68).stroke({ width: 2, color: 0x22d3ee, alpha: 0.28 });
    g.circle(cx, cy, 44).stroke({ width: 1, color: 0x22d3ee, alpha: 0.2 });
    g.moveTo(cx - 20, cy).lineTo(cx + 20, cy);
    g.moveTo(cx, cy - 20).lineTo(cx, cy + 20);
    g.stroke({ width: 2, color: 0x22d3ee, alpha: 0.35 });

    for (const [mx, my] of [
      [room.left + (room.right - room.left) * 0.25, cy],
      [room.left + (room.right - room.left) * 0.75, cy],
      [cx, room.top + (room.bottom - room.top) * 0.25],
      [cx, room.top + (room.bottom - room.top) * 0.75],
    ]) {
      g.circle(mx, my, 20).stroke({ width: 1, color: 0x22d3ee, alpha: 0.22 });
    }
  }

  /** 手动画虚线矩形（Pixi Graphics 没有内置 dashed stroke） */
  private dashedRect(
    g: Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    dash: number,
    gap: number,
  ): void {
    const step = dash + gap;
    for (let px = x; px < x + w; px += step) {
      g.moveTo(px, y).lineTo(Math.min(px + dash, x + w), y);
      g.moveTo(px, y + h).lineTo(Math.min(px + dash, x + w), y + h);
    }
    for (let py = y; py < y + h; py += step) {
      g.moveTo(x, py).lineTo(x, Math.min(py + dash, y + h));
      g.moveTo(x + w, py).lineTo(x + w, Math.min(py + dash, y + h));
    }
  }

  /**
   * 门窗层：每帧重画（数量少，开销可忽略）。
   * 透明度随血量下降 —— 门被打得越烂颜色越暗，窗裂纹越多越透；
   * 破损后只描边框，窗还多画一条房间内侧的窗檐（就是绊丧尸的那道坎）。
   */
  private renderOpenings(world: World): void {
    const g = this.openingLayer;
    g.clear();
    for (const o of world.openings) {
      const r = o.rect;
      const ratio = Math.max(0, o.hp / o.maxHp);
      if (o.kind === "door") {
        if (!o.broken) {
          g.rect(r.x, r.y, r.w, r.h).fill({ color: 0x8a6a42, alpha: 0.3 + 0.65 * ratio });
          g.rect(r.x, r.y, r.w, r.h).stroke({ width: 1, color: 0xd8b26a, alpha: 0.9 });
        } else {
          // 破门：只剩门框
          g.rect(r.x, r.y, r.w, r.h).stroke({ width: 1, color: 0x6b5638, alpha: 0.9 });
        }
      } else {
        if (!o.broken) {
          // 玻璃：淡蓝半透明，血量越低越透明（裂纹感）
          g.rect(r.x, r.y, r.w, r.h).fill({ color: 0x9fd8ff, alpha: 0.14 + 0.4 * ratio });
          g.rect(r.x, r.y, r.w, r.h).stroke({ width: 1, color: 0x7ec3ef, alpha: 0.9 });
        } else {
          // 破窗：窗框 + 房间内侧的窗檐小凸条
          g.rect(r.x, r.y, r.w, r.h).stroke({ width: 1, color: 0x51708a, alpha: 0.95 });
          const inward = r.y < world.map.height * 0.5 ? 1 : -1;
          const sillY = inward > 0 ? r.y + r.h : r.y - 5;
          g.rect(r.x - 3, sillY, r.w + 6, 5).fill({ color: 0x51708a, alpha: 0.75 });
        }
      }
    }
  }

  /**
   * Sprite 池：池子不够就补新的，多余的隐藏。
   * 单位数组是原地压缩的，下标和 Sprite 一一对应即可。
   */
  private sync(pool: Sprite[], count: number, layer: Container): void {
    while (pool.length < count) {
      const s = new Sprite(this.dot);
      s.anchor.set(0.5);
      layer.addChild(s);
      pool.push(s);
    }
    for (let i = 0; i < pool.length; i++) pool[i].visible = i < count;
  }

  /**
   * 单位动画状态的公共推进：
   *  - 按位移速度判断是否在移动；累计位移每满 9px 切换一次脚步帧
   *  - 移动时把位移方向记成朝向（僵尸没有 facing 字段，靠这里得到）
   *  - 开火冷却值突然变大 = 刚打出一发，触发 0.12s 的开火帧
   */
  private stateFor(
    map: Map<number, UnitAnim>,
    entity: { id: number; x: number; y: number },
    dt: number,
    initialAngle: number,
    fire = 0,
  ): UnitAnim {
    let st = map.get(entity.id);
    if (!st) {
      st = {
        lx: entity.x,
        ly: entity.y,
        dist: 0,
        step: 0,
        moving: false,
        angle: initialAngle,
        fire: 0,
        prevFire: fire,
        frame: "",
        seen: true,
      };
      map.set(entity.id, st);
      return st;
    }
    const moved = Math.hypot(entity.x - st.lx, entity.y - st.ly);
    st.moving = dt > 0 && moved / dt > MOVE_SPEED;
    if (st.moving) {
      st.dist += moved;
      while (st.dist >= WALK_STEP_DIST) {
        st.dist -= WALK_STEP_DIST;
        st.step = st.step === 0 ? 1 : 0;
      }
      st.angle = Math.atan2(entity.y - st.ly, entity.x - st.lx);
    }
    st.lx = entity.x;
    st.ly = entity.y;
    if (fire > st.prevFire + 1e-4) st.fire = FIRE_HOLD;
    st.prevFire = fire;
    st.fire = Math.max(0, st.fire - dt);
    return st;
  }

  /** 只在该单位贴图变化时切纹理 / 锚点，平时每帧零分配；缺帧时回落到 idle / 首帧 */
  private applyFrame(s: Sprite, st: UnitAnim, def: SpriteDef, frame: string): void {
    const resolved = def.frames[frame] ? frame : def.frames.idle ? "idle" : Object.keys(def.frames)[0];
    const key = `${def.id}|${resolved}`;
    if (st.frame === key) return;
    s.texture = this.texture(def.id, resolved);
    s.anchor.set(def.anchor.x / SPRITE_SIZE, def.anchor.y / SPRITE_SIZE);
    st.frame = key;
  }

  /** 人类：按武器取 human-<weapon> 组合精灵；倒戈中用 human-defected */
  private renderHumans(humans: Human[], dt: number): void {
    this.sync(this.hSprites, humans.length, this.unitLayer);
    for (const st of this.hAnim.values()) st.seen = false;
    const turnTime = settings().human.turnTime;
    for (let i = 0; i < humans.length; i++) {
      const h = humans[i];
      const s = this.hSprites[i];
      const st = this.stateFor(this.hAnim, h, dt, h.facing, h.fire);
      st.seen = true;

      const turning = h.turning > 0;
      const def = spriteDef(turning ? "human-defected" : humanSpriteId(h.weapon));
      let frame = "idle";
      if (st.fire > 0) frame = "fire";
      else if (st.moving) frame = st.step ? "walk2" : "walk1";
      // human-defected 没有 fire 帧，开火时回落到 idle
      if (turning) frame = "idle";

      s.position.set(h.x, h.y);
      s.rotation = spriteRotation(h.facing);
      const scale = spriteScale(HUMAN_DIAMETER);
      s.scale.set(turning ? scale * (1 + (1 - h.turning / turnTime) * 0.35) : scale);
      s.alpha = turning ? 0.55 + 0.45 * Math.abs(Math.sin(this.t * 14 + h.id)) : 1;
      this.applyFrame(s, st, def, frame);
    }
    this.pruneAnim(this.hAnim);
  }

  /** 僵尸：按 kind 取 zombie-<kind>；移动帧交替，静止回 idle */
  private renderZombies(zombies: Zombie[], dt: number): void {
    this.sync(this.zSprites, zombies.length, this.unitLayer);
    for (const st of this.zAnim.values()) st.seen = false;
    for (let i = 0; i < zombies.length; i++) {
      const z = zombies[i];
      const s = this.zSprites[i];
      const st = this.stateFor(this.zAnim, z, dt, Math.atan2(z.ty - z.y, z.tx - z.x));
      st.seen = true;

      const def = spriteDef(zombieSpriteId(z.kind));
      const frame = st.moving ? (st.step ? "walk2" : "walk1") : "idle";
      s.position.set(z.x, z.y);
      s.rotation = spriteRotation(st.angle);
      s.scale.set(spriteScale(effectiveZombie(z.kind).radius * 2 * VISUAL_SCALE));
      s.alpha = 1;
      this.applyFrame(s, st, def, frame);
    }

    /*
     * 本帧从数组里消失的僵尸就是刚被打死（死亡后同帧被 compact 清掉）。
     * 给它们在原地留一个倒地精灵；重开 / 清场这种一次性消失几十只的情况不补，避免刷屏。
     */
    let missing = 0;
    for (const st of this.zAnim.values()) if (!st.seen) missing++;
    if (missing > 0) {
      const record = missing <= DEATH_BURST_LIMIT;
      for (const [id, st] of this.zAnim) {
        if (st.seen) continue;
        if (record && this.deaths.length < DEATH_POOL_CAP) {
          this.deaths.push({ x: st.lx, y: st.ly, angle: st.angle, age: 0 });
        }
        this.zAnim.delete(id);
      }
    }
  }

  /** 倒地定格：固定纹理（zombie-death 的 dead 帧），0.85s 后淡出回收 */
  private renderDeaths(dt: number): void {
    for (let i = this.deaths.length - 1; i >= 0; i--) {
      this.deaths[i].age += dt;
      if (this.deaths[i].age >= DEATH_LIFE) this.deaths.splice(i, 1);
    }
    const def = spriteDef("zombie-death");
    const scale = spriteScale(def.footprintRadius * 2 * VISUAL_SCALE);
    const anchorX = def.anchor.x / SPRITE_SIZE;
    const anchorY = def.anchor.y / SPRITE_SIZE;
    while (this.deathSprites.length < this.deaths.length) {
      const s = new Sprite(this.texture(def.id, "dead"));
      s.anchor.set(anchorX, anchorY);
      this.deathLayer.addChild(s);
      this.deathSprites.push(s);
    }
    for (let i = 0; i < this.deathSprites.length; i++) {
      const s = this.deathSprites[i];
      if (i >= this.deaths.length) {
        s.visible = false;
        continue;
      }
      const d = this.deaths[i];
      s.visible = true;
      s.position.set(d.x, d.y);
      s.rotation = spriteRotation(d.angle);
      s.scale.set(scale);
      s.alpha = d.age < DEATH_LIFE - 0.3 ? 1 : (DEATH_LIFE - d.age) / 0.3;
    }
  }

  /** 清掉本帧没出现的实体状态 */
  private pruneAnim(map: Map<number, UnitAnim>): void {
    for (const [id, st] of map) if (!st.seen) map.delete(id);
  }

  /** 每帧把 World 的状态同步到 Sprite（位置 / 朝向 / 动画帧 / 缩放） */
  render(world: World, dt: number, extra?: RenderExtra): void {
    this.t += dt;
    const w = world;

    this.renderHumans(w.humans, dt);
    this.renderZombies(w.zombies, dt);
    this.renderDeaths(dt);

    const bullets = w.bullets;
    this.sync(this.bSprites, bullets.length, this.unitLayer);
    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      const s = this.bSprites[i];
      s.position.set(b.x, b.y);
      s.tint = b.kind === "rocket" ? 0xffb066 : 0xfff3c4;
      s.alpha = 1;
      s.scale.set((b.kind === "rocket" ? 3.4 : 1.9) / CORE_R);
    }

    const effects = w.effects;
    this.sync(this.fxSprites, effects.length, this.fxLayer);
    for (let i = 0; i < effects.length; i++) {
      const e = effects[i];
      const s = this.fxSprites[i];
      const p = e.age / e.life;
      s.position.set(e.x, e.y);
      s.tint = e.color;
      s.anchor.set(0.5);
      s.rotation = 0;
      if (e.kind === "ember") {
        /*
         * 火焰火星：加法混合发光，边飞边膨胀变淡。
         * 几百颗叠加在枪口前方，就是一团倒锥形的持续火焰。
         */
        s.blendMode = "add";
        s.alpha = (1 - p) * 0.85;
        s.scale.set((e.radius / CORE_R) * (0.55 + p * 0.9));
      } else {
        // 爆炸 / 火花：从中心向外扩散后消失
        s.blendMode = "normal";
        s.alpha = (1 - p) * 0.7;
        const k = (0.35 + p * 1.05) * (e.radius / 27);
        s.scale.set(k);
      }
    }

    this.renderOpenings(w);
    this.renderSelection(extra?.selection ?? null);
    this.renderFloatingText(extra?.floating);
  }

  /**
   * 选中框：青色虚线圆环 + 十字刻度。
   * 只在训练场传入 selection 时出现，正式对局不传即整层清空。
   */
  private renderSelection(sel: { x: number; y: number; radius: number } | null): void {
    const g = this.selectionLayer;
    g.clear();
    if (!sel) return;
    const r = sel.radius + 4;
    for (let i = 0; i < 8; i++) {
      const start = (i * Math.PI) / 4;
      g.arc(sel.x, sel.y, r, start, start + Math.PI / 5);
    }
    g.stroke({ width: 2, color: 0x7fb4ff, alpha: 0.9 });
    g.circle(sel.x, sel.y, r + 7).stroke({ width: 1, color: 0x7fb4ff, alpha: 0.25 });
  }

  /** 伤害飘字：使用 Text 对象池，实体数量按需补齐、多余隐藏 */
  private renderFloatingText(list?: FloatingText[]): void {
    const items = list ?? [];
    while (this.textPool.length < items.length) {
      const text = new Text({
        text: "",
        style: {
          fontFamily: "monospace",
          fontSize: 14,
          fontWeight: "700",
          fill: 0xffffff,
          stroke: { color: 0x000000, width: 3 },
        },
      });
      text.anchor.set(0.5);
      this.textLayer.addChild(text);
      this.textPool.push(text);
    }
    for (let i = 0; i < this.textPool.length; i++) {
      const s = this.textPool[i];
      if (i >= items.length) {
        s.visible = false;
        continue;
      }
      const f = items[i];
      const p = Math.min(1, f.age / f.life);
      s.visible = true;
      s.text = f.text;
      s.position.set(f.x, f.y);
      s.tint = f.color;
      s.alpha = p < 0.65 ? 1 : (1 - p) / 0.35;
      s.scale.set(1 + p * 0.22);
    }
  }
}
