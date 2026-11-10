/**
 * 渲染层 —— 把 World 里的数据画出来。
 *
 * 只读数据不改数据，和逻辑层完全解耦：
 *  - 单位使用 src/art 的 32×32 像素精灵：纹理在启动时按 (精灵 id, 帧) 预生成并缓存，
 *    每帧只切 Sprite.texture，不新建 canvas / 纹理
 *  - Sprite 按数组下标复用（sync() 池化），不随实体生死反复创建销毁
 *  - 动画状态机（idle / walk / fire / 倒地三帧）状态挂在渲染器本地 Map 上，按实体 id 索引
 *  - 转化中的人类 = human-defected 精灵 + 高频闪烁
 */
import { Application, CanvasSource, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { COMBO_SPRITES, SPRITE_LIST, getNativeFrame, getSprite, type SpriteDef } from "../art";
import { DEFAULT_MAP, type MapDef } from "../data/maps";
import { TILE_SIZE } from "../data/maps/schema";
import { TERRAIN } from "../data/terrain";
import { settings } from "../data/settings/runtime";
import type { Effect, Human, World, Zombie } from "../core/world";
import { HUMAN_DIAMETER, humanSpriteId, spriteAnchor, spriteDef, spriteRotation, spriteScale, VISUAL_SCALE, zombieDeathSpriteId, zombieSpriteId } from "./pixel";
import {
  FLOATING_FONT_FAMILY,
  FLOATING_FONT_SIZE,
  FLOATING_FONT_WEIGHT,
  FLOATING_STROKE_WIDTH,
  floatingAlpha,
  floatingScale,
  type FloatingText,
} from "./floating";

/** 渲染附加信息：正式对局不传，训练场用它画选中框和飘字 */
export interface RenderExtra {
  selection?: { x: number; y: number; radius: number } | null;
  floating?: FloatingText[];
  /** 「尸潮求生」的经验球 */
  orbs?: Array<{ x: number; y: number; radius: number }>;
  /** 主菜单等非对局画面：即使背景 World 里还留着 BOSS，也不显示顶部血条 */
  hideBossBar?: boolean;
}

/** 圆点贴图的实心核心半径，缩放时以此为基准（只用于子弹/特效，单位已改用像素精灵） */
const CORE_R = 11;

/** 脚步帧切换所需累计移动距离（像素） */
const WALK_STEP_DIST = 9;
/** 判定“在移动”的速度阈值（像素/秒），低于它按 idle 处理 */
const MOVE_SPEED = 12;
/** 开火帧停留时长（秒），略长于机枪 0.1s 冷却 */
const FIRE_HOLD = 0.12;
/** 常规受击闪白时长（秒）；电击枪单体强化会把计时拉长到 0.16s，用超出的部分做轻微尺寸脉冲 */
const HIT_FLASH = 0.08;
const EMPOWERED_FLASH = 0.16;
/** 单体强化尺寸脉冲的最大放大比例（极其克制，不做击退 / 硬直） */
const EMPOWERED_PULSE_SCALE = 0.05;
/** 倒地序列的帧名（zombie-death 精灵内），按时间顺序播放 */
const DEATH_FRAMES = ["death-1", "death-2", "death-3"] as const;
/** 倒地单帧时长（秒）：3 帧共 0.6s，播完停在末帧 */
const DEATH_FRAME = 0.2;
/** 尸体总停留时长（秒，含最后 0.3s 淡出） */
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
  /** 僵尸类型 id（倒地时按它选对应配色 / 体型） */
  kind: string;
  /** 本帧是否被访问过（清理用） */
  seen: boolean;
}

/** 倒地序列：僵尸消失后在原地播三帧，再淡出回收 */
interface DeathMark {
  x: number;
  y: number;
  angle: number;
  age: number;
  /** 僵尸类型 id：胖子用自己的倒地配色与体型 */
  kind: string;
}

export class Renderer {
  readonly app = new Application();
  private floorLayer = new Container();
  /** 地板网格复用同一张 Graphics，换图时 clear 后重画，避免旧图残留 */
  private floorG!: Graphics;
  /** 静态地形：水面填充与水池边框（换图时重画） */
  private terrainLayer = new Graphics();
  /** 动态地形：草丛正常 / 燃烧 / 休眠 / 重生四种状态，逐帧重画 */
  private grassLayer = new Graphics();
  /** 腐蚀毒液层：画在草丛之后、单位之前，不遮住角色 */
  private poisonLayer = new Graphics();
  private trainingLayer = new Graphics();
  /** 准备阶段的出生区标记（人类区绿色 / 僵尸区红色），战斗中隐藏 */
  private placementLayer = new Container();
  private placementKey = "";
  /** 生存模式的经验球，画在单位与尸体下面 */
  private pickupLayer = new Graphics();
  /** 倒地定格画在活单位下面 */
  private deathLayer = new Container();
  private unitLayer = new Container();
  private wallLayer = new Graphics();
  private openingLayer = new Graphics();
  /** 人类血条：始终水平、不随精灵朝向旋转，画在墙体之上 */
  private hpBarLayer = new Graphics();
  private fxLayer = new Container();
  /** 电击枪闪电：独立 Graphics 层，画折线，不走圆点精灵池 */
  private arcLayer = new Graphics();
  /** 飞扑者附身精灵：叠在人类与特效之上，避免被爆炸 / 电弧盖住 */
  private attachLayer = new Container();
  /** 高速弹道曳光：独立 Graphics 层，每帧按弹丸位置重画短线 */
  private tracerLayer = new Graphics();
  /** 腐蚀者毒液弹：画抛物线轨迹与落点阴影，位于单位之上、特效之下 */
  private poisonShotLayer = new Graphics();
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
  /** 附身飞扑者精灵池（attachLayer 内，按附身数量复用） */
  private attachSprites: Sprite[] = [];
  private deathSprites: Sprite[] = [];
  private textPool: Text[] = [];
  private t = 0;
  private map: MapDef = DEFAULT_MAP;
  /** 镜头：null = 默认整图展示 */
  private camX: number | null = null;
  private camY = 0;
  private camZoom = 1;
  /** 顶部 BOSS 血条（DOM 覆盖层，所有对局模式通用；不随镜头缩放） */
  private bossBar: HTMLDivElement | null = null;
  private bossNameEl: HTMLElement | null = null;
  private bossValueEl: HTMLElement | null = null;
  private bossFillEl: HTMLElement | null = null;

  /**
   * 设置镜头。生存模式传玩家坐标与放大倍数：地图大于可视区域时跟随玩家，
   * 并把镜头中心夹在地图边界内。传 null 恢复整图。
   */
  setCamera(x: number | null, y = 0, zoom = 1): void {
    this.camX = x;
    this.camY = y;
    this.camZoom = Math.max(1, zoom);
  }

  private applyCamera(): void {
    const stage = this.app.stage;
    if (this.camX === null) {
      stage.position.set(0, 0);
      stage.scale.set(1);
      return;
    }
    const zoom = this.camZoom;
    const viewW = this.map.width / zoom;
    const viewH = this.map.height / zoom;
    const cx = Math.max(viewW * 0.5, Math.min(this.map.width - viewW * 0.5, this.camX));
    const cy = Math.max(viewH * 0.5, Math.min(this.map.height - viewH * 0.5, this.camY));
    stage.scale.set(zoom);
    stage.position.set(this.map.width * 0.5 - cx * zoom, this.map.height * 0.5 - cy * zoom);
  }

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
    this.buildBossBar(host);
    this.dot = this.makeDotTexture();
    this.warmSpriteTextures();
    this.floorG = new Graphics();
    this.floorLayer.addChild(this.floorG);
    this.buildStatic();
    this.buildTrainingVisual();
    // 层级从下到上：训练场装饰 -> 地板 -> 倒地定格 -> 单位 -> 特效 -> 闪电 -> 门窗 -> 墙体 -> 选中框 -> 飘字
    // 门窗在特效之上：火焰飞过门口会被盖住；墙体最后画，遮住飞出去的特效
    this.app.stage.addChild(
      this.floorLayer,
      this.terrainLayer,
      this.grassLayer,
      this.poisonLayer,
      this.placementLayer,
      this.trainingLayer,
      this.pickupLayer,
      this.deathLayer,
      this.unitLayer,
      this.tracerLayer,
      this.poisonShotLayer,
      this.fxLayer,
      this.arcLayer,
      this.attachLayer,
      this.openingLayer,
      this.wallLayer,
      this.hpBarLayer,
      this.selectionLayer,
      this.textLayer,
    );
    this.trainingLayer.visible = false;
    this.placementLayer.visible = false;
  }

  /**
   * 准备阶段的出生区标记：人类区绿色、僵尸区红色，半透明 + 文字标签。
   * 只在准备阶段显示；同地图重复调用只切换可见性，不重画。
   */
  setPlacementZones(visible: boolean): void {
    this.placementLayer.visible = visible;
    if (!visible) {
      this.placementKey = "";
      return;
    }
    if (this.placementKey === this.map.id) return;
    this.placementKey = this.map.id;
    this.placementLayer.removeChildren().forEach((child) => child.destroy());

    const g = new Graphics();
    const humanZones = this.map.humanZones.length > 0 ? this.map.humanZones : [this.map.humanBounds];
    const spawnZones = this.map.spawn;
    for (const z of humanZones) {
      g.rect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0)
        .fill({ color: 0x22c55e, alpha: 0.14 })
        .stroke({ width: 1.5, color: 0x4ade80, alpha: 0.55 });
    }
    for (const z of spawnZones) {
      g.rect(z.x0, z.y0, z.x1 - z.x0, z.y1 - z.y0)
        .fill({ color: 0xf87171, alpha: 0.14 })
        .stroke({ width: 1.5, color: 0xf87171, alpha: 0.55 });
    }
    this.placementLayer.addChild(g);

    const label = (text: string, zones: typeof humanZones, color: number): void => {
      if (zones.length === 0) return;
      const z = zones.reduce((a, b) =>
        (b.x1 - b.x0) * (b.y1 - b.y0) >= (a.x1 - a.x0) * (a.y1 - a.y0) ? b : a,
      );
      const t = new Text({
        text,
        style: {
          fontFamily: "monospace",
          fontSize: 14,
          fill: color,
          stroke: { color: 0x000000, width: 3 },
        },
      });
      t.anchor.set(0.5);
      t.position.set((z.x0 + z.x1) * 0.5, (z.y0 + z.y1) * 0.5);
      this.placementLayer.addChild(t);
    };
    label("人类区", humanZones, 0x86efac);
    label("僵尸区", spawnZones, 0xfca5a5);
  }

  /**
   * 启动时把所有精灵的每一帧都预生成成 Pixi 纹理（13 个精灵 / 39 帧，开销一次性）。
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

  /**
   * 换图：重画地板网格、墙体与训练场装饰。
   * 门窗每帧都从 world.openings 重画，不会残留旧图；流场由 World 按新地图重建。
   */
  setMap(map: MapDef): void {
    if (map === this.map) return;
    this.map = map;
    if (this.app.renderer.width !== map.width || this.app.renderer.height !== map.height) {
      this.app.renderer.resize(map.width, map.height);
    }
    this.buildStatic();
    this.buildTrainingVisual();
    this.openingLayer.clear();
    this.poisonLayer.clear();
    this.placementKey = "";
    this.placementLayer.removeChildren().forEach((child) => child.destroy());
    this.placementLayer.visible = false;
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

  /** 静态内容：地板网格和墙体，随地图重建 */
  private buildStatic(): void {
    const { width, height, room, walls: mapWalls } = this.map;
    const floor = this.floorG;
    floor.clear();
    floor.rect(0, 0, width, height).fill(0x07070d);
    for (let x = room.left; x < room.right; x += 48) {
      floor.moveTo(x, room.top).lineTo(x, room.bottom);
    }
    for (let y = room.top; y < room.bottom; y += 48) {
      floor.moveTo(room.left, y).lineTo(room.right, y);
    }
    floor.stroke({ width: 1, color: 0x141d2a, alpha: 0.85 });

    // 水池：逐格铺底（带一点深浅交错的波纹感），合并矩形描边区分边界
    const terrain = this.terrainLayer;
    terrain.clear();
    for (const t of this.map.waterTiles) {
      const deep = ((t.x / TILE_SIZE) + (t.y / TILE_SIZE)) % 2 === 0;
      terrain.rect(t.x, t.y, t.w, t.h).fill({ color: deep ? 0x0e2740 : 0x123049, alpha: 0.94 });
    }
    for (const b of this.map.waterBlockers) {
      terrain.rect(b.x, b.y, b.w, b.h).stroke({ width: 1, color: 0x2f6f92, alpha: 0.9 });
    }

    const walls = this.wallLayer;
    walls.clear();
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

  /** 经验球：中心亮紫、外圈呼吸光晕 */
  private renderPickups(orbs?: Array<{ x: number; y: number; radius: number }>): void {
    const g = this.pickupLayer;
    g.clear();
    if (!orbs || orbs.length === 0) return;
    for (const orb of orbs) {
      const pulse = 0.72 + 0.28 * Math.sin(this.t * 6 + orb.x * 0.05);
      g.circle(orb.x, orb.y, orb.radius * 2.6).fill({ color: 0xa855f7, alpha: 0.16 * pulse });
      g.circle(orb.x, orb.y, orb.radius * 1.5).fill({ color: 0xa855f7, alpha: 0.45 * pulse });
      g.circle(orb.x, orb.y, orb.radius).fill({ color: 0xf3e8ff, alpha: 0.95 });
    }
  }

  /**
   * 草丛：逐格按运行时状态重画。
   *  正常 = 半透明绿色 + 上缘亮边；燃烧 = 浅黄并轻微闪烁；休眠 = 灰烬；
   *  重生 = 灰烬底上按剩余计时线性叠回绿色。水域不在这里画（静态层已铺好）。
   */
  private renderTerrain(world: World): void {
    const g = this.grassLayer;
    g.clear();
    const ash = 0x4a463c;
    const green = 0x2f7d4a;
    for (const t of world.grass) {
      const flicker = 0.85 + 0.15 * Math.sin(this.t * 18 + t.x * 0.7 + t.y * 0.4);
      if (t.phase === 0) {
        g.rect(t.x, t.y, TILE_SIZE, TILE_SIZE).fill({ color: green, alpha: 0.5 });
        g.rect(t.x, t.y, TILE_SIZE, 2).fill({ color: 0x59b56f, alpha: 0.5 });
      } else if (t.phase === 1) {
        g.rect(t.x, t.y, TILE_SIZE, TILE_SIZE).fill({ color: 0xd8c690, alpha: 0.72 * flicker });
        g.rect(t.x, t.y, TILE_SIZE, TILE_SIZE).stroke({ width: 1, color: 0xffe9b0, alpha: 0.8 * flicker });
      } else if (t.phase === 2) {
        g.rect(t.x, t.y, TILE_SIZE, TILE_SIZE).fill({ color: ash, alpha: 0.55 });
      } else {
        const p = 1 - Math.min(1, Math.max(0, t.timer / TERRAIN.grass.regrowFade));
        g.rect(t.x, t.y, TILE_SIZE, TILE_SIZE).fill({ color: ash, alpha: 0.55 });
        g.rect(t.x, t.y, TILE_SIZE, TILE_SIZE).fill({ color: green, alpha: 0.5 * p });
        g.rect(t.x, t.y, TILE_SIZE, 2).fill({ color: 0x59b56f, alpha: 0.5 * p });
      }
    }
  }

  /**
   * 腐蚀毒液：半透明绿色圆盘 + 亮边 + 缓慢旋转的气泡。
   * 只画世界状态里的 poison；最后一小段按剩余时间淡出，不闪跳。
   */
  private renderPoison(world: World): void {
    const g = this.poisonLayer;
    g.clear();
    for (let i = 0; i < world.poison.length; i++) {
      const p = world.poison[i];
      const fade = Math.min(1, p.remaining / 1.2);
      g.circle(p.x, p.y, p.radius).fill({ color: 0x3f6212, alpha: 0.2 * fade });
      g.circle(p.x, p.y, p.radius * 0.72).fill({ color: 0x65a30d, alpha: 0.16 * fade });
      g.circle(p.x, p.y, p.radius).stroke({ width: 1.5, color: 0xa3e635, alpha: 0.5 * fade });
      // 固定 5 个气泡位置，按时间缓慢绕圈 + 上下浮动
      for (let k = 0; k < 5; k++) {
        const ang = k * 1.7 + this.t * 0.55 + i;
        const rr = p.radius * (0.28 + 0.5 * ((k % 3) / 2));
        const bx = p.x + Math.cos(ang) * rr;
        const by = p.y + Math.sin(ang) * rr + Math.sin(this.t * 2.4 + k) * 2;
        g.circle(bx, by, 2 + (k % 2) * 0.8).fill({ color: 0xd9f99d, alpha: 0.55 * fade });
      }
    }

    // 飞行中的毒液弹：地面阴影 + 抛物线弧线 + 毒液球，和落地毒圈区分开
    const sg = this.poisonShotLayer;
    sg.clear();
    for (let i = 0; i < world.poisonShots.length; i++) {
      const s = world.poisonShots[i];
      const p = Math.min(1, s.t / s.dur);
      const dist = Math.hypot(s.tx - s.x0, s.ty - s.y0);
      const arcH = 18 + Math.min(34, dist * 0.09);
      const lift = Math.sin(Math.PI * p) * arcH;
      // 落点阴影：提前画出目标位置，人类可以据此走位
      sg.ellipse(s.tx, s.ty, s.radius * 0.5, s.radius * 0.26).fill({
        color: 0x365314,
        alpha: 0.22,
      });
      sg.circle(s.tx, s.ty, s.radius * 0.5).stroke({ width: 1, color: 0xa3e635, alpha: 0.3 });
      // 抛物线轨迹：沿飞行路径采样 6 段，越靠近弹体越亮
      for (let k = 5; k >= 1; k--) {
        const q = Math.max(0, p - k * 0.045);
        const tx = s.x0 + (s.tx - s.x0) * q;
        const ty = s.y0 + (s.ty - s.y0) * q;
        const th = Math.sin(Math.PI * q) * arcH;
        sg.circle(tx, ty - th, 1.8 + (5 - k) * 0.35).fill({
          color: 0x84cc16,
          alpha: 0.1 + (5 - k) * 0.06,
        });
      }
      // 弹体：深绿球 + 高光，飞得越高地面阴影越小
      const shrink = 1 - (lift / (arcH + 1)) * 0.35;
      sg.circle(s.x, s.y - lift, 4.6 * shrink).fill({ color: 0x4d7c0f, alpha: 0.95 });
      sg.circle(s.x, s.y - lift, 4.6 * shrink).stroke({ width: 1, color: 0xecfccb, alpha: 0.7 });
      sg.circle(s.x - 1.2, s.y - lift - 1.2, 1.5 * shrink).fill({
        color: 0xd9f99d,
        alpha: 0.9,
      });
    }
  }

  /**
   * 电击枪特效用 arcLayer：
   * - arc 是抖动电弧，外层暖黄辉光 + 内层黄色芯线，起止点各一个短促闪点；
   *   线宽 / 亮度按每跳视觉强度递减（首跳最亮最粗，末跳细而暗）；
   * - ring 是命中目标处向外扩散的短促光环。
   * 整段按 age/life 线性淡出（arc 约 0.12 秒，ring 约 0.18–0.26 秒）。
   */
  private renderArcs(effects: Effect[]): void {
    const g = this.arcLayer;
    g.clear();
    for (let i = 0; i < effects.length; i++) {
      const e = effects[i];
      if (e.kind !== "arc" && e.kind !== "ring") continue;
      const fade = 1 - Math.min(1, e.age / e.life);
      if (fade <= 0) continue;
      if (e.kind === "ring") {
        // 命中光环：从目标外缘向外扩散，边扩边淡
        const p = Math.min(1, e.age / e.life);
        g.circle(e.x, e.y, e.radius + p * 12).stroke({
          width: 1.8,
          color: e.color,
          alpha: fade * 0.72,
        });
        continue;
      }
      if (!e.points || e.points.length < 2) continue;
      const pts = e.points;
      const strength = e.strength ?? 1;
      const trace = (): void => {
        g.moveTo(pts[0].x, pts[0].y);
        for (let k = 1; k < pts.length; k++) g.lineTo(pts[k].x, pts[k].y);
      };
      // 先用宽一点的暖黄半透明线打底，做出辉光感，再叠一条细黄芯线
      trace();
      g.stroke({ width: 6 * (0.5 + 0.5 * strength), color: 0xffc93c, alpha: fade * 0.26 * (0.45 + 0.55 * strength) });
      trace();
      g.stroke({ width: 2.6 * (0.5 + 0.5 * strength), color: e.color, alpha: fade * 0.95 * (0.5 + 0.5 * strength) });
      // 起止点短促闪点：起点略小，落点更亮，强调命中位置
      const start = pts[0];
      g.circle(start.x, start.y, 2.1 * (0.7 + 0.3 * strength)).fill({
        color: 0xfff8d0,
        alpha: fade * 0.75 * (0.5 + 0.5 * strength),
      });
      const end = pts[pts.length - 1];
      g.circle(end.x, end.y, 2.6 * (0.65 + 0.35 * strength)).fill({
        color: 0xfff8d0,
        alpha: fade * 0.9 * (0.55 + 0.45 * strength),
      });
    }
  }

  /**
   * 高速弹道的曳光：沿速度反方向拉出一小段亮线（只对 WeaponDef.tracer > 0 的弹丸生效）。
   * 独立 Graphics 层每帧重画；狙击枪弹丸数量少，开销可忽略。
   */
  private renderTracers(w: World): void {
    const g = this.tracerLayer;
    g.clear();
    for (let i = 0; i < w.bullets.length; i++) {
      const b = w.bullets[i];
      const len = b.tracer ?? 0;
      if (!b.alive || len <= 0) continue;
      const v = Math.hypot(b.vx, b.vy) || 1;
      const tx = b.x - (b.vx / v) * len;
      const ty = b.y - (b.vy / v) * len;
      // 外层暖白辉光 + 内核亮线，快速飞过时形成一条清晰的弹道
      g.moveTo(tx, ty).lineTo(b.x, b.y).stroke({ width: 3, color: 0xffd27a, alpha: 0.28 });
      g.moveTo(tx, ty).lineTo(b.x, b.y).stroke({ width: 1.2, color: 0xfff8e0, alpha: 0.8 });
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
        kind: "",
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
    const anchor = spriteAnchor(def);
    s.anchor.set(anchor.x, anchor.y);
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
      const scale = spriteScale(HUMAN_DIAMETER, def);
      s.scale.set(turning ? scale * (1 + (1 - h.turning / turnTime) * 0.35) : scale);
      s.alpha = turning ? 0.55 + 0.45 * Math.abs(Math.sin(this.t * 14 + h.id)) : 1;
      // 被压制：轻微紫红染色（不加新素材，靠渲染层标识）
      s.tint = h.pinTimer > 0 ? 0xd8b4fe : 0xffffff;
      this.applyFrame(s, st, def, frame);
    }
    this.pruneAnim(this.hAnim);
  }

  /**
   * 飞扑者按状态选精灵：蓄力 / 跃起 / 附身各自用专用帧组，
   * 其余僵尸仍按 zombie-<kind>。缺图时 spriteDef 会回落到人类素体，
   * 但 0.8.3 的插图已提供全部五套。
   */
  private zombieVisualId(z: Zombie): string {
    if (z.kind !== "leaper") return zombieSpriteId(z.kind);
    if (z.pinTargetId !== null) return "zombie-leaper-attach";
    if (z.leapPhase === 1) return "zombie-leaper-windup";
    if (z.leapPhase === 2) return "zombie-leaper-leap";
    return zombieSpriteId(z.kind);
  }

  /** 僵尸：按 kind 取 zombie-<kind>；移动帧交替，静止回 idle */
  private renderZombies(zombies: Zombie[], dt: number): void {
    this.sync(this.zSprites, zombies.length, this.unitLayer);
    let attachCount = 0;
    for (let i = 0; i < zombies.length; i++) if (zombies[i].pinTargetId !== null) attachCount++;
    this.sync(this.attachSprites, attachCount, this.attachLayer);
    let attachIndex = 0;
    for (const st of this.zAnim.values()) st.seen = false;
    for (let i = 0; i < zombies.length; i++) {
      const z = zombies[i];
      const s = this.zSprites[i];
      // 漫游时不追目标，朝向跟随自己的漫游方向；索敌时朝目标坐标
      const angle =
        z.mode === "wander" ? z.wanderAngle : Math.atan2(z.ty - z.y, z.tx - z.x);
      const st = this.stateFor(this.zAnim, z, dt, angle);
      st.seen = true;
      st.kind = z.kind;

      const attached = z.pinTargetId !== null;
      const def = spriteDef(this.zombieVisualId(z));
      const frame = attached ? "idle" : st.moving ? (st.step ? "walk2" : "walk1") : "idle";
      // 渲染直径 = 身体直径(2r) * 视觉放大（普通 11→16.5，胖子 22→33）
      // 电击单体强化会把闪白计时拉长到 0.16s，用超出的部分叠一个极轻微的尺寸脉冲
      const strongFlash = z.flash > HIT_FLASH;
      const pulse = strongFlash ? (z.flash - HIT_FLASH) / (EMPOWERED_FLASH - HIT_FLASH) : 0;
      const baseScale = spriteScale(z.bodyDiameter * VISUAL_SCALE, def);
      const tint = z.flash > 0 ? 0xffffff : z.buffTimer > 0 ? 0xffc2d8 : 0xffffff;
      const alpha = z.flash > 0 ? (strongFlash ? 1 : 0.9) : 1;

      if (attached) {
        // 附身精灵独立成层：跟随被附着人类的平滑朝向，叠在人类与特效之上
        s.visible = false;
        const a = this.attachSprites[attachIndex++];
        a.visible = true;
        a.position.set(z.x, z.y);
        const human = this.hAnim.get(z.pinTargetId as number);
        a.rotation = spriteRotation(human ? human.angle : angle);
        a.scale.set(baseScale * (1 + pulse * EMPOWERED_PULSE_SCALE));
        a.blendMode = z.flash > 0 ? "add" : "normal";
        a.tint = tint;
        a.alpha = alpha;
        const anchor = spriteAnchor(def);
        a.anchor.set(anchor.x, anchor.y);
        a.texture = this.texture(def.id, "idle");
        continue;
      }

      s.visible = true;
      s.position.set(z.x, z.y);
      s.rotation = spriteRotation(st.angle);
      s.scale.set(baseScale * (1 + pulse * EMPOWERED_PULSE_SCALE));
      // 受击反馈：短促加法混合提亮（闪白），比新建滤镜/叠加精灵成本低
      s.blendMode = z.flash > 0 ? "add" : "normal";
      // 被尖叫者强化的僵尸：粉紫染色（与压制标识区分：强化偏粉，压制偏紫）
      s.tint = tint;
      s.alpha = alpha;
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
          this.deaths.push({ x: st.lx, y: st.ly, angle: st.angle, age: 0, kind: st.kind });
        }
        this.zAnim.delete(id);
      }
    }
  }

  /** 倒地序列：按 age 推进 death-1 → death-2 → death-3，0.6s 后停在末帧，最后 0.3s 淡出 */
  private renderDeaths(dt: number): void {
    for (let i = this.deaths.length - 1; i >= 0; i--) {
      this.deaths[i].age += dt;
      if (this.deaths[i].age >= DEATH_LIFE) this.deaths.splice(i, 1);
    }
    const defaultDef = spriteDef("zombie-death");
    const texturesBySprite = new Map<string, Texture[]>();
    const framesOf = (id: string): Texture[] => {
      const def = spriteDef(id);
      let texs = texturesBySprite.get(def.id);
      if (!texs) {
        texs = DEATH_FRAMES.map((name) => this.texture(def.id, name));
        texturesBySprite.set(def.id, texs);
      }
      return texs;
    };
    const defaultTextures = framesOf(defaultDef.id);
    while (this.deathSprites.length < this.deaths.length) {
      const s = new Sprite(defaultTextures[0]);
      const defaultAnchor = spriteAnchor(defaultDef);
      s.anchor.set(defaultAnchor.x, defaultAnchor.y);
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
      // 按僵尸类型选倒地精灵：胖子用自己的暗粉配色 + 与活体一致的 33px 体型
      const def = spriteDef(zombieDeathSpriteId(d.kind));
      const textures = framesOf(def.id);
      const anchor = spriteAnchor(def);
      s.anchor.set(anchor.x, anchor.y);
      s.visible = true;
      s.position.set(d.x, d.y);
      s.rotation = spriteRotation(d.angle);
      s.scale.set(spriteScale(def.footprintRadius * 2 * VISUAL_SCALE, def));
      // 播完停在末帧；超出序列的部分自然落在 death-3
      const frame = Math.min(DEATH_FRAMES.length - 1, Math.floor(d.age / DEATH_FRAME));
      s.texture = textures[frame];
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
    this.applyCamera();
    const w = world;

    this.renderPickups(extra?.orbs);
    this.renderTerrain(w);
    this.renderPoison(w);
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
      // 狙击枪弹丸略大一点，配合曳光更容易看清
      const core = b.kind === "rocket" ? 3.4 : (b.tracer ?? 0) > 0 ? 2.4 : 1.9;
      s.scale.set(core / CORE_R);
    }
    this.renderTracers(w);

    const effects = w.effects;
    // 电弧与命中光环单独画在 arcLayer；圆点精灵池只分给 ember / blast
    let fxCount = 0;
    for (let i = 0; i < effects.length; i++) {
      const k = effects[i].kind;
      if (k !== "arc" && k !== "ring") fxCount++;
    }
    this.sync(this.fxSprites, fxCount, this.fxLayer);
    let fxIndex = 0;
    for (let i = 0; i < effects.length; i++) {
      const e = effects[i];
      if (e.kind === "arc" || e.kind === "ring") continue;
      const s = this.fxSprites[fxIndex++];
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
      } else if (e.kind === "blood") {
        // 血雾：普通混合的暗红雾团，边扩散边淡出（狙击枪命中反馈）
        s.blendMode = "normal";
        s.alpha = (1 - p) * 0.6;
        s.scale.set((e.radius * (0.7 + p * 0.8)) / CORE_R);
      } else {
        // 爆炸 / 火花：从中心向外扩散后消失
        s.blendMode = "normal";
        s.alpha = (1 - p) * 0.7;
        const k = (0.35 + p * 1.05) * (e.radius / 27);
        s.scale.set(k);
      }
    }

    this.renderArcs(effects);
    this.renderOpenings(w);
    this.renderHumanHealth(w.humans);
    this.renderZombieBuffs(w.zombies);
    this.renderBossBar(w, extra?.hideBossBar === true);
    this.renderSelection(extra?.selection ?? null);
    this.renderFloatingText(extra?.floating);
  }

  /** 创建顶部 BOSS 血条：纯 DOM 覆盖层，缩放 / 镜头都与画布无关 */
  private buildBossBar(host: HTMLElement): void {
    const bar = document.createElement("div");
    bar.className = "boss-bar hidden";
    bar.innerHTML =
      '<div class="boss-bar-head"><span class="boss-bar-name"></span><span class="boss-bar-value"></span></div>' +
      '<div class="boss-bar-track"><i></i></div>';
    host.appendChild(bar);
    this.bossBar = bar;
    this.bossNameEl = bar.querySelector(".boss-bar-name");
    this.bossValueEl = bar.querySelector(".boss-bar-value");
    this.bossFillEl = bar.querySelector(".boss-bar-track > i");
  }

  /** 场上存在母体时显示顶部血条；多只时取血量最高的一只并标出总数 */
  private renderBossBar(world: World, hidden: boolean): void {
    if (!this.bossBar) return;
    const info = hidden ? null : world.bossBarInfo();
    if (!info) {
      this.bossBar.classList.add("hidden");
      return;
    }
    this.bossBar.classList.remove("hidden");
    const ratio = info.maxHp > 0 ? Math.max(0, Math.min(1, info.hp / info.maxHp)) : 0;
    if (this.bossNameEl) {
      this.bossNameEl.textContent = info.count > 1 ? `${info.name} ×${info.count}` : info.name;
    }
    if (this.bossValueEl) {
      this.bossValueEl.textContent = `${Math.ceil(info.hp)} / ${Math.ceil(info.maxHp)}`;
    }
    if (this.bossFillEl) this.bossFillEl.style.width = `${(ratio * 100).toFixed(1)}%`;
  }

  /**
   * 人类头顶细血条：只在受伤后出现，3 秒不再受伤则最后 0.6 秒淡出。
   * 画在独立 Graphics 层上、不读精灵旋转，所以永远保持水平；
   * 宽度取人类可见体宽，颜色按血量比例分三档。
   */
  private renderHumanHealth(humans: Human[]): void {
    const g = this.hpBarLayer;
    g.clear();
    for (let i = 0; i < humans.length; i++) {
      const h = humans[i];
      if (!h.alive) continue;
      // 压制标识：脉动的紫环 + 四道粉色爪痕，压在角色脚下；不依赖血条是否可见
      if (h.pinTimer > 0) {
        const pulse = 0.7 + 0.3 * Math.sin(this.t * 9 + h.id);
        const r = HUMAN_DIAMETER * 0.72;
        g.circle(h.x, h.y, r).stroke({ width: 2, color: 0xc084fc, alpha: 0.85 * pulse });
        for (let k = 0; k < 4; k++) {
          const ang = k * Math.PI * 0.5 + Math.PI * 0.25;
          const cx = h.x + Math.cos(ang) * r;
          const cy = h.y + Math.sin(ang) * r;
          g.moveTo(cx, cy)
            .lineTo(cx + Math.cos(ang) * 4, cy + Math.sin(ang) * 4)
            .stroke({ width: 1.5, color: 0xf472b6, alpha: 0.9 * pulse });
        }
      }
      if (h.hurtTimer <= 0) continue;
      const maxHp = Math.max(1, h.maxHp ?? h.hp);
      const ratio = Math.max(0, Math.min(1, h.hp / maxHp));
      const w = HUMAN_DIAMETER;
      const hgt = 3;
      const x = h.x - w * 0.5;
      const y = h.y - HUMAN_DIAMETER * 0.5 - 6;
      const alpha = Math.min(1, h.hurtTimer / 0.6);
      // 底色 / 边框让细血条在深色地板上也清楚
      g.rect(x - 1, y - 1, w + 2, hgt + 2).fill({ color: 0x05070c, alpha: 0.72 * alpha });
      const color = ratio > 0.6 ? 0x7cf29a : ratio > 0.3 ? 0xfacc15 : 0xef4444;
      g.rect(x, y, w * ratio, hgt).fill({ color, alpha });
    }
  }

  /**
   * 尖叫强化标识：被强化的僵尸脚下画一圈脉动粉环。
   * 与压制标识同层，但不依赖血条显隐；不额外生成素材。
   */
  private renderZombieBuffs(zombies: Zombie[]): void {
    const g = this.hpBarLayer;
    for (let i = 0; i < zombies.length; i++) {
      const z = zombies[i];
      if (!z.alive || z.buffTimer <= 0) continue;
      const pulse = 0.55 + 0.35 * Math.sin(this.t * 8 + z.id);
      g.circle(z.x, z.y, z.radius + 4).stroke({ width: 1.5, color: 0xf472b6, alpha: 0.6 * pulse });
    }
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
          fontFamily: FLOATING_FONT_FAMILY,
          fontSize: FLOATING_FONT_SIZE,
          fontWeight: FLOATING_FONT_WEIGHT,
          fill: 0xffffff,
          stroke: { color: 0x000000, width: FLOATING_STROKE_WIDTH },
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
      s.visible = true;
      s.text = f.text;
      s.position.set(f.x, f.y);
      s.tint = f.color;
      s.alpha = floatingAlpha(f);
      s.scale.set(floatingScale(f) * (f.scale ?? 1));
    }
  }
}
