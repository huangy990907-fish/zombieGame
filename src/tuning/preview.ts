/**
 * 数值调参页的迷你实时预览。
 *
 * 这里刻意不新建第二套伤害公式：用一个极小的沙盒 World，
 * 走和真实对局完全相同的「人类索敌 / 开火 → 子弹 / 爆炸 / 电击 / 火焰 / 毒液 → damageZombie」链路。
 * 调参页编辑的草稿值由 runtime 的草稿层提供，所以未保存的改动会立刻反映在预览里；
 * 正式玩法仍然只读已保存值。
 *
 * 生命周期：
 *  - 进入 #/tuning 时 start()，离开时 dispose()
 *  - dispose 会停掉 RAF、丢弃 World 与所有子弹 / 特效引用，并清空画布
 *  - 使用独立的 2D canvas，不接触主 Pixi 渲染器实例
 */
import { createWorld, type Human, type World } from "../core/world";
import { effectiveWeapon, effectiveZombie } from "../data/settings/runtime";
import { getWeaponDef } from "../data/weapons";
import { getZombieDef } from "../data/zombies";
import type { MapDef } from "../data/types";
import { updateHumans } from "../systems/ai";
import { updateCombat } from "../systems/combat";

const MAP_W = 520;
const MAP_H = 190;
const STEP = 1 / 60;
const RESPAWN_DELAY = 1.2;

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
  /** 上一只靶子的击杀耗时（秒）；还没有击杀时为 null */
  ttk: number | null;
  /** 本次场景的平均 DPS（总伤害 / 经过时间） */
  avgDps: number;
  /** 最近 3 秒瞬时 DPS */
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
  private respawnTimer = 0;
  private totalDamage = 0;
  private lastTtk: number | null = null;

  /** 3 秒窗口：6 个 0.5 秒桶 */
  private readonly buckets = new Array<number>(6).fill(0);
  private bucketIdx = 0;
  private bucketAcc = 0;

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
    this.targetId = null;
    this.buckets.fill(0);
    this.bucketIdx = 0;
    this.bucketAcc = 0;

    world.onDamage = (z, amount) => {
      if (z.id !== this.targetId) return;
      this.totalDamage += amount;
      this.buckets[this.bucketIdx] += amount;
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

  private spawnTarget(world: World): void {
    // 按当前武器射程取 70%：既在射程内（人类站定开火），又留出弹道飞行距离
    const range = effectiveWeapon(this.weaponId).range;
    const dist = Math.max(110, Math.min(range * 0.7, MAP_W - 40 - 60));
    const z = world.spawnZombie(40 + dist, MAP_H / 2, this.zombieId);
    // 靶子不移动、不反击：不调用 updateZombies，也不参与任何行为层
    z.speed = 0;
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
        z.x = 40 + Math.max(
          110,
          Math.min(effectiveWeapon(this.weaponId).range * 0.7, MAP_W - 40 - 60),
        );
        z.y = MAP_H / 2;
        z.speed = 0;
      }
    }

    world.rebuildGrids();
    updateHumans(world, dt);
    updateCombat(world, dt);
    world.tickTerrain(dt);
    world.ageEffects(dt);
    world.compact();
  }

  // ============================================================
  // 绘制（纯 2D canvas，独立于主 Pixi 渲染器）
  // ============================================================

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

    // 人类
    if (this.human) {
      const h = this.human;
      const wdef = getWeaponDef(this.weaponId);
      const wc = `#${wdef.color.toString(16).padStart(6, "0")}`;
      ctx.strokeStyle = wc;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(h.x + Math.cos(h.facing) * 14, h.y + Math.sin(h.facing) * 14);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(h.x, h.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = "#dbe6ff";
      ctx.fill();
      ctx.strokeStyle = wc;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 靶子
    const target = this.targetId !== null ? world.zombies.find((z) => z.id === this.targetId) : undefined;
    if (target) {
      const zdef = getZombieDef(target.kind);
      const color = `#${zdef.color.toString(16).padStart(6, "0")}`;
      ctx.beginPath();
      ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
      ctx.fillStyle = target.flash > 0 ? "#ffffff" : color;
      ctx.fill();
      if (target.slowTimer > 0) {
        ctx.strokeStyle = "rgba(130, 190, 255, 0.8)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(target.x, target.y, target.radius + 2.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 血条
      const maxHp = target.maxHp ?? effectiveZombie(target.kind).hp;
      const hp = Math.max(0, Math.min(target.hp, maxHp));
      const barW = Math.max(34, target.radius * 2.8);
      const barX = target.x - barW / 2;
      const barY = target.y - target.radius - 12;
      ctx.fillStyle = "rgba(10, 12, 20, 0.9)";
      ctx.fillRect(barX - 1, barY - 1, barW + 2, 6);
      ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
      ctx.fillRect(barX, barY, barW, 4);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(barX, barY, barW * (hp / Math.max(1, maxHp)), 4);

      ctx.fillStyle = "#8d99ad";
      ctx.font = "10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(zdef.name, target.x, barY - 4);
    }

    if (this.targetId === null && this.respawnTimer > 0) {
      ctx.fillStyle = "rgba(200, 214, 236, 0.7)";
      ctx.font = "12px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("靶子重组中…", 40, MAP_H / 2 - 22);
    }
  }
}

/** 靶子血条上限：优先用生成时快照，缺失时回落到当前有效定义 */
