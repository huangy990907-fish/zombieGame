/**
 * 战斗系统 —— 开火、弹道、伤害结算。
 *
 * tryFire：人类每帧尝试开火（由 ai.ts 在瞄准时调用）
 * updateCombat：子弹飞行 + 命中判定 + 爆炸结算
 *
 * 命中判定用的是“线段扫掠”而不是点：高速子弹一帧能飞十几像素，
 * 只看当前点会穿透丧尸，所以拿“上一帧位置 -> 当前位置”线段去撞。
 */
import { effectiveWeapon } from "../data/settings/runtime";
import { MAX_ZOMBIE_RADIUS, ZOMBIE_SLOW } from "../data/zombies";
import { WEAPON_IDS } from "../data/weapons";
import type { WeaponDef } from "../data/types";
import { dist2, mixColor, pointSegDistSq, segRectHit } from "../utils/math";
import type { BulletKind, DamageSource, Human, World, Zombie } from "../core/world";
import { sound, SFX } from "../audio/manager";
import { humanMuzzle } from "../render/pixel";

const queryBuf: Zombie[] = [];

/**
 * 尝试开火。冷却中 / 换弹中 / 没弹药则直接返回。
 * 弹药打空自动进入换弹。
 *
 * 喷火是特例：它不发射子弹，而是"扣 1 格燃料 → 连续喷 burst 秒"，
 * 所以这里只负责点燃，真正的持续伤害由 updateFlame() 每帧推进。
 */
export function tryFire(world: World, h: Human, angle: number): void {
  const def = effectiveWeapon(h.weapon);
  // 训练场可给单个人类覆盖伤害 / 射速；普通对局两个倍率都是 undefined → 1
  const dmgMul = h.dmgMul ?? 1;
  const cooldown = def.cooldown * (h.cdMul ?? 1);
  // 生存模式等的单角色操控可以单独收窄散布（其余模式不设置，沿用武器定义）
  const spread = h.spreadOverride ?? def.spread;

  if (def.kind === "flame") {
    if (h.burst > 0 || h.reloadTimer > 0 || h.ammo <= 0) return;
    h.ammo--;
    h.burst = def.burst;
    h.fire = 0; // 归零后下一帧立刻开始第一次伤害结算
    return;
  }

  if (def.kind === "tesla") {
    if (h.fire > 0 || h.reloadTimer > 0 || h.ammo <= 0) return;
    h.fire = cooldown;
    h.ammo--;
    sound.play(SFX.TESLA);
    fireTesla(world, h, angle, def, dmgMul);
    if (h.ammo <= 0) h.reloadTimer = def.reload;
    return;
  }

  if (h.fire > 0 || h.reloadTimer > 0 || h.ammo <= 0) return;

  h.fire = cooldown;
  h.ammo--;

  // —— 武器音效触发（每种武器独立限频，密集开火自然形成火力密度）——
  if (def.kind === "bullet") sound.play(SFX.MG_SHOT);
  else if (def.kind === "pellet") sound.play(SFX.SHOTGUN);
  else if (def.kind === "rocket") sound.play(SFX.ROCKET);

  if (def.kind === "pellet") {
    // 霰弹：一发多颗弹丸，每颗独立散布
    for (let i = 0; i < def.pellets; i++) {
      const a = angle + (Math.random() - 0.5) * spread * 2;
      spawnBullet(world, h, a, def.speed, def.damage * dmgMul, "bullet", 0, def.range / def.speed);
    }
  } else {
    // 机枪 / 火箭：单发弹道
    const a = angle + (Math.random() - 0.5) * spread * 2;
    const kind: BulletKind = def.kind === "rocket" ? "rocket" : "bullet";
    spawnBullet(world, h, a, def.speed, def.damage * dmgMul, kind, def.blast, def.range / def.speed);
  }

  if (h.ammo <= 0) h.reloadTimer = def.reload;
}

/** 电击枪视线：墙体和未破的门/窗都会挡住链式跳跃（破口后放行） */
function teslaBlocked(world: World, ax: number, ay: number, bx: number, by: number): boolean {
  for (const w of world.map.walls) {
    if (segRectHit(ax, ay, bx, by, w)) return true;
  }
  for (const o of world.openings) {
    if (!o.broken && segRectHit(ax, ay, bx, by, o.rect)) return true;
  }
  return false;
}

/** 射线 + 视线 + 目标半径选首个目标：取射线上最近的、未被遮挡的僵尸 */
function findTeslaFirst(
  world: World,
  mx: number,
  my: number,
  angle: number,
  range: number,
): Zombie | null {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  world.zombieGrid.query(mx, my, range + MAX_ZOMBIE_RADIUS, queryBuf);
  let best: Zombie | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < queryBuf.length; i++) {
    const z = queryBuf[i];
    if (!z.alive) continue;
    const dx = z.x - mx;
    const dy = z.y - my;
    // 投影距离：目标必须在前方射程内
    const proj = dx * dirX + dy * dirY;
    if (proj <= 0 || proj > range) continue;
    // 点到射线的垂直距离，命中容差取目标半径 + 少量擦边
    const perp = Math.abs(dx * dirY - dy * dirX);
    if (perp > z.radius + 3) continue;
    if (teslaBlocked(world, mx, my, z.x, z.y)) continue;
    if (proj < bestDist) {
      bestDist = proj;
      best = z;
    }
  }
  return best;
}

/** 链式跳跃：以当前目标为圆心找最近的、未被本次电击命中且视线可见的僵尸 */
function findTeslaNext(
  world: World,
  from: Zombie,
  radius: number,
  visited: Set<number>,
): Zombie | null {
  world.zombieGrid.query(from.x, from.y, radius, queryBuf);
  let best: Zombie | null = null;
  let bestD = Infinity;
  for (let i = 0; i < queryBuf.length; i++) {
    const z = queryBuf[i];
    if (!z.alive || visited.has(z.id)) continue;
    const d = dist2(from.x, from.y, z.x, z.y);
    if (d > radius * radius || d >= bestD) continue;
    if (teslaBlocked(world, from.x, from.y, z.x, z.y)) continue;
    bestD = d;
    best = z;
  }
  return best;
}

/**
 * 电弧视觉强度：跟随链式伤害的每跳衰减（0.75^n）逐跳变细、变暗。
 * 只用于渲染，不参与伤害计算。
 */
function arcStrength(chainFalloff: number, jump: number): number {
  return Math.pow(chainFalloff, jump);
}

/**
 * 生成一段电弧：沿主轴拆成 8–12 个细分段，逐点加入高频、低振幅的法线抖动，
 * 形成自然抖动的不规则曲线（不再是几段大折角）。
 *
 * - 抖动幅度随 strength 递减，靠后的跳跃更弱；
 * - 两端用 sin 窗口收束，枪口 / 目标端点保持精确，不做位移；
 * - strength 同时供渲染层缩放线宽与亮度。持续 0.12 秒，瞬时特效。
 */
function addTeslaArc(
  world: World,
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  color: number,
  strength: number,
): void {
  const dx = tx - fx;
  const dy = ty - fy;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  // 8–12 段：短跳也够密，长跳再加密，避免出现折尺感
  const segments = Math.max(8, Math.min(12, Math.round(len / 12)));
  // 低振幅抖动：首跳约 4px，末跳约 1.5px
  const amp = (2.2 + Math.min(2.2, len * 0.015)) * (0.35 + 0.65 * strength);
  const points: Array<{ x: number; y: number }> = [{ x: fx, y: fy }];
  for (let i = 1; i < segments; i++) {
    const t = i / segments;
    // 两端收敛：越靠近端点抖动越小，保证端点精确落在枪口 / 目标上
    const window = Math.sin(Math.PI * t);
    const off = (Math.random() - 0.5) * 2 * amp * window;
    points.push({
      x: fx + dx * t + nx * off,
      y: fy + dy * t + ny * off,
    });
  }
  points.push({ x: tx, y: ty });
  world.effects.push({
    kind: "arc",
    x: fx,
    y: fy,
    angle: 0,
    radius: 0,
    color,
    age: 0,
    life: 0.12,
    points,
    strength,
  });
}

/** 单体强化的闪白时长（秒）：常规受击是 0.08 秒，拉长后渲染层做强白 + 轻微尺寸脉冲 */
const TESLA_SOLO_FLASH = 0.16;

/**
 * 电击命中反馈：目标处一圈扩散光环；单体加成（附近没有其他僵尸）时，
 * 额外只作用在这只被击中的僵尸身上——更强的白闪、一圈短促电火花与极轻微的尺寸脉冲。
 * 全部是纯视觉特效，不影响伤害、击退或硬直。
 */
function addTeslaHitFeedback(world: World, z: Zombie, empowered: boolean): void {
  world.effects.push({
    kind: "ring",
    x: z.x,
    y: z.y,
    angle: 0,
    radius: z.radius + 2,
    color: empowered ? 0xdff6ff : 0xffeaa0,
    age: 0,
    life: empowered ? 0.26 : 0.18,
  });
  if (!empowered) return;

  z.flash = Math.max(z.flash, TESLA_SOLO_FLASH);
  // 一圈电火花：短命 ember 粒子沿圆周向外迸射，幅度克制
  const sparks = 10;
  for (let i = 0; i < sparks; i++) {
    const a = (i / sparks) * Math.PI * 2 + Math.random() * 0.18;
    const speed = 60 + Math.random() * 70;
    world.effects.push({
      kind: "ember",
      x: z.x + Math.cos(a) * (z.radius + 2),
      y: z.y + Math.sin(a) * (z.radius + 2),
      angle: a,
      radius: 1.6 + Math.random() * 1.2,
      color: 0xeafcff,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      age: 0,
      life: 0.18 + Math.random() * 0.1,
    });
  }
}

/**
 * 电击枪一次放电：瞬时命中，不需要子弹。
 * 首个目标单挑时伤害 ×2.2；否则以它为起点逐只链式跳跃，
 * 最多命中 chainMaxTargets 只，每跳伤害按 chainFalloff 衰减。
 */
function fireTesla(world: World, h: Human, angle: number, def: WeaponDef, dmgMul: number): void {
  const cfg = def.tesla;
  if (!cfg) return;
  const muzzle = humanMuzzle(h.weapon, h.x, h.y, angle);
  const first = findTeslaFirst(world, muzzle.x, muzzle.y, angle, def.range);
  if (!first) return;

  // 单体加成只看“首个目标附近有没有其他僵尸”，不看它们是否被墙挡住
  let hasOtherNear = false;
  world.zombieGrid.query(first.x, first.y, cfg.singleRadius, queryBuf);
  for (let i = 0; i < queryBuf.length; i++) {
    const z = queryBuf[i];
    if (z.alive && z !== first) {
      hasOtherNear = true;
      break;
    }
  }
  const solo = !hasOtherNear;
  const firstDamage = def.damage * dmgMul * (solo ? cfg.singleBonus : 1);
  const source: DamageSource = { weapon: h.weapon, humanId: h.id };
  addTeslaArc(world, muzzle.x, muzzle.y, first.x, first.y, 0xffe14d, 1);
  damageZombie(world, first, firstDamage, source);
  addTeslaHitFeedback(world, first, solo);

  const visited = new Set<number>([first.id]);
  let current = first;
  let damage = firstDamage;
  let hits = 1;
  for (let jump = 1; jump < cfg.chainMaxTargets; jump++) {
    const next = findTeslaNext(world, current, cfg.chainRadius, visited);
    if (!next) break;
    damage *= cfg.chainFalloff;
    addTeslaArc(
      world,
      current.x,
      current.y,
      next.x,
      next.y,
      0xffe14d,
      arcStrength(cfg.chainFalloff, jump),
    );
    damageZombie(world, next, damage, source);
    addTeslaHitFeedback(world, next, false);
    visited.add(next.id);
    current = next;
    hits++;
  }
  world.onTeslaVolley?.(hits, solo);
}

/**
 * 喷火的每帧推进（由 ai.ts 在人类更新时调用）。
 *
 * 喷射中：每 cooldown 秒结算一次锥形范围内的伤害，并生成一簇散射火舌；
 * 一轮喷完：进入散热倒计时（reloadTimer），这段时间不能再喷。
 */
export function updateFlame(world: World, h: Human, dt: number): void {
  if (h.fire > 0) h.fire -= dt;
  if (h.burst <= 0) return;

  const def = effectiveWeapon(h.weapon);
  h.burst -= dt;
  if (h.fire > 0) return;

  // 射速倍率对喷火同样生效：倍率越大，伤害结算越频繁
  h.fire = def.cooldown * (h.cdMul ?? 1);
  sound.play(SFX.FLAME); // 持续喷火每轮结算都响（限频 60ms）
  flameTick(world, h, def);
  if (h.burst <= 0) h.reloadTimer = def.reload;
}

/** 一次火焰伤害结算：喷出一簇倒锥形的 ember 火星 + 对锥形内丧尸造成伤害 */
function flameTick(world: World, h: Human, def: WeaponDef): void {
  const angle = h.facing;
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  // 枪口位置：精灵 fire 帧的 muzzle 偏移（muzzle - anchor）按朝向旋转，
  // 子弹与火舌都从这里出膛，保证视觉上贴着枪管口
  const muzzle = humanMuzzle(h.weapon, h.x, h.y, angle);
  const muzzleX = muzzle.x;
  const muzzleY = muzzle.y;

  /*
   * ember 火星粒子：每次结算喷 7 颗，从枪口沿锥形方向飞出。
   * 每颗按“预定落点距离”反推初速，飞行由 ageEffects 推进；
   * 落点越远粒子越大、颜色越红 —— 近枪口白黄、远端橙红，
   * 大量粒子叠在一起宏观上就是一团从枪口张开的倒锥形火舌。
   */
  for (let i = 0; i < 7; i++) {
    const p = 0.15 + Math.random() * 0.85; // 落点占射程的比例
    const dist = def.range * p;
    const a = angle + (Math.random() - 0.5) * def.spread * 1.7;
    const life = 0.26 + Math.random() * 0.14;
    const spd = (dist / life) * (0.85 + Math.random() * 0.3);
    world.effects.push({
      kind: "ember",
      x: muzzleX,
      y: muzzleY,
      angle: 0,
      radius: 3.2 + p * 9 + Math.random() * 2.5,
      color: mixColor(0xffe8b0, 0xff5a1f, p * p),
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      age: 0,
      life,
    });
  }

  // 锥形范围持续伤害：用点积判断丧尸是否落在以 facing 为中心的扇形里
  world.zombieGrid.query(h.x, h.y, def.range, queryBuf);
  const minDot = Math.cos(def.spread);
  const dmgMul = h.dmgMul ?? 1;
  const source: DamageSource = { weapon: h.weapon, humanId: h.id };
  for (let i = 0; i < queryBuf.length; i++) {
    const z = queryBuf[i];
    if (!z.alive) continue;
    const dx = z.x - h.x;
    const dy = z.y - h.y;
    const d = Math.hypot(dx, dy);
    if (d < 1 || d > def.range) continue;
    if ((dx * dirX + dy * dirY) / d < minDot) continue;
    damageZombie(world, z, def.damage * dmgMul, source);
  }
}

function spawnBullet(
  world: World,
  h: Human,
  angle: number,
  speed: number,
  damage: number,
  kind: BulletKind,
  blast: number,
  life: number,
): void {
  const muzzle = humanMuzzle(h.weapon, h.x, h.y, angle);
  const x = muzzle.x;
  const y = muzzle.y;
  world.bullets.push({
    x,
    y,
    px: x,
    py: y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    damage,
    kind,
    blast,
    life,
    alive: true,
    // 记录来源，训练场据此把伤害/击杀归到具体武器
    weapon: h.weapon,
    ownerId: h.id,
    dmgMul: h.dmgMul ?? 1,
  });
}

/**
 * 受击减速 + 闪白反馈。
 *  - 按实际伤害换算减速倍率，最低 40%；大体型只降到 70%
 *  - 不叠加：只保留当前最强的一次；每次受击都把恢复计时刷回 0.6 秒
 *  - 喷火这类持续伤害每秒最多结算一次，避免每帧刷新把僵尸钉死在最低速
 */
function applyHitSlow(world: World, z: Zombie, damage: number, source?: DamageSource): void {
  const flame = source?.weapon === WEAPON_IDS.flame;
  if (flame) {
    if (world.time - z.lastFlameSlow < ZOMBIE_SLOW.flameInterval) return;
    z.lastFlameSlow = world.time;
  }
  // 体型按生成时快照的身体直径判定，不受设置面板事后覆盖影响
  const heavy = z.bodyDiameter >= ZOMBIE_SLOW.heavyDiameter;
  const scale = heavy ? ZOMBIE_SLOW.heavyScale : 1;
  const floor = heavy ? ZOMBIE_SLOW.heavyFloorMul : ZOMBIE_SLOW.floorMul;
  const target = Math.max(floor, 1 - damage * ZOMBIE_SLOW.perDamage * scale);
  if (z.slowTimer <= 0 || target < z.slowMul) z.slowMul = target;
  z.slowTimer = ZOMBIE_SLOW.duration;
  z.flash = 0.08; // 短促亮起，渲染层用加法混合做受击提亮
}

/** 对丧尸造成伤害，死亡时计数（source 仅供训练场统计，正式对局不传） */
export function damageZombie(world: World, z: Zombie, dmg: number, source?: DamageSource): void {
  if (!z.alive) return;
  // 实际生效伤害（不超过剩余血量），DPS 统计更准确
  const applied = Math.min(dmg, z.hp);
  z.hp -= dmg;
  applyHitSlow(world, z, applied, source);
  world.onDamage?.(z, applied, source);
  sound.play(SFX.ZOMBIE_HIT);
  if (z.hp <= 0) {
    z.alive = false;
    world.kills++;
    world.onKill?.(z, source);
    sound.play(SFX.ZOMBIE_KILL);
  }
}

/** 从子弹上还原伤害来源（没有 weapon 字段时返回 undefined） */
function bulletSource(b: { weapon?: string; ownerId?: number }): DamageSource | undefined {
  if (b.weapon === undefined) return undefined;
  return { weapon: b.weapon, humanId: b.ownerId ?? -1 };
}

/** 火箭爆炸：范围伤害 + 距离衰减，只伤丧尸不伤人类 */
function explode(
  world: World,
  x: number,
  y: number,
  radius: number,
  source?: DamageSource,
  dmgMul = 1,
): void {
  world.effects.push({
    kind: "blast",
    x,
    y,
    angle: 0,
    radius,
    color: 0xffb066,
    age: 0,
    life: 0.42,
  });
  sound.play(SFX.EXPLOSION);
  const blastDamage = source?.weapon
    ? effectiveWeapon(source.weapon).blastDamage
    : effectiveWeapon(WEAPON_IDS.rocket).blastDamage;
  world.zombieGrid.query(x, y, radius, queryBuf);
  for (let i = 0; i < queryBuf.length; i++) {
    const z = queryBuf[i];
    if (!z.alive) continue;
    const d = Math.sqrt(dist2(x, y, z.x, z.y));
    const falloff = 1 - Math.min(1, d / radius) * 0.55;
    damageZombie(world, z, blastDamage * falloff * dmgMul, source);
  }
}

/** 子弹推进与命中结算 */
export function updateCombat(world: World, dt: number): void {
  for (let i = 0; i < world.bullets.length; i++) {
    const b = world.bullets[i];
    if (!b.alive) continue;

    b.px = b.x;
    b.py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;

    const dead =
      b.life <= 0 ||
      b.x < 0 ||
      b.y < 0 ||
      b.x > world.map.width ||
      b.y > world.map.height;

    // 出界 / 到寿命 / 撞墙：子弹用整段飞行线段做碰撞，防高速穿透；
    // 完好的门挡弹，窗户和门口擦边都能打出去
    if (dead || world.bulletBlocked(b.px, b.py, b.x, b.y)) {
      b.alive = false;
      if (b.kind === "rocket") {
        explode(world, b.x, b.y, b.blast, bulletSource(b), b.dmgMul ?? 1);
      }
      continue;
    }

    // 扫掠检测：查“飞行线段”中点附近的丧尸，做点到线段距离判定
    const segLen = Math.hypot(b.x - b.px, b.y - b.py);
    const midX = (b.x + b.px) * 0.5;
    const midY = (b.y + b.py) * 0.5;
    // 查询边距 = 线段半长 + 最大僵尸半径 + 擦边容差，胖子的大判定圈不会被漏查
    world.zombieGrid.query(midX, midY, segLen * 0.5 + MAX_ZOMBIE_RADIUS + 3, queryBuf);

    let hit: Zombie | null = null;
    for (let k = 0; k < queryBuf.length; k++) {
      const z = queryBuf[k];
      if (!z.alive) continue;
      const r = z.radius + 3;
      const d2 = pointSegDistSq(z.x, z.y, b.px, b.py, b.x, b.y);
      if (d2 <= r * r) {
        hit = z;
        break;
      }
    }

    if (hit) {
      if (b.kind === "rocket") {
        explode(world, hit.x, hit.y, b.blast, bulletSource(b), b.dmgMul ?? 1);
      } else {
        damageZombie(world, hit, b.damage, bulletSource(b));
      }
      b.alive = false;
    }
  }
}
