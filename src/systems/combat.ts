/**
 * 战斗系统 —— 开火、弹道、伤害结算。
 *
 * tryFire：人类每帧尝试开火（由 ai.ts 在瞄准时调用）
 * updateCombat：子弹飞行 + 命中判定 + 爆炸结算
 *
 * 命中判定用的是“线段扫掠”而不是点：高速子弹一帧能飞十几像素，
 * 只看当前点会穿透丧尸，所以拿“上一帧位置 -> 当前位置”线段去撞。
 */
import { effectiveWeapon, effectiveZombie } from "../data/settings/runtime";
import { WEAPON_IDS } from "../data/weapons";
import type { WeaponDef } from "../data/types";
import { dist2, mixColor, pointSegDistSq } from "../utils/math";
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

  if (def.kind === "flame") {
    if (h.burst > 0 || h.reloadTimer > 0 || h.ammo <= 0) return;
    h.ammo--;
    h.burst = def.burst;
    h.fire = 0; // 归零后下一帧立刻开始第一次伤害结算
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
      const a = angle + (Math.random() - 0.5) * def.spread * 2;
      spawnBullet(world, h, a, def.speed, def.damage * dmgMul, "bullet", 0, def.range / def.speed);
    }
  } else {
    // 机枪 / 火箭：单发弹道
    const a = angle + (Math.random() - 0.5) * def.spread * 2;
    const kind: BulletKind = def.kind === "rocket" ? "rocket" : "bullet";
    spawnBullet(world, h, a, def.speed, def.damage * dmgMul, kind, def.blast, def.range / def.speed);
  }

  if (h.ammo <= 0) h.reloadTimer = def.reload;
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

/** 对丧尸造成伤害，死亡时计数（source 仅供训练场统计，正式对局不传） */
export function damageZombie(world: World, z: Zombie, dmg: number, source?: DamageSource): void {
  if (!z.alive) return;
  // 实际生效伤害（不超过剩余血量），DPS 统计更准确
  const applied = Math.min(dmg, z.hp);
  z.hp -= dmg;
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
    world.zombieGrid.query(midX, midY, segLen * 0.5 + 10, queryBuf);

    let hit: Zombie | null = null;
    for (let k = 0; k < queryBuf.length; k++) {
      const z = queryBuf[k];
      if (!z.alive) continue;
      const r = effectiveZombie(z.kind).radius + 3;
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
