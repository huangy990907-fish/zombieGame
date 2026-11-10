/**
 * 数值调参页的迷你实时预览。
 *
 * 这里刻意不新建第二套伤害公式：用一个极小的沙盒 World，
 * 走和真实对局完全相同的「人类索敌 / 开火 → 子弹 / 爆炸 / 电击 / 火焰 / 毒液 → damageZombie」链路。
 * 调参页编辑的草稿值由 runtime 的草稿层提供，所以未保存的改动会立刻反映在预览里；
 * 正式玩法仍然只读已保存值。
 *
 * 视觉上同样走真实精灵管线：
 *  - 人类用 human-<weapon> 烘焙组合精灵（武器 overlay 已烘进图里）
 *  - 靶子用 zombie-<kind>，按 SpriteDef / spriteGrid / spriteScale / spriteAnchor 绘制
 *  - 朝向换算复用 spriteRotation()
 *  - 伤害飘字复用 render/floating 的同一套生成 / 计时 / 透明度 / 缩放规则
 *
 * 生命周期：
 *  - 进入 #/tuning 时 start()，离开时 dispose()
 *  - dispose 会停掉 RAF、丢弃 World / 飘字 / 子弹 / 特效引用，并清空画布
 *  - 使用独立的 2D canvas，不接触主 Pixi 渲染器实例；
 *    getNativeFrame 的纹理缓存是全项目共享的，这里只读不清理，避免影响主渲染器
 */
import { getNativeFrame } from "../art";
import { createWorld, type DamageSource, type Human, type World } from "../core/world";
import { effectiveWeapon, effectiveZombie } from "../data/settings/runtime";
import { getZombieDef } from "../data/zombies";
import type { MapDef } from "../data/types";
import { updateHumans } from "../systems/ai";
import { updateCombat } from "../systems/combat";
import {
  FLOATING_FONT_FAMILY,
  FLOATING_FONT_SIZE,
  FLOATING_FONT_WEIGHT,
  FLOATING_STROKE_WIDTH,
  ageFloating,
  floatingAlpha,
  floatingColorCss,
  floatingScale,
  pushFloating,
  type FloatingText,
} from "../render/floating";
import {
  HUMAN_DIAMETER,
  humanSpriteId,
  spriteAnchor,
  spriteDef,
  spriteRotation,
  spriteScale,
  VISUAL_SCALE,
  zombieSpriteId,
} from "../render/pixel";

const MAP_W = 520;
const MAP_H = 190;
const STEP = 1 / 60;
const RESPAWN_DELAY = 1.2;
/** 重生淡入时长（0.2–0.3s） */
const RESPAWN_FADE = 0.25;
/** 开火帧保持时长，和主渲染器一致 */
const FIRE_HOLD = 0.12;

/** 预览专用空场地图：没有墙 / 门窗 / 草丛，靶子不会移动也不会被地形挡住 */
const PREVIEW_MAP: MapDef = {
  id: "tuning-preview",
  name: "调参预览",
  width: MAP_W,
  height: MAP_H,
  room: { left: 0, top: 0, right: MAP_W, bottom: MAP_H, wall: 0 },
  walls: [],
  openings: [],
  openingCenters: [],
  spawn: [],
  windowSpawn: {},
  humanZones: [{ x0: 0, y0: 0, x1: MAP_W, y1: MAP_H }],
  humanBounds: { x0: 24, y0: 28, x1: MAP_W - 24, y1: MAP_H - 28 },
  buildBiteDamage: 0,
  buildBiteSlow: 1,
  grassTiles: [],
  waterTiles: [],
  waterBlockers: [],
};

export interface PreviewStats {
  /** 上一只靶子的击杀耗时（秒）；每只靶子单独计时 */
  ttk: number | null;
  /** 本次场景的平均 DPS（跨重生连续累计） */
  avgDps: number;
  /** 最近 3 秒瞬时 DPS（跨重生连续） */
  recentDps: number;
  weaponId: string;
  zombieId: string;
}

export class TuningPreview {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private world: World | null = null;
  private human: Human | null = null;
  private weaponId = "mg";
  private zombieId = "normal";

  private raf = 0;
  private running = false;
  private lastFrame = 0;
  private acc = 0;

  private sessionTime = 0;
  private spawnTime = 0;
  private targetId: number | null = null;
  /** 死亡后等待重生（人类待机、不开火） */
  private respawnTimer = 0;
  /** 重生淡入进度：0 → 1，期间靶子还没有进入 World */
  private respawning = false;
  private respawnFade = 0;
  private respawnX = 0;
  private respawnY = 0;

  private totalDamage = 0;
  private lastTtk: number | null = null;
  /** 3 秒窗口：6 个 0.5 秒桶 */
  private readonly buckets = new Array<number>(6).fill(0);
  private bucketIdx = 0;
  private bucketAcc = 0;

  private readonly floaters: FloatingText[] = [];
  private prevFire = 0;
  private fireHold = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("preview canvas 2d context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  /** 切换武器：重建场景（靶子沿用上次选中的僵尸） */
  setWeapon(id: string): void {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.running) this.rebuild();
  }

  /** 切换靶子：重建场景（人类沿用上次选中的武器） */
  setZombie(id: string): void {
    if (id === this.zombieId) return;
    this.zombieId = id;
    if (this.running) this.rebuild();
  }

  getStats(): PreviewStats {
    const recent = Math.min(3, Math.max(this.sessionTime, 0.001));
    return {
      ttk: this.lastTtk,
      avgDps: this.totalDamage / Math.max(this.sessionTime, 0.001),
      recentDps: this.buckets.reduce((a, b) => a + b, 0) / recent,
      weaponId: this.weaponId,
      zombieId: this.zombieId,
    };
  }

  /** 进入调参页时调用 */
  start(): void {
    if (this.running) return;
    this.resize();
    this.rebuild();
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  /** 离开调参页时调用：停 ticker、丢弃场景并清空画布，不留任何引用 */
  dispose(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.world = null;
    this.human = null;
    this.targetId = null;
    this.respawnTimer = 0;
    this.respawning = false;
    this.respawnFade = 0;
    this.floaters.length = 0;
    const { ctx, canvas } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  private resize(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(MAP_W * dpr);
    this.canvas.height = Math.round(MAP_H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private rebuild(): void {
    const world = createWorld(PREVIEW_MAP);
    this.world = world;
    this.sessionTime = 0;
    this.totalDamage = 0;
    this.lastTtk = null;
    this.spawnTime = 0;
    this.respawnTimer = 0;
    this.respawning = false;
    this.respawnFade = 0;
    this.targetId = null;
    this.buckets.fill(0);
    this.bucketIdx = 0;
    this.bucketAcc = 0;
    this.floaters.length = 0;
    this.prevFire = 0;
    this.fireHold = 0;

    world.onDamage = (z, amount, source?: DamageSource) => {
      if (z.id !== this.targetId) return;
      this.totalDamage += amount;
      this.buckets[this.bucketIdx] += amount;
      // 与训练场同一条规则：颜色跟随来源武器，数值取整
      const color = source?.weapon ? effectiveWeapon(source.weapon).color : 0xffffff;
      pushFloating(this.floaters, z.x, z.y, String(Math.max(1, Math.round(amount))), color);
    };
    world.onKill = (z) => {
      if (z.id !== this.targetId) return;
      this.lastTtk = Math.max(0, this.sessionTime - this.spawnTime);
      this.targetId = null;
      this.respawnTimer = RESPAWN_DELAY;
      // 母体死亡会产卵：清掉全部旧单位，保证预览始终是"一只靶子"的循环
      world.zombies.length = 0;
    };

    this.spawnHuman(world);
    this.spawnTarget(world);
    this.draw();
  }

  private spawnHuman(world: World): void {
    const h = world.spawnHuman(40, MAP_H / 2, this.weaponId);
    h.facing = 0;
    h.post = -1;
    this.human = h;
  }

  /** 靶子站位：按当前武器射程取 70%，既在射程内又留出弹道飞行距离 */
  private targetPosition(): { x: number; y: number } {
    const range = effectiveWeapon(this.weaponId).range;
    return {
      x: 40 + Math.max(110, Math.min(range * 0.7, MAP_W - 40 - 60)),
      y: MAP_H / 2,
    };
  }

  private spawnTarget(world: World): void {
    const pos = this.targetPosition();
    const z = world.spawnZombie(pos.x, pos.y, this.zombieId);
    // 靶子不移动、不反击：不调用 updateZombies，也不参与任何行为层
    z.speed = 0;
    // 朝向人类（让精灵面向左侧），但不执行 AI
    z.tx = 40;
    z.ty = MAP_H / 2;
    this.targetId = z.id;
    this.spawnTime = this.sessionTime;
  }

  private readonly loop = (now: number): void => {
    if (!this.running) return;
    const elapsed = Math.min(0.2, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.acc += elapsed;
    let steps = 0;
    while (this.acc >= STEP && steps < 6) {
      this.tick(STEP);
      this.acc -= STEP;
      steps++;
    }
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private tick(dt: number): void {
    const world = this.world;
    if (!world) return;
    this.sessionTime += dt;

    this.bucketAcc += dt;
    while (this.bucketAcc >= 0.5) {
      this.bucketAcc -= 0.5;
      this.bucketIdx = (this.bucketIdx + 1) % this.buckets.length;
      this.buckets[this.bucketIdx] = 0;
    }

    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.respawnTimer = 0;
        // 先进入淡入过渡，靶子暂时不进入 World：人类保持待机、不开火
        this.respawning = true;
        this.respawnFade = 0;
        const pos = this.targetPosition();
        this.respawnX = pos.x;
        this.respawnY = pos.y;
      }
    }
    if (this.respawning) {
      this.respawnFade = Math.min(1, this.respawnFade + dt / RESPAWN_FADE);
      if (this.respawnFade >= 1) {
        this.respawning = false;
        this.respawnFade = 0;
        this.spawnTarget(world);
      }
    }

    // 人类固定在左侧、靶子固定在右侧：这里只复用 AI 的索敌 / 开火，不让它走位
    const h = this.human;
    if (h) {
      h.x = 40;
      h.y = MAP_H / 2;
      h.vx = 0;
      h.vy = 0;
    }
    for (const z of world.zombies) {
      if (z.id === this.targetId) {
        const pos = this.targetPosition();
        z.x = pos.x;
        z.y = pos.y;
        z.tx = 40;
        z.ty = MAP_H / 2;
        z.speed = 0;
      }
    }

    world.rebuildGrids();
    updateHumans(world, dt);
    updateCombat(world, dt);
    world.tickTerrain(dt);
    world.ageEffects(dt);
    world.compact();

    // 开火帧：冷却值突然变大 = 刚打出一发（和主渲染器同一判定）
    if (h) {
      if (h.fire > this.prevFire + 1e-4) this.fireHold = FIRE_HOLD;
      this.prevFire = h.fire;
      this.fireHold = Math.max(0, this.fireHold - dt);
    }

    ageFloating(this.floaters, dt);
  }

  // ============================================================
  // 绘制（2D canvas + 真实精灵管线）
  // ============================================================

  /** 按 SpriteDef 的网格 / 锚点 / 缩放 / 旋转画一帧精灵，与主渲染器的摆放口径一致 */
  private drawSprite(
    defId: string,
    frame: string,
    x: number,
    y: number,
    diameter: number,
    angle: number,
    alpha = 1,
    scaleMul = 1,
  ): void {
    const def = spriteDef(defId);
    const img = getNativeFrame(def, frame);
    const scale = spriteScale(diameter, def) * scaleMul;
    const anchor = spriteAnchor(def);
    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(spriteRotation(angle));
    ctx.scale(scale, scale);
    ctx.drawImage(
      img,
      -anchor.x * img.width,
      -anchor.y * img.height,
    );
    ctx.restore();
  }

  private draw(): void {
    const { ctx } = this;
    const world = this.world;
    ctx.clearRect(0, 0, MAP_W, MAP_H);

    // 地面
    const bg = ctx.createLinearGradient(0, 0, 0, MAP_H);
    bg.addColorStop(0, "#0b101c");
    bg.addColorStop(1, "#070a12");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, MAP_W, MAP_H);

    ctx.strokeStyle = "rgba(120, 150, 210, 0.07)";
    ctx.lineWidth = 1;
    for (let x = 20; x < MAP_W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, MAP_H);
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(120, 150, 210, 0.1)";
    ctx.beginPath();
    ctx.moveTo(0, MAP_H / 2 + 0.5);
    ctx.lineTo(MAP_W, MAP_H / 2 + 0.5);
    ctx.stroke();

    if (!world) return;

    // 毒液池
    for (const p of world.poison) {
      const alpha = Math.max(0.08, Math.min(0.4, p.remaining / Math.max(0.001, p.total))) * 0.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(110, 231, 120, ${alpha})`;
      ctx.fill();
    }

    // 弹道
    for (const b of world.bullets) {
      if (!b.alive) continue;
      ctx.strokeStyle = b.kind === "rocket" ? "#ffb066" : "#ffe9a8";
      ctx.lineWidth = b.kind === "rocket" ? 3 : 1.6;
      ctx.beginPath();
      ctx.moveTo(b.px, b.py);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // 特效
    for (const e of world.effects) {
      const t = Math.min(1, e.age / Math.max(0.001, e.life));
      const alpha = 1 - t;
      const color = `#${e.color.toString(16).padStart(6, "0")}`;
      if (e.kind === "arc" && e.points && e.points.length > 1) {
        ctx.strokeStyle = `rgba(140, 220, 255, ${0.35 + 0.65 * alpha})`;
        ctx.lineWidth = 1.4 + (e.strength ?? 1);
        ctx.beginPath();
        ctx.moveTo(e.points[0].x, e.points[0].y);
        for (let i = 1; i < e.points.length; i++) ctx.lineTo(e.points[i].x, e.points[i].y);
        ctx.stroke();
      } else if (e.kind === "blast" || e.kind === "ring") {
        ctx.strokeStyle = `rgba(255, 176, 102, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.radius * (0.35 + 0.65 * t), 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.globalAlpha = Math.max(0.05, alpha);
        ctx.beginPath();
        ctx.arc(e.x, e.y, Math.max(1, e.radius * (1 - t * 0.5)), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    // 人类：human-<weapon> 烘焙精灵，开火时切 fire 帧
    if (this.human) {
      const h = this.human;
      const frame = this.fireHold > 0 ? "fire" : "idle";
      this.drawSprite(humanSpriteId(this.weaponId), frame, h.x, h.y, HUMAN_DIAMETER, h.facing);
    }

    // 靶子：zombie-<kind> 精灵 + 血条
    const target = this.targetId !== null ? world.zombies.find((z) => z.id === this.targetId) : undefined;
    if (target) {
      this.drawSprite(
        zombieSpriteId(target.kind),
        "idle",
        target.x,
        target.y,
        target.bodyDiameter * VISUAL_SCALE,
        Math.PI,
      );

      const maxHp = target.maxHp ?? effectiveZombie(target.kind).hp;
      const hp = Math.max(0, Math.min(target.hp, maxHp));
      const barW = Math.max(34, target.bodyDiameter * VISUAL_SCALE * 2.8);
      const barX = target.x - barW / 2;
      const barY = target.y - target.bodyDiameter * VISUAL_SCALE - 12;
      ctx.fillStyle = "rgba(10, 12, 20, 0.9)";
      ctx.fillRect(barX - 1, barY - 1, barW + 2, 6);
      ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
      ctx.fillRect(barX, barY, barW, 4);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(barX, barY, barW * (hp / Math.max(1, maxHp)), 4);

      ctx.fillStyle = "#8d99ad";
      ctx.font = "10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(getZombieDef(target.kind).name, target.x, barY - 4);
    }

    // 重生淡入：半透明 + 轻微缩放，脚下光圈随进度褪去
    if (this.respawning) {
      const fade = this.respawnFade;
      const def = effectiveZombie(this.zombieId);
      const diameter = def.radius * 2 * VISUAL_SCALE;
      ctx.save();
      ctx.globalAlpha = 0.85 * (1 - fade);
      ctx.strokeStyle = "rgba(140, 220, 255, 0.9)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(this.respawnX, this.respawnY + diameter * 0.35, diameter * (0.9 + fade * 0.5), diameter * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      this.drawSprite(
        zombieSpriteId(this.zombieId),
        "idle",
        this.respawnX,
        this.respawnY,
        diameter,
        Math.PI,
        fade,
        0.85 + 0.15 * fade,
      );
    }

    // 伤害飘字：与训练场同一套样式 / 生命周期
    this.drawFloaters();
  }

  private drawFloaters(): void {
    const { ctx } = this;
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${FLOATING_FONT_WEIGHT} ${FLOATING_FONT_SIZE}px ${FLOATING_FONT_FAMILY}`;
    ctx.lineWidth = FLOATING_STROKE_WIDTH;
    ctx.strokeStyle = "#000000";
    for (const f of this.floaters) {
      const s = floatingScale(f) * (f.scale ?? 1);
      ctx.save();
      ctx.globalAlpha = floatingAlpha(f);
      ctx.translate(f.x, f.y);
      ctx.scale(s, s);
      ctx.strokeText(f.text, 0, 0);
      ctx.fillStyle = floatingColorCss(f.color);
      ctx.fillText(f.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}
