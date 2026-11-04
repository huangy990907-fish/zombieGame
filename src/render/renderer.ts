/**
 * 渲染层 —— 把 World 里的数据画出来。
 *
 * 只读数据不改数据，和逻辑层完全解耦：
 *  - 所有单位共用一个预生成的“圆点贴图”，靠 tint 上色、scale 控制大小，
 *    几千个 Sprite 会被 PixiJS 合并成一次绘制调用
 *  - Sprite 按数组下标复用（sync() 池化），不随实体生死反复创建销毁
 *  - 转化中的人类 = 武器颜色渐变到紫色 + 闪烁
 */
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import { HUMAN_DEF, ROOM, SETTINGS, WALLS, WEAPONS, WORLD, ZOMBIE_DEFS } from "../config";
import type { Game } from "../core/game";
import type { World } from "../core/world";
import { mixColor } from "../utils/math";

/** 圆点贴图的实心核心半径，缩放时以此为基准 */
const CORE_R = 11;

export class Renderer {
  readonly app = new Application();
  private floorLayer = new Container();
  private unitLayer = new Container();
  private wallLayer = new Graphics();
  private openingLayer = new Graphics();
  private fxLayer = new Container();
  private dot!: Texture;
  private hSprites: Sprite[] = [];
  private zSprites: Sprite[] = [];
  private bSprites: Sprite[] = [];
  private fxSprites: Sprite[] = [];
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
    // 层级从下到上：地板 -> 单位 -> 特效 -> 门窗 -> 墙体
    // 门窗在特效之上：火焰飞过门口会被盖住；墙体最后画，遮住飞出去的特效
    this.app.stage.addChild(
      this.floorLayer,
      this.unitLayer,
      this.fxLayer,
      this.openingLayer,
      this.wallLayer,
    );
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
  render(game: Game, dt: number): void {
    this.t += dt;
    const w = game.world;

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
  }
}
