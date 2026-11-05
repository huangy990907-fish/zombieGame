/**
 * 渲染层 —— 把 World 里的数据画出来。
 *
 * 只读数据不改数据，和逻辑层完全解耦：
 *  - 所有单位共用一个预生成的“圆点贴图”，靠 tint 上色、scale 控制大小，
 *    几千个 Sprite 会被 PixiJS 合并成一次绘制调用
 *  - Sprite 按数组下标复用（sync() 池化），不随实体生死反复创建销毁
 *  - 转化中的人类 = 武器颜色渐变到紫色 + 闪烁
 */
import { Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { HUMAN_DEF, ROOM, SETTINGS, WALLS, WEAPONS, WORLD, ZOMBIE_DEFS } from "../config";
import type { World } from "../core/world";
import { mixColor } from "../utils/math";

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

/** 圆点贴图的实心核心半径，缩放时以此为基准 */
const CORE_R = 11;

export class Renderer {
  readonly app = new Application();
  private floorLayer = new Container();
  private trainingLayer = new Graphics();
  private unitLayer = new Container();
  private wallLayer = new Graphics();
  private openingLayer = new Graphics();
  private fxLayer = new Container();
  private selectionLayer = new Graphics();
  private textLayer = new Container();
  private dot!: Texture;
  private hSprites: Sprite[] = [];
  private zSprites: Sprite[] = [];
  private bSprites: Sprite[] = [];
  private fxSprites: Sprite[] = [];
  private textPool: Text[] = [];
  private t = 0;

  /** 初始化 PixiJS、生成贴图、画静态场景（地板网格 / 墙体） */
  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      width: WORLD.width,
      height: WORLD.height,
      background: 0x07070d,
      antialias: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      autoDensity: true,
    });
    host.appendChild(this.app.canvas);
    this.dot = this.makeDotTexture();
    this.buildStatic();
    this.buildTrainingVisual();
    // 层级从下到上：训练场装饰 -> 地板 -> 单位 -> 特效 -> 门窗 -> 墙体 -> 选中框 -> 飘字
    // 门窗在特效之上：火焰飞过门口会被盖住；墙体最后画，遮住飞出去的特效
    this.app.stage.addChild(
      this.floorLayer,
      this.trainingLayer,
      this.unitLayer,
      this.fxLayer,
      this.openingLayer,
      this.wallLayer,
      this.selectionLayer,
      this.textLayer,
    );
    this.trainingLayer.visible = false;
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
    const floor = new Graphics();
    floor.rect(0, 0, WORLD.width, WORLD.height).fill(0x07070d);
    for (let x = ROOM.left; x < ROOM.right; x += 48) {
      floor.moveTo(x, ROOM.top).lineTo(x, ROOM.bottom);
    }
    for (let y = ROOM.top; y < ROOM.bottom; y += 48) {
      floor.moveTo(ROOM.left, y).lineTo(ROOM.right, y);
    }
    floor.stroke({ width: 1, color: 0x141d2a, alpha: 0.85 });
    this.floorLayer.addChild(floor);

    const walls = this.wallLayer;
    for (const w of WALLS) {
      walls.rect(w.x, w.y, w.w, w.h).fill(0x16202e);
      walls.rect(w.x, w.y, w.w, w.h).stroke({ width: 1, color: 0x3a516b, alpha: 0.95 });
    }
    walls
      .rect(0, 0, WORLD.width, WORLD.height)
      .stroke({ width: 1, color: 0x1b2230, alpha: 1 });
  }

  /**
   * 训练场地面装饰：全场冷青色网格 + 场地虚线圈 + 靶心标记。
   * 和正式对局「只有房间内暗蓝网格」区分开，但保持同一套深色底 + 霓虹线条风格。
   */
  private buildTrainingVisual(): void {
    const g = this.trainingLayer;
    g.clear();

    // 全场网格（正式对局网格只画在房间内，这里铺满整张画布，一眼就能看出是训练场）
    for (let x = 0; x <= WORLD.width; x += 48) g.moveTo(x, 0).lineTo(x, WORLD.height);
    for (let y = 0; y <= WORLD.height; y += 48) g.moveTo(0, y).lineTo(WORLD.width, y);
    g.stroke({ width: 1, color: 0x16414f, alpha: 0.65 });

    // 房间区域：青色虚线边框
    this.dashedRect(g, ROOM.left, ROOM.top, ROOM.right - ROOM.left, ROOM.bottom - ROOM.top, 16, 9);
    g.stroke({ width: 2, color: 0x22d3ee, alpha: 0.38 });

    // 四角标记
    const corner = 30;
    const corners: Array<[number, number, number, number]> = [
      [ROOM.left, ROOM.top, 1, 1],
      [ROOM.right, ROOM.top, -1, 1],
      [ROOM.left, ROOM.bottom, 1, -1],
      [ROOM.right, ROOM.bottom, -1, -1],
    ];
    for (const [cx, cy, sx, sy] of corners) {
      g.moveTo(cx, cy + sy * corner).lineTo(cx, cy).lineTo(cx + sx * corner, cy);
    }
    g.stroke({ width: 3, color: 0x22d3ee, alpha: 0.5 });

    // 靶心：中心大圆 + 四个四分之一位置的小圆环
    const cx = (ROOM.left + ROOM.right) * 0.5;
    const cy = (ROOM.top + ROOM.bottom) * 0.5;
    g.circle(cx, cy, 68).stroke({ width: 2, color: 0x22d3ee, alpha: 0.28 });
    g.circle(cx, cy, 44).stroke({ width: 1, color: 0x22d3ee, alpha: 0.2 });
    g.moveTo(cx - 20, cy).lineTo(cx + 20, cy);
    g.moveTo(cx, cy - 20).lineTo(cx, cy + 20);
    g.stroke({ width: 2, color: 0x22d3ee, alpha: 0.35 });

    for (const [mx, my] of [
      [ROOM.left + (ROOM.right - ROOM.left) * 0.25, cy],
      [ROOM.left + (ROOM.right - ROOM.left) * 0.75, cy],
      [cx, ROOM.top + (ROOM.bottom - ROOM.top) * 0.25],
      [cx, ROOM.top + (ROOM.bottom - ROOM.top) * 0.75],
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
          const inward = r.y < WORLD.height * 0.5 ? 1 : -1;
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

  /** 每帧把 World 的状态同步到 Sprite（位置 / 颜色 / 缩放 / 透明度） */
  render(world: World, dt: number, extra?: RenderExtra): void {
    this.t += dt;
    const w = world;

    const humans = w.humans;
    this.sync(this.hSprites, humans.length, this.unitLayer);
    for (let i = 0; i < humans.length; i++) {
      const h = humans[i];
      const s = this.hSprites[i];
      const def = WEAPONS[h.weapon];
      s.position.set(h.x, h.y);
      let color = def.color;
      let scale = HUMAN_DEF.radius / CORE_R;
      if (h.turning > 0) {
        // 转化中：颜色渐变到紫色、体积膨胀、高频闪烁
        const p = 1 - h.turning / SETTINGS.human.turnTime;
        color = mixColor(def.color, 0x9b4dff, p * 0.9);
        scale *= 1 + p * 0.35;
        s.alpha = 0.55 + 0.45 * Math.abs(Math.sin(this.t * 14 + h.id));
      } else {
        s.alpha = 1;
      }
      s.tint = color;
      s.scale.set(scale);
    }

    const zombies = w.zombies;
    this.sync(this.zSprites, zombies.length, this.unitLayer);
    for (let i = 0; i < zombies.length; i++) {
      const z = zombies[i];
      const s = this.zSprites[i];
      const def = ZOMBIE_DEFS[z.kind];
      s.position.set(z.x, z.y);
      s.tint = def.color;
      s.alpha = 1;
      s.scale.set(def.radius / CORE_R);
    }

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
