/**
 * AI 系统 —— 人类与丧尸的每帧行为更新。
 *
 * 人类（两种行为模式，由 world.mode 切换）：
 *   defend：有岗的人站岗点不动，只打看得见且在射程内的丧尸，不追击；
 *           僵尸逼近 60px 或岗位点被占时后撤，脱身归岗；
 *           没岗的人按 attack 逻辑自由交战
 *   attack：索敌后主动推进到射程内，站定开火；贴太近才后撤
 *   两种模式都会主动躲开脚下的腐蚀毒液；被咬后原地停下、仍可还击，
 *   倒计时结束倒戈成丧尸
 * 丧尸：按类型的追击模式（默认 breach）决策 ——
 *   breach：每只僵尸以自身位置为起点独立比较「不破门直追」与「破门窗」两条
 *           候选（区域内绕墙距离 + 剩余破拆耗时），已破开口只算可走地形；
 *           已有目标时新路线便宜 30% 以上才改道，没有可达路径就漫游，
 *           不贴墙顶门（direct 模式保留旧的全局直追）。
 *   贴近完好开口时按撕咬节奏啃，破口后涌入（穿窗会被窗檐减速）；
 *   贴近人类就咬，血量归零后进入异变倒计时。
 */
import { HUMAN_BODY_DIAMETER, HUMAN_DEF } from "../data/humans";
import { MAX_ZOMBIE_RADIUS, WANDER_TUNING, ZOMBIE_IDS, ZOMBIE_SLOW } from "../data/zombies";
import { effectiveWeapon, effectiveZombie, openingTuning, settings } from "../data/settings/runtime";
import { TERRAIN } from "../data/terrain";
import type { ZombieDef, ZombieLeapConfig, ZombiePursuitMode, ZombieScreamConfig, ZombieSpawnerConfig } from "../data/types";
import { openingNetWidth } from "./flowField";
import { beginReload, tryFire, updateFlame } from "./combat";
import type { RegionMap } from "./regions";
import { angDiff, clamp, dist2, pointRectDist, randRange, turnToward } from "../utils/math";
import type { Human, Opening, World, Zombie } from "../core/world";
import { sound, SFX } from "../audio/manager";
import { rollMatriarchChildKind } from "../data/survival/config";

// 复用的查询缓冲区：每帧反复用同一个数组，避免 GC 压力
const queryZ: Zombie[] = [];
const queryH: Human[] = [];
const queryZ2: Zombie[] = [];

/** 转化完成：人类死亡，原地变成一只普通丧尸，并留下紫色转化特效 */
function convertHuman(world: World, h: Human): void {
  h.alive = false;
  world.infected++;
  world.onHumanTurn?.(h);
  world.spawnZombie(h.x, h.y, ZOMBIE_IDS.normal);
  world.effects.push({
    kind: "blast",
    x: h.x,
    y: h.y,
    angle: 0,
    radius: 30,
    color: 0xa855f7,
    age: 0,
    life: 0.6,
  });
}

/**
 * 索敌：返回指定半径内“看得见”的最近丧尸。
 * 视线会被墙和完好的门挡住 —— 被挡住的丧尸即使很近也等于没发现；
 * 窗户是透明的，隔着玻璃照样能发现并射击（玻璃视线带一点侧向容差）。
 */
function nearestZombie(world: World, h: Human, radius: number): Zombie | null {
  world.zombieGrid.query(h.x, h.y, radius, queryZ);
  let best: Zombie | null = null;
  let bestD = Infinity;
  for (let i = 0; i < queryZ.length; i++) {
    const z = queryZ[i];
    if (!z.alive) continue;
    const d = dist2(h.x, h.y, z.x, z.y);
    // 比当前最优还远的直接跳过，连视线检查都省了
    if (d >= bestD) continue;
    if (world.sightBlocked(h.x, h.y, z.x, z.y, WINDOW_SIGHT_PAD)) continue;
    bestD = d;
    best = z;
  }
  return best;
}

/** 视线检查时玻璃的侧向容差（像素），贴着窗沿的僵尸也算看得见 */
const WINDOW_SIGHT_PAD = 12;

/** 按 id 找活人；压制 / 飞扑追踪需要稳定引用，数量很小，线性查找足够 */
function humanById(world: World, id: number | null): Human | null {
  if (id === null) return null;
  for (let i = 0; i < world.humans.length; i++) {
    const h = world.humans[i];
    if (h.id === id) return h.alive ? h : null;
  }
  return null;
}

/** 按 id 找活着的丧尸 */
function zombieById(world: World, id: number | null): Zombie | null {
  if (id === null) return null;
  for (let i = 0; i < world.zombies.length; i++) {
    const z = world.zombies[i];
    if (z.id === id) return z.alive ? z : null;
  }
  return null;
}

/** 指定半径内最近的“看得见”的人类（丧尸视角；墙与完好门窗挡视线） */
function nearestVisibleHuman(world: World, z: Zombie, radius: number): Human | null {
  world.humanGrid.query(z.x, z.y, radius, queryH);
  let best: Human | null = null;
  let bestD = Infinity;
  for (let i = 0; i < queryH.length; i++) {
    const h = queryH[i];
    if (!h.alive) continue;
    const d = dist2(z.x, z.y, h.x, h.y);
    if (d >= bestD) continue;
    if (world.sightBlocked(z.x, z.y, h.x, h.y, 0)) continue;
    bestD = d;
    best = h;
  }
  return best;
}

/**
 * 解除压制：同时清掉双方的状态，避免留下悬空引用。
 * knockback 为 true 时（主动挣脱）把飞扑者弹开并进入 3 秒攻击冷却，
 * 冷却期间它照常移动，但不会蓄力 / 飞扑。压制者被击杀时不弹开（尸体留在原地）。
 */
function releasePin(world: World, h: Human, pinner?: Zombie | null, knockback = false): void {
  h.pinTimer = 0;
  h.pinBy = null;
  if (pinner) {
    pinner.pinTargetId = null;
    if (knockback) {
      const cfg = effectiveZombie(pinner.kind).leap;
      const dx = pinner.x - h.x;
      const dy = pinner.y - h.y;
      const d = Math.hypot(dx, dy) || 1;
      const dist = cfg?.pinKnockback ?? 18;
      let nx = pinner.x + (dx / d) * dist;
      let ny = pinner.y + (dy / d) * dist;
      if (world.solidAt(nx, pinner.y, 0, pinner.bodyDiameter)) nx = pinner.x;
      if (world.solidAt(nx, ny, 0, pinner.bodyDiameter)) ny = pinner.y;
      pinner.x = Math.max(pinner.radius, Math.min(world.map.width - pinner.radius, nx));
      pinner.y = Math.max(pinner.radius, Math.min(world.map.height - pinner.radius, ny));
      pinner.leapCooldown = cfg?.missStun ?? 0;
      pinner.leapPhase = 0;
      pinner.leapTimer = 0;
      pinner.leapTargetId = null;
    }
  }
}

/**
 * 躲毒液：以脚下为圆心向外找一圈“可站立且不在毒液里”的落点。
 * 每个人的起始角度按 id 错开，避免同一位置的人全挤向同一个方向。
 * 周围全被毒液覆盖时，退化为朝最近毒团的外侧走。
 */
function findPoisonEscape(
  world: World,
  h: Human,
  bounds: { x0: number; y0: number; x1: number; y1: number },
): { x: number; y: number } | null {
  const start = h.id * 0.37;
  for (let ring = 1; ring <= 5; ring++) {
    const radius = ring * 24;
    for (let i = 0; i < 12; i++) {
      const ang = start + (i / 12) * Math.PI * 2;
      const x = h.x + Math.cos(ang) * radius;
      const y = h.y + Math.sin(ang) * radius;
      if (x < bounds.x0 || x > bounds.x1 || y < bounds.y0 || y > bounds.y1) continue;
      if (world.solidAt(x, y, 0, HUMAN_BODY_DIAMETER)) continue;
      if (world.poisonEffectAt(x, y)) continue;
      return { x, y };
    }
  }
  let bx = 0;
  let by = 0;
  let bd = Infinity;
  for (const p of world.poison) {
    const d = Math.hypot(p.x - h.x, p.y - h.y);
    if (d < bd) {
      bd = d;
      bx = p.x;
      by = p.y;
    }
  }
  if (!Number.isFinite(bd)) return null;
  const dx = h.x - bx;
  const dy = h.y - by;
  const d = Math.hypot(dx, dy) || 1;
  return { x: h.x + (dx / d) * 80, y: h.y + (dy / d) * 80 };
}

export function updateHumans(world: World, dt: number): void {
  // 守卫（guard）模式暂未实现，行为上回落到防守
  const postedMode = world.mode !== "attack";
  const s = settings();
  const bounds = world.map.humanBounds;
  // 生存模式的玩家不受人类区限制，只按身体半径夹在地图边界内
  const freeBounds = {
    x0: HUMAN_BODY_DIAMETER * 0.5,
    y0: HUMAN_BODY_DIAMETER * 0.5,
    x1: world.map.width - HUMAN_BODY_DIAMETER * 0.5,
    y1: world.map.height - HUMAN_BODY_DIAMETER * 0.5,
  };

  for (let i = 0; i < world.humans.length; i++) {
    const h = world.humans[i];
    if (!h.alive) continue;
    const moveBounds = h.manual ? freeBounds : bounds;
    // 血条存续时间：受伤后 3 秒淡出，与朝向 / 移动无关
    if (h.hurtTimer > 0) h.hurtTimer = Math.max(0, h.hurtTimer - dt);
    const def = effectiveWeapon(h.weapon);
    const def2 = h.weapon2 ? effectiveWeapon(h.weapon2) : null;
    const posted = postedMode && h.post >= 0 && h.post < world.posts.length;

    /*
     * 被飞扑者压制：不能开火、移速降低、持续掉血。
     * 压制者死亡 / 目标转化会立刻解除；到时间自动挣脱。
     * 同类压制同一时间只允许一只（由扑击瞬间的落点检查保证）。
     */
    let pinned = false;
    let pinMul = 1;
    if (h.pinTimer > 0) {
      const pinner = zombieById(world, h.pinBy);
      if (!pinner || pinner.pinTargetId !== h.id) {
        // 压制者被击杀 / 已被清场：直接解除，不弹开
        releasePin(world, h);
      } else {
        pinned = true;
        const leap = effectiveZombie(pinner.kind).leap;
        pinMul = leap?.pinMoveMul ?? 1;
        // 附身期间钉死在原地：清掉残余速度，避免解除瞬间惯性滑出去
        h.vx = 0;
        h.vy = 0;
        if (leap) {
          h.pinTimer -= dt;
          if (!h.invincible) {
            h.hp = Math.max(0, h.hp - leap.pinDps * dt);
            h.hurtTimer = Math.max(h.hurtTimer, 1);
            if (h.hp <= 0 && h.turning <= 0) h.turning = s.human.turnTime;
          }
          if (h.hp <= 0) {
            // 被压到血量归零：进入异变倒计时，压制随之解除（不弹开）
            releasePin(world, h, pinner);
            pinned = false;
            pinMul = 1;
          } else if (h.pinTimer <= 0) {
            // 计时挣脱：把飞扑者弹开并让它进入 3 秒攻击冷却
            releasePin(world, h, pinner, true);
            pinned = false;
            pinMul = 1;
          }
        }
      }
    }

    // 冷却与换弹计时。喷火有自己的一套"持续喷射"计时，交给 updateFlame 推进
    if (def.kind === "flame") {
      if (!pinned) updateFlame(world, h, dt);
    } else if (h.fire > 0) h.fire -= dt;
    if (h.reloadTimer > 0) {
      h.reloadTimer -= dt;
      if (h.reloadTimer <= 0) {
        h.reloadTimer = 0;
        h.ammo = def.magazine;
      }
    }
    // 副武器：冷却 / 换弹 / 喷火计时完全独立，与主武器同时推进
    if (def2) {
      if (def2.kind === "flame") {
        if (!pinned) updateFlame(world, h, dt, 1);
      } else if ((h.fire2 ?? 0) > 0) h.fire2 = Math.max(0, (h.fire2 ?? 0) - dt);
      if ((h.reload2 ?? 0) > 0) {
        h.reload2 = Math.max(0, (h.reload2 ?? 0) - dt);
        if (h.reload2 === 0) h.ammo2 = def2.magazine;
      }
    }

    // 被咬：原地停下，倒计时归零即倒戈（训练场开了无敌就不转化）
    if (h.turning > 0) {
      if (h.invincible) {
        h.turning = 0;
      } else {
        h.turning -= dt;
        if (h.turning <= 0) {
          sound.play(SFX.HUMAN_TURN); // 人类倒戈成丧尸
          convertHuman(world, h);
          continue;
        }
      }
    }

    /*
     * 索敌（带节流）：大范围查询比较贵，不必每帧都做。
     * 每 0.25~0.4 秒重新挑一次最近的可见目标；其余帧复用缓存。
     *  - 目标死亡 / 跑出视野 / 视线被挡住 → 立刻重找，不等节拍
     *  - 目标仍然有效 → 到点也要重挑。否则会一直锁着远处（视野 420 > 射程 275）
     *    的旧目标，近处已经进入射程的僵尸反而永远不开火
     */
    h.sight -= dt;
    // 训练场可以给单个单位覆盖视野；普通对局 sightOverride 为 undefined，读全局值。
    // 草丛内人类索敌缩短；丧尸索敌不受影响（这里只作用于人类）。
    const sightR =
      (h.sightOverride ?? s.human.sight) *
      (1 - (1 - TERRAIN.grass.humanSightMul) * world.grassEffectAt(h.x, h.y));
    let best = h.target;
    if (best !== null) {
      if (
        !best.alive ||
        dist2(h.x, h.y, best.x, best.y) > sightR * sightR ||
        world.sightBlocked(h.x, h.y, best.x, best.y, WINDOW_SIGHT_PAD)
      ) {
        best = null;
        h.target = null;
        h.sight = 0; // 失效目标立刻重找
      }
    }
    if (best === null || h.sight <= 0) {
      best = nearestZombie(world, h, Math.max(def.range, sightR));
      h.target = best;
      h.sight = 0.25 + Math.random() * 0.15;
    }

    let dx = 0;
    let dy = 0;
    let speedFactor = 1;
    let threatAng = 0;
    let threatDist = Infinity;

    if (best) {
      // 有目标：转向最近的丧尸；进入射程且大致对准后开火（两种模式共用）
      const ang = Math.atan2(best.y - h.y, best.x - h.x);
      h.facing = turnToward(h.facing, ang, 9 * dt);
      const dist = Math.sqrt(dist2(h.x, h.y, best.x, best.y));
      threatAng = ang;
      threatDist = dist;
      if (!pinned && dist <= def.range && Math.abs(angDiff(h.facing, ang)) < 0.3) {
        tryFire(world, h, h.facing);
      }
      // 副武器按自己的射程 / 冷却同时开火，目标与主武器一致
      if (!pinned && def2 && dist <= def2.range && Math.abs(angDiff(h.facing, ang)) < 0.3) {
        tryFire(world, h, h.facing, 1);
      }

      if (!posted) {
        // 进攻走位：够不着就推进到射程内，贴太近才后撤；进了射程就站定开火
        if (dist > def.range * 0.85) {
          dx = Math.cos(ang);
          dy = Math.sin(ang);
        } else if (dist < def.range * 0.4) {
          dx = -Math.cos(ang);
          dy = -Math.sin(ang);
        }
      }
      // 防守模式不动：走位交给下面的“归岗 / 拒止”逻辑
    } else if (h.manual) {
      // 玩家操控：没有目标时朝输入方向转身，不走闲逛逻辑
      const mx = h.moveX ?? 0;
      const my = h.moveY ?? 0;
      if (Math.hypot(mx, my) > 0.001) {
        h.facing = turnToward(h.facing, Math.atan2(my, mx), 6 * dt);
      }
    } else if (posted) {
      // 没目标：站定，朝自己看守的开口方向瞄准待命
      const p = world.posts[h.post];
      h.facing = turnToward(h.facing, Math.atan2(p.oy - h.y, p.ox - h.x), 5 * dt);
    } else {
      // 没目标：在房间里闲逛，隔几秒换一个目标点（目标点必须是可站立的空地）
      h.wTimer -= dt;
      if (h.wTimer <= 0 || dist2(h.x, h.y, h.wx, h.wy) < 900) {
        const spot = world.findFreeSpot(
          randRange(bounds.x0, bounds.x1),
          randRange(bounds.y0, bounds.y1),
          HUMAN_BODY_DIAMETER,
          bounds,
        );
        if (spot) {
          h.wx = spot.x;
          h.wy = spot.y;
        }
        h.wTimer = randRange(2.5, 5.5);
      }
      const wdx = h.wx - h.x;
      const wdy = h.wy - h.y;
      const wlen = Math.hypot(wdx, wdy) || 1;
      dx = wdx / wlen;
      dy = wdy / wlen;
      speedFactor = 0.55;
      h.facing = turnToward(h.facing, Math.atan2(dy, dx), 4 * dt);
    }

    if (posted) {
      // 岗位点被僵尸占住：先离开站点，否则站着被啃穿
      const p = world.posts[h.post];
      world.zombieGrid.query(p.x, p.y, 48, queryZ);
      let awayX = 0;
      let awayY = 0;
      let postTaken = false;
      for (let k = 0; k < queryZ.length; k++) {
        const o = queryZ[k];
        if (!o.alive) continue;
        postTaken = true;
        const ox = h.x - o.x;
        const oy = h.y - o.y;
        const od = Math.hypot(ox, oy) || 1;
        awayX += ox / od;
        awayY += oy / od;
      }
      // 贴身拒止：有僵尸逼近到 60px 内就全速后撤拉开距离（仍不追击），
      // 站着不动只会被当场啃掉，防线瞬间雪崩；
      // 人类 54 的速度比普通丧尸 50 略快，能保持且战且退
      if (threatDist < 60 || postTaken) {
        if (postTaken) {
          const len = Math.hypot(awayX, awayY) || 1;
          dx = awayX / len;
          dy = awayY / len;
        } else {
          dx = -Math.cos(threatAng);
          dy = -Math.sin(threatAng);
        }
        speedFactor = 1;
      } else {
        // 否则归岗：离岗哨点超过 6px 就走回去，到位站桩
        const dpx = p.x - h.x;
        const dpy = p.y - h.y;
        const dp = Math.hypot(dpx, dpy);
        if (dp > 6) {
          dx = dpx / dp;
          dy = dpy / dp;
          speedFactor = 0.8;
        } else {
          dx = 0;
          dy = 0;
        }
      }
    }

    // 玩家操控：覆盖掉 AI 的走位 / 归岗，直接按输入移动
    if (h.manual) {
      dx = h.moveX ?? 0;
      dy = h.moveY ?? 0;
      speedFactor = 1;
    }

    /*
     * 躲毒液：脚下有腐蚀毒液时优先离开（防守 / 进攻都生效）。
     * 只在真正站在毒液里才触发 —— 躲开立刻恢复原行为（归岗 / 进攻 / 站桩射击），
     * 不会变成“到处乱跑不射击”。
     */
    if (!h.manual && !pinned && h.turning <= 0 && world.poisonEffectAt(h.x, h.y)) {
      h.safeTimer -= dt;
      const stale =
        h.safeTimer <= 0 ||
        dist2(h.x, h.y, h.safeX, h.safeY) < 36 ||
        world.poisonEffectAt(h.safeX, h.safeY) !== null;
      if (stale) {
        const spot = findPoisonEscape(world, h, moveBounds);
        if (spot) {
          h.safeX = spot.x;
          h.safeY = spot.y;
        }
        h.safeTimer = 0.4;
      }
      const sdx = h.safeX - h.x;
      const sdy = h.safeY - h.y;
      const sd = Math.hypot(sdx, sdy);
      if (sd > 2) {
        dx = sdx / sd;
        dy = sdy / sd;
        speedFactor = 1;
      }
    }

    // 被咬后原地不动
    if (h.turning > 0) {
      dx = 0;
      dy = 0;
    }

    // 人与人之间保持间距，避免叠在一起
    world.humanGrid.query(h.x, h.y, 22, queryH);
    for (let k = 0; k < queryH.length; k++) {
      const o = queryH[k];
      if (o === h) continue;
      const ox = h.x - o.x;
      const oy = h.y - o.y;
      const d = Math.hypot(ox, oy);
      if (d > 0.001 && d < 20) {
        const push = (1 - d / 20) * 1.3;
        dx += (ox / d) * push;
        dy += (oy / d) * push;
      }
    }

    // 期望方向 -> 平滑加速到目标速度（训练场可覆盖单个人类的移速；草丛 / 毒液 / 压制减速）
    const poisonMul = world.poisonEffectAt(h.x, h.y)?.speedMul ?? 1;
    const moveSpeed =
      (h.speedOverride ?? s.human.speed) *
      (1 - (1 - TERRAIN.grass.speedMul) * world.grassEffectAt(h.x, h.y)) *
      poisonMul *
      pinMul;
    const len = Math.hypot(dx, dy);
    if (len > 0.001 && h.turning <= 0) {
      dx /= len;
      dy /= len;
      const vx = dx * moveSpeed * speedFactor;
      const vy = dy * moveSpeed * speedFactor;
      const k = Math.min(1, dt * 8);
      h.vx += (vx - h.vx) * k;
      h.vy += (vy - h.vy) * k;
    } else {
      h.vx *= 0.82;
      h.vy *= 0.82;
    }

    /*
     * 位置推进：被分离力推挤、被目标点吸引，最终都要过同一套阻挡判定。
     * 逐轴判定，撞墙时只停被挡的那个轴，保留沿墙滑动。
     * 已经被旧存档 / 极端情况放进墙里时不做阻挡，让人能自己走出来（避免永久卡死）。
     */
    const stuck = world.solidAt(h.x, h.y, 0, 0);
    let nx = clamp(h.x + h.vx * dt, moveBounds.x0, moveBounds.x1);
    let ny = clamp(h.y + h.vy * dt, moveBounds.y0, moveBounds.y1);
    if (!stuck) {
      if (world.solidAt(nx, h.y, 0, HUMAN_BODY_DIAMETER)) {
        nx = h.x;
        h.vx = 0;
      }
      if (world.solidAt(nx, ny, 0, HUMAN_BODY_DIAMETER)) {
        ny = h.y;
        h.vy = 0;
      }
    }
    h.x = nx;
    h.y = ny;

    if (h.ammo <= 0 && h.reloadTimer <= 0) beginReload(h, 0, def);
  }
}

/** 僵尸类型的追击模式；未声明时使用 breach（连通区域 + 破口追击） */
function pursuitModeOf(z: Zombie): ZombiePursuitMode {
  return effectiveZombie(z.kind).pursuit ?? "breach";
}

/** 全场最近活人（含正在转化中的）；只有几十个人，直接遍历比查空间哈希更快 */
function nearestHuman(world: World, z: Zombie): Human | null {
  let best: Human | null = null;
  let bestD = Infinity;
  const humans = world.humans;
  for (let i = 0; i < humans.length; i++) {
    const h = humans[i];
    if (!h.alive) continue;
    const d = (h.x - z.x) * (h.x - z.x) + (h.y - z.y) * (h.y - z.y);
    if (d < bestD) {
      bestD = d;
      best = h;
    }
  }
  return best;
}

/** 位置所在连通域；压在墙沿时取附近最近区域 */
function regionOf(region: RegionMap, x: number, y: number): number {
  const r = region.regionAt(x, y);
  return r >= 0 ? r : region.regionNear(x, y);
}

/** direct 模式：旧行为，直接朝全场最近人类走；没人类就扑向最近开口 */
function retargetDirect(world: World, z: Zombie): void {
  const best = nearestHuman(world, z);
  if (best) {
    z.tx = best.x;
    z.ty = best.y;
    return;
  }
  // 没有人类了：扑向最近的开口
  const centers = world.map.openingCenters;
  let bx = centers[0].x;
  let by = centers[0].y;
  let bd = Infinity;
  for (const c of centers) {
    const d = (c.x - z.x) * (c.x - z.x) + (c.y - z.y) * (c.y - z.y);
    if (d < bd) {
      bd = d;
      bx = c.x;
      by = c.y;
    }
  }
  z.tx = bx;
  z.ty = by;
}

// ------------------------------------------------------------
// breach 模式：连通区域 + 可破坏开口
// ------------------------------------------------------------

/** Dijkstra 复用的临时数组，按调用串行复用，避免每只僵尸都分配一组 */
const navScratch = {
  n: 0,
  dist: new Float64Array(0),
  visited: new Uint8Array(0),
  prevRegion: new Int32Array(0),
  prevEdge: new Int32Array(0),
};

function ensureNavScratch(n: number): void {
  if (navScratch.n >= n) return;
  navScratch.n = n;
  navScratch.dist = new Float64Array(n);
  navScratch.visited = new Uint8Array(n);
  navScratch.prevRegion = new Int32Array(n);
  navScratch.prevEdge = new Int32Array(n);
}

/** 无路可走：不贴墙顶门，退化为原有漫游（慢晃 + 偶尔停） */
function setStranded(z: Zombie): void {
  z.goalOpening = null;
  z.goalOnward = 0;
  if (z.stranded) return;
  z.stranded = true;
  z.wanderRest = false;
  z.wanderAngle = randRange(-Math.PI, Math.PI);
  z.wanderTimer = randRange(WANDER_TUNING.moveMin, WANDER_TUNING.moveMax);
}

/**
 * 换目标阈值：新路线代价低于当前目标的 70%（省 30% 以上）才改主意。
 * 正在啃的门本身会随血量下降越来越便宜，所以「手边那扇」通常留得住。
 */
const GOAL_SWITCH_RATIO = 0.7;

/**
 * 破开一扇开口折算成多远（像素）：剩余血量 / 每口伤害 × 啃咬间隔 × 自己的移速。
 * 用剩余 hp 而不是 maxHp —— 已经啃过半的门对这只僵尸更便宜。
 */
function breakCostPx(z: Zombie, op: Opening, biteDamage: number, biteCycle: number): number {
  const bites = Math.ceil(Math.max(1, op.hp) / biteDamage);
  return bites * biteCycle * z.speed;
}

/**
 * breach 索敌 —— 每只僵尸以自己的位置为起点独立算最优路线。
 *
 * 候选一：不破任何东西直接过去（同连通域内沿寻路距离，不是直线穿墙）；
 * 候选二：破门窗。以自己所在连通域为起点在区域邻接图上跑 Dijkstra，
 *         边权 = 区域内走到门口的距离 + 破拆耗时折算的距离 + 后续接近；
 *         已破开的开口在连通图里只是可走地形，会自然成为候选路径之一。
 *
 * 两个候选里取便宜的那个；但若当前已有目标（或正在直追），只有新路线
 * 便宜 30% 以上才切换，避免一扇门刚破就全场改道、蜂拥同一入口。
 *
 * 只在索敌节拍（0.3~0.6 秒）调用，每帧不跑图；区域图本身按体型缓存，
 * 只在开口破碎时失效重建。
 */
function pursueBreach(world: World, z: Zombie, region: RegionMap): void {
  const myRegion = regionOf(region, z.x, z.y);
  const humans = world.humans;
  const tune = openingTuning(world.map);
  const def = effectiveZombie(z.kind);
  const biteCycle = (z.biteCycle ?? def.bite) * tune.buildBiteSlow;
  const biteDamage = Math.max(1, tune.buildBiteDamage);

  // 候选一：同连通域内直接追人。humanFlowFor 的障碍是墙体与过不去的开口，
  // 所以它给出的距离天然被限制在“不破门能到”的范围内，不会穿墙抄近路。
  const directFlow = world.humanFlowFor(z.bodyDiameter);
  const directCost = directFlow ? directFlow.distanceAt(z.x, z.y) : Infinity;
  let directTarget: Human | null = null;
  if (Number.isFinite(directCost)) {
    let bestD = Infinity;
    for (let i = 0; i < humans.length; i++) {
      const h = humans[i];
      if (!h.alive) continue;
      if (regionOf(region, h.x, h.y) !== myRegion) continue;
      const d = dist2(z.x, z.y, h.x, h.y);
      if (d < bestD) {
        bestD = d;
        directTarget = h;
      }
    }
  }

  // 候选二：破门路线
  let doorCost = Infinity;
  let doorGoal: string | null = null;
  let doorOnward = 0;
  let doorX = 0;
  let doorY = 0;

  if (myRegion >= 0 && region.count > 0) {
    ensureNavScratch(region.count);
    const { dist, visited, prevRegion, prevEdge } = navScratch;
    dist.fill(Infinity, 0, region.count);
    visited.fill(0, 0, region.count);
    prevRegion.fill(-1, 0, region.count);
    prevEdge.fill(-1, 0, region.count);
    dist[myRegion] = 0;

    // 区域数很小（通常个位数），O(n²) 选点足够，省掉优先队列
    for (let iter = 0; iter < region.count; iter++) {
      let u = -1;
      let best = Infinity;
      for (let i = 0; i < region.count; i++) {
        if (!visited[i] && dist[i] < best) {
          best = dist[i];
          u = i;
        }
      }
      if (u < 0) break;
      visited[u] = 1;
      // 进入 u 时经过哪扇门：区域内距离以那扇门为起点量，避免直线穿墙
      const entryEdge = prevEdge[u] >= 0 ? region.edges[prevEdge[u]] : null;
      const list = region.edgesOf(u);
      for (let k = 0; k < list.length; k++) {
        const e = region.edges[list[k]];
        const op = world.opening(e.openingId);
        if (!op || op.broken) continue;
        if (openingNetWidth(op.rect) < z.bodyDiameter) continue;
        const other = e.from === u ? e.to : e.from;
        const travel = entryEdge
          ? region.distanceToOpening(u, entryEdge.openingId, e.openingId)
          : region.distanceFrom(u, e.openingId, z.x, z.y);
        if (!Number.isFinite(travel)) continue;
        const nd = dist[u] + travel + breakCostPx(z, op, biteDamage, biteCycle);
        if (nd < dist[other]) {
          dist[other] = nd;
          prevRegion[other] = u;
          prevEdge[other] = list[k];
        }
      }
    }

    // 在所有“有活人的区域”里选最便宜的一条，并回溯出要走的第一扇门
    for (let i = 0; i < humans.length; i++) {
      const h = humans[i];
      if (!h.alive) continue;
      const hr = regionOf(region, h.x, h.y);
      // 同连通域的人由候选一负责比较，这里只算需要破门的
      if (hr < 0 || hr === myRegion) continue;
      if (!Number.isFinite(dist[hr])) continue;
      const entryIdx = prevEdge[hr];
      if (entryIdx < 0) continue;
      const tail = region.distanceFrom(hr, region.edges[entryIdx].openingId, h.x, h.y);
      if (!Number.isFinite(tail)) continue;
      const cost = dist[hr] + tail;
      if (cost >= doorCost) continue;

      let r = hr;
      while (prevRegion[r] !== myRegion) {
        const p = prevRegion[r];
        if (p < 0) break;
        r = p;
      }
      const firstIdx = r >= 0 ? prevEdge[r] : -1;
      if (firstIdx < 0) continue;
      const first = region.edges[firstIdx];
      const firstOp = world.opening(first.openingId);
      if (!firstOp) continue;

      const travel0 = region.distanceFrom(myRegion, first.openingId, z.x, z.y);
      const break0 = breakCostPx(z, firstOp, biteDamage, biteCycle);
      doorCost = cost;
      doorGoal = first.openingId;
      doorOnward = Math.max(0, cost - (Number.isFinite(travel0) ? travel0 : 0) - break0);
      doorX = first.x;
      doorY = first.y;
    }
  }

  // 当前目标的代价（按此刻的剩余距离 + 剩余破拆时间重算）
  let currentGoal = z.goalOpening;
  let currentCost = Infinity;
  if (currentGoal !== null) {
    const op = world.opening(currentGoal);
    if (!op || op.broken || openingNetWidth(op.rect) < z.bodyDiameter) {
      // 目标已经不存在（被别人啃破 / 自己钻不过）：立刻重选
      currentGoal = null;
      z.goalOpening = null;
      z.goalOnward = 0;
    } else {
      const toGoal =
        myRegion >= 0 ? region.distanceFrom(myRegion, currentGoal, z.x, z.y) : Infinity;
      currentCost = Number.isFinite(toGoal)
        ? toGoal + breakCostPx(z, op, biteDamage, biteCycle) + Math.max(0, z.goalOnward)
        : Infinity;
    }
  } else {
    // 正在直追：不破门的距离就是当前代价
    currentCost = directCost;
  }

  const directBetter = directCost <= doorCost;
  const newCost = directBetter ? directCost : doorCost;

  // 当前目标失效，或新路线明显更便宜（省 30% 以上）才切换
  if (!Number.isFinite(currentCost) || newCost < currentCost * GOAL_SWITCH_RATIO) {
    if (directBetter && Number.isFinite(directCost)) {
      z.goalOpening = null;
      z.goalOnward = 0;
      z.stranded = false;
      if (directTarget) {
        z.tx = directTarget.x;
        z.ty = directTarget.y;
      }
      return;
    }
    if (doorGoal !== null && Number.isFinite(doorCost)) {
      z.goalOpening = doorGoal;
      z.goalOnward = doorOnward;
      z.stranded = false;
      z.tx = doorX;
      z.ty = doorY;
      return;
    }
  }

  // 维持当前选择：只刷新兜底坐标，让“保持”也有新鲜的目标信息
  if (z.goalOpening !== null) {
    z.stranded = false;
    if (doorGoal === z.goalOpening) z.goalOnward = doorOnward;
    const op = world.opening(z.goalOpening);
    if (op) {
      z.tx = op.rect.x + op.rect.w * 0.5;
      z.ty = op.rect.y + op.rect.h * 0.5;
    }
    return;
  }
  if (Number.isFinite(directCost)) {
    z.stranded = false;
    if (directTarget) {
      z.tx = directTarget.x;
      z.ty = directTarget.y;
    }
    return;
  }
  setStranded(z);
}

/** 索敌分发：按僵尸类型的追击模式决定目标；顺带播一次全局限频的咆哮 */
function retargetZombie(world: World, z: Zombie): void {
  // 全局限频 3 秒一次咆哮 —— 不用每只独立响，全局偶尔一声足够，
  // 但僵尸密集时刚好每隔几秒就响一声，自然营造"尸群包围"的氛围。
  // 每种僵尸用自己的叫声，与普通/狂奔区分（缺失音频时按现有逻辑静默降级）。
  if (z.kind === ZOMBIE_IDS.fat) sound.play(SFX.ZOMBIE_GROWL_FAT);
  else if (z.kind === ZOMBIE_IDS.leaper) sound.play(SFX.ZOMBIE_GROWL_LEAPER);
  else if (z.kind === ZOMBIE_IDS.corroder) sound.play(SFX.ZOMBIE_GROWL_CORRODER);
  else if (z.kind === ZOMBIE_IDS.matriarch) sound.play(SFX.ZOMBIE_GROWL_MATRIARCH);
  else sound.play(SFX.ZOMBIE_GROWL);
  if (pursuitModeOf(z) === "breach") pursueBreach(world, z, world.regionMap(z.bodyDiameter));
  else retargetDirect(world, z);
}

/** 切到漫游：随机选一个方向，开始一段移动 */
function beginWander(z: Zombie): void {
  z.mode = "wander";
  z.stranded = false;
  z.goalOpening = null;
  z.wanderRest = false;
  z.wanderAngle = randRange(-Math.PI, Math.PI);
  z.wanderTimer = randRange(WANDER_TUNING.moveMin, WANDER_TUNING.moveMax);
}

/** 推进漫游节拍：移动 1.5~3 秒 -> 停顿 0.4~1.2 秒 -> 换方向继续 */
function tickWander(z: Zombie, dt: number): void {
  z.wanderTimer -= dt;
  if (z.wanderTimer > 0) return;
  if (z.wanderRest) {
    z.wanderRest = false;
    z.wanderAngle = randRange(-Math.PI, Math.PI);
    z.wanderTimer = randRange(WANDER_TUNING.moveMin, WANDER_TUNING.moveMax);
  } else {
    z.wanderRest = true;
    z.wanderTimer = randRange(WANDER_TUNING.restMin, WANDER_TUNING.restMax);
  }
}

/** 漫游撞墙：按被挡住的轴反射方向；两轴同时被挡就换随机方向，避免卡死 */
function bounceWander(z: Zombie, blockedX: boolean, blockedY: boolean): void {
  if (blockedX && blockedY) {
    z.wanderAngle = randRange(-Math.PI, Math.PI);
    return;
  }
  let vx = Math.cos(z.wanderAngle);
  let vy = Math.sin(z.wanderAngle);
  if (blockedX) vx = -vx;
  if (blockedY) vy = -vy;
  z.wanderAngle = Math.atan2(vy, vx) + randRange(-0.2, 0.2);
}

/**
 * 飞扑者状态机：0 待机 / 1 蓄力 / 2 飞扑 / 3 落地硬直。
 * 返回 true 表示本帧由飞扑接管，调用方跳过常规移动与撕咬。
 * 蓄力受击的延长写在 combat.ts 的 applyHitSlow 里（不打断，只加时）。
 */
function tickLeaper(world: World, z: Zombie, dt: number, cfg: ZombieLeapConfig): boolean {
  // 1) 蓄力：原地不动；目标丢失 / 已转化就取消
  if (z.leapPhase === 1) {
    z.leapTimer -= dt;
    const target = humanById(world, z.leapTargetId);
    if (!target || target.turning > 0) {
      z.leapPhase = 0;
      z.leapTimer = 0;
      z.leapTargetId = null;
      return true;
    }
    if (z.leapTimer > 0) return true;

    // 蓄力完成：朝目标当前位置直线起跳，飞行时间按起跳距离换算
    const dx = target.x - z.x;
    const dy = target.y - z.y;
    const d = Math.hypot(dx, dy);
    z.leapDX = d > 0.001 ? dx / d : 1;
    z.leapDY = d > 0.001 ? dy / d : 0;
    const leapSpeed = Math.max(1, z.speed * cfg.leapSpeedMul);
    z.leapTimer = clamp(d / leapSpeed, cfg.leapMinTime, cfg.leapMaxTime);
    z.leapPhase = 2;
    sound.play(SFX.ZOMBIE_LEAP);
    return true;
  }

  // 2) 飞扑：直线冲刺，命中就压制，撞墙 / 超时算扑空
  if (z.leapPhase === 2) {
    z.leapTimer -= dt;
    const speed = Math.max(1, z.speed * cfg.leapSpeedMul);
    let nx = z.x + z.leapDX * speed * dt;
    let ny = z.y + z.leapDY * speed * dt;
    let blocked = false;
    if (world.solidAt(nx, z.y, 0, z.bodyDiameter)) {
      nx = z.x;
      blocked = true;
    }
    if (world.solidAt(nx, ny, 0, z.bodyDiameter)) {
      ny = z.y;
      blocked = true;
    }
    const cx = clamp(nx, z.radius, world.map.width - z.radius);
    const cy = clamp(ny, z.radius, world.map.height - z.radius);
    if (cx !== nx || cy !== ny) blocked = true;
    z.x = cx;
    z.y = cy;

    const target = humanById(world, z.leapTargetId);
    const reach = z.radius + HUMAN_DEF.radius + 2;
    if (target && target.turning <= 0 && dist2(z.x, z.y, target.x, target.y) <= reach * reach) {
      // 同一人类同时只能被 1 只压制；目标已被压住就算这次扑空
      if (target.pinTimer <= 0 && target.pinBy === null) {
        target.pinTimer = cfg.pinDuration;
        target.pinBy = z.id;
        target.hurtTimer = Math.max(target.hurtTimer, 3);
        target.vx = 0;
        target.vy = 0;
        z.pinTargetId = target.id;
        z.leapPhase = 0;
        z.leapTimer = 0;
        z.leapTargetId = null;
        return true;
      }
      blocked = true;
    }
    if (blocked || z.leapTimer <= 0) {
      // 扑空：进入攻击冷却（3 秒），期间照常移动但不再蓄力
      z.leapPhase = 0;
      z.leapTimer = 0;
      z.leapCooldown = cfg.missStun;
      z.leapTargetId = null;
    }
    return true;
  }

  // 0) 待机：冷却中只移动不攻击；索敌范围内出现“看得见且未被压制”的人类就开始蓄力
  if (z.mode !== "hunt" || z.stranded || z.leapCooldown > 0) return false;
  const target = nearestVisibleHuman(world, z, cfg.triggerRadius);
  if (!target || target.turning > 0 || target.pinTimer > 0) return false;
  z.leapPhase = 1;
  z.leapTimer = cfg.chargeTime;
  z.leapTargetId = target.id;
  return true;
}

/** 最近人类的距离与单位方向（不要求可见）：特殊僵尸的距离维持只看远近 */
function nearestHumanRange(
  world: World,
  z: Zombie,
): { d: number; ux: number; uy: number } | null {
  world.humanGrid.query(z.x, z.y, world.map.width + world.map.height, queryH);
  let best = Infinity;
  let bx = 0;
  let by = 0;
  let found = false;
  for (let i = 0; i < queryH.length; i++) {
    const h = queryH[i];
    if (!h.alive || h.turning > 0) continue;
    const dx = h.x - z.x;
    const dy = h.y - z.y;
    const d = dx * dx + dy * dy;
    if (d >= best) continue;
    best = d;
    bx = dx;
    by = dy;
    found = true;
  }
  if (!found) return null;
  const d = Math.sqrt(best) || 1;
  return { d, ux: bx / d, uy: by / d };
}

/** 最近的同类僵尸（不含自己）：尖叫者用它判断“已经靠近尸群” */
function nearestMate(
  world: World,
  z: Zombie,
  radius: number,
): { d: number; ux: number; uy: number } | null {
  world.zombieGrid.query(z.x, z.y, radius, queryZ2);
  let best = Infinity;
  let bx = 0;
  let by = 0;
  let found = false;
  for (let i = 0; i < queryZ2.length; i++) {
    const o = queryZ2[i];
    if (o === z || !o.alive) continue;
    const dx = o.x - z.x;
    const dy = o.y - z.y;
    const d = dx * dx + dy * dy;
    if (d >= best) continue;
    best = d;
    bx = dx;
    by = dy;
    found = true;
  }
  if (!found) return null;
  const d = Math.sqrt(best) || 1;
  return { d, ux: bx / d, uy: by / d };
}

/**
 * 特殊僵尸的距离维持（放置模式与求生模式都生效）：
 *  - 腐蚀者：>200 靠近；160–200 站定吐毒；<120 后退；站定时不额外游走
 *  - 尖叫者：先退到距最近人类 250 外，再到距尸群 200 内尖叫；冲突时先跑
 *  - 母体：始终保持与最近人类 350 以上，边退边产卵；退到地图边缘就地停下
 * 返回本帧期望方向；null 表示不接管（沿用常规追击）。
 */
function rangedBehaviorDir(
  world: World,
  z: Zombie,
  zdef: ZombieDef,
): { x: number; y: number } | null {
  if (z.mode !== "hunt") return null;
  const near = nearestHumanRange(world, z);
  if (!near) return null;

  if (zdef.spit) {
    if (near.d < 120) return { x: -near.ux, y: -near.uy };
    if (near.d <= zdef.spit.range) return { x: 0, y: 0 };
    return null;
  }

  if (zdef.scream) {
    if (near.d < 250) return { x: -near.ux, y: -near.uy };
    const mate = nearestMate(world, z, 400);
    if (mate && mate.d > 200) return { x: mate.ux, y: mate.uy };
    // 已在尸群 200 内（或附近没有同伴）：原地尖叫，不再朝人类推进
    return { x: 0, y: 0 };
  }

  if (zdef.spawner && near.d < 350) {
    // 先往远离人类的方向让出一步；如果那一步撞墙 / 出界，就地停下继续产卵
    const step = 24;
    const bx = z.x - near.ux * step;
    const by = z.y - near.uy * step;
    const outX = bx < z.radius || bx > world.map.width - z.radius;
    const outY = by < z.radius || by > world.map.height - z.radius;
    const hitX = outX || world.solidAt(bx, z.y, 0, z.bodyDiameter);
    const hitY = outY || world.solidAt(z.x, by, 0, z.bodyDiameter);
    if (hitX && hitY) return { x: 0, y: 0 };
    return { x: -near.ux, y: -near.uy };
  }

  return null;
}

/**
 * 母体产卵：每 interval 秒产出 count 只子体，由它产出的子体同屏不超过 cap。
 * 子体种类从求生池的非 BOSS 僵尸里抽取；环形落点找不到空地就少产一只，等下一轮。
 */
function tickMatriarch(world: World, z: Zombie, dt: number, cfg: ZombieSpawnerConfig): void {
  z.spawnerTimer -= dt;
  if (z.spawnerTimer > 0) return;
  // 固定节拍：即使这一轮没产满，也按 interval 继续下一次，不把积压叠成一次
  z.spawnerTimer = cfg.interval;

  let alive = 0;
  for (let i = 0; i < world.zombies.length; i++) {
    const o = world.zombies[i];
    if (o.alive && o.spawnedBy === z.id) alive++;
  }
  const slots = Math.min(cfg.count, Math.max(0, cfg.cap - alive));
  if (slots <= 0) return;

  let spawned = 0;
  for (let i = 0; i < slots; i++) {
    if (world.spawnChild(z, rollMatriarchChildKind(), cfg.childXpMul)) spawned++;
  }
  if (spawned > 0) {
    sound.play(SFX.ZOMBIE_SPAWN);
    world.effects.push({
      kind: "ring",
      x: z.x,
      y: z.y,
      angle: 0,
      radius: z.radius + 10,
      color: 0xfca5a5,
      age: 0,
      life: 0.4,
    });
  }
}

/**
 * 尖叫者：每 interval 秒强化半径内的其他僵尸（移速 / 攻击力 / 受伤减免）。
 * 不强化 BOSS，也不强化自己；多次尖叫只刷新持续时间并取更强倍率。
 */
function tickScreamer(world: World, z: Zombie, dt: number, cfg: ZombieScreamConfig): void {
  z.screamTimer -= dt;
  if (z.screamTimer > 0) return;
  z.screamTimer = cfg.interval;

  const r2 = cfg.radius * cfg.radius;
  for (let i = 0; i < world.zombies.length; i++) {
    const o = world.zombies[i];
    if (o === z || !o.alive) continue;
    if (dist2(z.x, z.y, o.x, o.y) > r2) continue;
    if (effectiveZombie(o.kind).boss) continue;
    o.buffTimer = Math.max(o.buffTimer, cfg.duration);
    o.buffSpeedMul = Math.max(o.buffSpeedMul, cfg.speedMul);
    o.buffDamageMul = Math.max(o.buffDamageMul, cfg.damageMul);
    o.buffTakenMul = Math.min(o.buffTakenMul, cfg.damageTakenMul);
  }
  sound.play(SFX.ZOMBIE_SCREAM);
  world.effects.push({
    kind: "ring",
    x: z.x,
    y: z.y,
    angle: 0,
    radius: cfg.radius,
    color: 0xf472b6,
    age: 0,
    life: 0.5,
  });
}

/** 强化倒计时：到点清空倍率，避免效果永久残留 */
function tickZombieBuff(z: Zombie, dt: number): void {
  if (z.buffTimer <= 0) return;
  z.buffTimer = Math.max(0, z.buffTimer - dt);
  if (z.buffTimer <= 0) {
    z.buffSpeedMul = 1;
    z.buffDamageMul = 1;
    z.buffTakenMul = 1;
  }
}

export function updateZombies(world: World, dt: number): void {
  const map = world.map;
  const room = map.room;
  const s = settings();
  // 每帧只统计一次存活人类（含转化倒计时中的），所有丧尸共用一个标记
  const huntMode = world.refreshLivingHumans() > 0;
  for (let i = 0; i < world.zombies.length; i++) {
    const z = world.zombies[i];
    if (!z.alive) continue;
    if (z.flash > 0) z.flash = Math.max(0, z.flash - dt);
    // 受击减速：0.6 秒内线性恢复到满速；到点后清空，等下一次受击重新计算
    if (z.slowTimer > 0) {
      z.slowTimer = Math.max(0, z.slowTimer - dt);
      if (z.slowTimer <= 0) z.slowMul = 1;
    }
    if (z.bite > 0) z.bite -= dt;
    const zdef = effectiveZombie(z.kind);
    // 尖叫强化倒计时：先推进旧效果，再让尖叫者刷新（新效果从完整时长开始）
    tickZombieBuff(z, dt);
    if (zdef.spawner) tickMatriarch(world, z, dt, zdef.spawner);
    if (zdef.scream) tickScreamer(world, z, dt, zdef.scream);
    // 腐蚀者吐毒冷却（按定义文件的 cooldown 推进）
    if (zdef.spit && z.spit > 0) z.spit = Math.max(0, z.spit - dt);
    // 飞扑者扑空 / 挣脱后的攻击冷却：只影响“能不能再扑”，不限制移动
    if (z.leapCooldown > 0) z.leapCooldown = Math.max(0, z.leapCooldown - dt);

    /*
     * 行为状态切换：场上有活人就索敌进攻，零人类才漫游。
     * 人类重新出现时把索敌计时清零，下一帧立刻恢复进攻，不留延迟。
     */
    if (huntMode) {
      if (z.mode !== "hunt") {
        z.mode = "hunt";
        z.retarget = 0;
        z.stranded = false;
        z.goalOpening = null;
      }
    } else if (z.mode !== "wander") {
      beginWander(z);
    }

    // 正在压制人类：吸附在目标身上（跟随其坐标），本身不移动也不啃咬；
    // 目标挣脱 / 死亡 / 压制者被击杀后自动解除
    if (z.pinTargetId !== null) {
      const target = humanById(world, z.pinTargetId);
      if (target && target.pinBy === z.id && target.pinTimer > 0 && target.turning <= 0) {
        // 沿扑击方向留一点偏移，避免和人类精灵完全重叠
        z.x = target.x - z.leapDX * 6;
        z.y = target.y - z.leapDY * 6;
        continue;
      }
      z.pinTargetId = null;
    }

    if (z.mode === "hunt") {
      // 每隔 0.3~0.6 秒重新索敌，而不是每帧都找（几千只一起找会卡）
      z.retarget -= dt;
      if (z.retarget <= 0) {
        retargetZombie(world, z);
        z.retarget = 0.3 + Math.random() * 0.3;
      }
    }

    /*
     * 腐蚀者远程吐毒：冷却就绪且在射程内有可见人类时，吐出一发抛物线毒液弹。
     * 落点在吐出瞬间锁定（不追踪），飞行 0.6–0.8 秒后才在落点生成毒液，
     * 人类可以在此期间走位躲开；飞行途中不结算伤害、不挡子弹与视线。
     */
    if (zdef.spit && z.mode === "hunt" && z.spit <= 0) {
      const target = nearestVisibleHuman(world, z, zdef.spit.range);
      if (target && target.turning <= 0) {
        world.spitPoison(
          z.x,
          z.y,
          target.x,
          target.y,
          zdef.spit.radius,
          zdef.spit.duration,
          zdef.spit.dps,
          zdef.spit.speedMul,
        );
        z.spit = zdef.spit.cooldown;
        sound.play(SFX.ZOMBIE_SPIT);
        // 吐出瞬间的口气：一小团绿色雾，和落地的溅射区分开
        world.effects.push({
          kind: "ember",
          x: z.x + Math.cos(Math.atan2(target.y - z.y, target.x - z.x)) * (z.radius + 2),
          y: z.y + Math.sin(Math.atan2(target.y - z.y, target.x - z.x)) * (z.radius + 2),
          angle: 0,
          radius: 3,
          color: 0x84cc16,
          age: 0,
          life: 0.18,
        });
      }
    }

    // 飞扑者：蓄力 / 飞扑 / 落地硬直由状态机接管；接管时跳过常规移动与撕咬
    if (zdef.leap && tickLeaper(world, z, dt, zdef.leap)) continue;

    let dx: number;
    let dy: number;
    if (z.mode === "wander") {
      // 漫游：自己走自己的，不采样流场、不追开口
      tickWander(z, dt);
      if (z.wanderRest) {
        dx = 0;
        dy = 0;
      } else {
        dx = Math.cos(z.wanderAngle);
        dy = Math.sin(z.wanderAngle);
      }
    } else if (pursuitModeOf(z) === "breach") {
      if (z.stranded) {
        // 无解（纯墙封闭 / 只剩自己钻不过的窗）：按零人类漫游慢晃、偶尔停，
        // 不贴着墙顶门。等别的僵尸破口或人类区域变化后，索敌节拍会重新判断。
        tickWander(z, dt);
        if (z.wanderRest) {
          dx = 0;
          dy = 0;
        } else {
          dx = Math.cos(z.wanderAngle);
          dy = Math.sin(z.wanderAngle);
        }
      } else if (z.goalOpening) {
        const op = world.opening(z.goalOpening);
        if (!op || op.broken) {
          // 目标刚被别人啃破：本帧停一下，下一帧立刻按新的连通关系重算
          z.goalOpening = null;
          z.retarget = 0;
          dx = 0;
          dy = 0;
        } else if (pointRectDist(z.x, z.y, op.rect) <= z.radius + 5) {
          // 已经贴上目标开口：停下啃，避免被沿墙滑动带离门洞
          dx = 0;
          dy = 0;
        } else {
          // 走向本次要破除的开口：沿“该开口为源”的流场绕墙过去，
          // 取不到流场（理论上不会）时退回直线
          const path = world.openingFlow(op.id, z.bodyDiameter);
          let fx = 0;
          let fy = 0;
          if (path) {
            path.sample(z.x, z.y);
            fx = path.x;
            fy = path.y;
          }
          if (fx === 0 && fy === 0) {
            const tx = op.rect.x + op.rect.w * 0.5 - z.x;
            const ty = op.rect.y + op.rect.h * 0.5 - z.y;
            const d = Math.hypot(tx, ty) || 1;
            dx = tx / d;
            dy = ty / d;
          } else {
            dx = fx;
            dy = fy;
          }
        }
      } else {
        // 本连通区域有活人：追最近活人，不主动破门窗。
        // 用“所有活人为源”的流场绕开墙体 / 完整门窗；进入开阔处后自然直扑。
        const path = world.humanFlowFor(z.bodyDiameter);
        let fx = 0;
        let fy = 0;
        if (path) {
          path.sample(z.x, z.y);
          fx = path.x;
          fy = path.y;
        }
        if (fx === 0 && fy === 0) {
          const tx = z.tx - z.x;
          const ty = z.ty - z.y;
          const d = Math.hypot(tx, ty) || 1;
          dx = tx / d;
          dy = ty / d;
        } else {
          dx = fx;
          dy = fy;
        }
      }
    } else {
      // direct 模式（旧行为）：房间外查流场涌向最近开口，房间内直扑索敌目标
      const outside =
        z.x < room.left + 6 ||
        z.y < room.top + 6 ||
        z.y > room.bottom - 6 ||
        z.x > room.right - 6;
      if (outside) {
        // 胖子身体直径 22 > 窗宽 18，走的是按体型过滤后的流场，只会绕向门
        const f = world.flowFor(z.bodyDiameter).sample(z.x, z.y);
        dx = f.x;
        dy = f.y;
      } else {
        const tx = z.tx - z.x;
        const ty = z.ty - z.y;
        const d = Math.hypot(tx, ty) || 1;
        dx = tx / d;
        dy = ty / d;
      }
    }

    // 腐蚀者 / 尖叫者 / 母体：用距离维持覆盖常规追击方向（站定时就是 0,0）
    const ranged = rangedBehaviorDir(world, z, zdef);
    if (ranged) {
      dx = ranged.x;
      dy = ranged.y;
    }

    // 行走时轻微摇摆，尸群看起来更自然
    const wob = Math.sin(world.time * 3 + z.phase) * 0.28;
    const nx = -dy;
    const ny = dx;
    dx += nx * wob * 0.5;
    dy += ny * wob * 0.5;

    // 局部分离，避免完全重叠成一坨。
    // 查询半径按“本半径 + 全表最大半径”推导，分离距离按两者半径之和，兼容胖子。
    world.zombieGrid.query(z.x, z.y, z.radius + MAX_ZOMBIE_RADIUS, queryZ2);
    let px = 0;
    let py = 0;
    let cnt = 0;
    for (let k = 0; k < queryZ2.length; k++) {
      const o = queryZ2[k];
      if (o === z || !o.alive) continue;
      const ox = z.x - o.x;
      const oy = z.y - o.y;
      const d2 = ox * ox + oy * oy;
      const sep = z.radius + o.radius;
      if (d2 > 0.01 && d2 < sep * sep) {
        const d = Math.sqrt(d2);
        px += (ox / d) * (1 - d / sep);
        py += (oy / d) * (1 - d / sep);
        cnt++;
        if (cnt >= 5) break;
      }
    }
    dx += px * 1.15;
    dy += py * 1.15;

    // 越挤走得越慢，形成“堆在门口往里挤”的效果；
    // 中心正穿过破损的窗时，被窗檐绊住大幅减速
    let passMul = 1;
    for (const o of world.openings) {
      if (o.broken && o.passSpeed < 1 && pointRectDist(z.x, z.y, o.rect) < 6) {
        passMul = o.passSpeed;
        break;
      }
    }
    const len = Math.hypot(dx, dy) || 1;
    const wanderMul = z.mode === "wander" || z.stranded ? WANDER_TUNING.speedScale : 1;
    // 受击减速对索敌和漫游同时生效；不碰咬合间隔与咬人伤害
    const slowMul =
      z.slowTimer > 0 ? 1 - (1 - z.slowMul) * (z.slowTimer / ZOMBIE_SLOW.duration) : 1;
    // 草丛内丧尸也减速；失效 / 休眠 / 重生中的草按 grassEffectAt 的 0..1 线性过渡
    const grassMul = 1 - (1 - TERRAIN.grass.speedMul) * world.grassEffectAt(z.x, z.y);
    const speed = z.speed * passMul * (cnt >= 5 ? 0.72 : 1) * wanderMul * slowMul * grassMul * z.buffSpeedMul;
    let x = z.x + (dx / len) * speed * dt;
    let y = z.y + (dy / len) * speed * dt;

    // 撞墙 / 撞上完好的门窗时被挡住（破口可以钻）
    let blockedX = false;
    let blockedY = false;
    // 体型过窄的开口（如 18px 窗 vs 胖子 22px 身体）按墙处理，防止从破损窗钻过去
    if (world.solidAt(x, z.y, 0, z.bodyDiameter)) {
      x = z.x;
      blockedX = true;
    }
    // 用已修正的 x 再判 y：两个轴单独可走、拼起来却切进墙角的对角位移也要拦住
    if (world.solidAt(x, y, 0, z.bodyDiameter)) {
      y = z.y;
      blockedY = true;
    }

    /*
     * 沿墙滑动：流场是 16px 网格，拐角处希望方向可能几乎正对墙面，
     * 此时两个轴只剩一个分量，单位会顶在墙角不动（胖子绕墙走向门时就撞上过）。
     * 这里在被挡住的轴不动的前提下，向左右/上下探一小步，哪边能继续走就往哪边挪。
     * 通用碰撞处理，不针对某一种僵尸。
     */
    if (z.mode === "hunt") {
      const ux = dx / len;
      const uy = dy / len;
      const step = speed * dt;
      // 前方探针距离：至少 8px，体型越大探得越远，足够绕过 12px 厚的墙
      const probe = Math.max(8, z.bodyDiameter * 0.6);
      const reach = Math.max(probe, z.bodyDiameter);
      if (blockedY && Math.abs(ux) < 0.35 && Math.abs(uy) > 0.2) {
        const signs = ux < 0 ? [-1, 1] : [1, -1];
        for (const sg of signs) {
          let free = false;
          // 横向找一个“前方能继续往下走”的落点，再朝那个方向挪一小步
          for (let off = step; off <= reach; off += 2) {
            const px = z.x + sg * off;
            if (
              !world.solidAt(px, z.y, 0, z.bodyDiameter) &&
              !world.solidAt(px, z.y + uy * probe, 0, z.bodyDiameter)
            ) {
              free = true;
              break;
            }
          }
          if (free) {
            x = z.x + sg * step;
            break;
          }
        }
      } else if (blockedX && Math.abs(uy) < 0.35 && Math.abs(ux) > 0.2) {
        const signs = uy < 0 ? [-1, 1] : [1, -1];
        for (const sg of signs) {
          let free = false;
          for (let off = step; off <= reach; off += 2) {
            const py = z.y + sg * off;
            if (
              !world.solidAt(z.x, py, 0, z.bodyDiameter) &&
              !world.solidAt(z.x + ux * probe, py, 0, z.bodyDiameter)
            ) {
              free = true;
              break;
            }
          }
          if (free) {
            y = z.y + sg * step;
            break;
          }
        }
      }
    }

    // 地图边界同样按碰撞半径夹取，身体外缘不越出画布
    const cx = clamp(x, z.radius, map.width - z.radius);
    const cy = clamp(y, z.radius, map.height - z.radius);
    if (cx !== x) blockedX = true;
    if (cy !== y) blockedY = true;
    z.x = cx;
    z.y = cy;

    // 漫游（含 breach 无解漫游）撞到墙 / 地图边界时转向，不沿着墙硬顶
    if ((z.mode === "wander" || z.stranded) && (blockedX || blockedY)) {
      bounceWander(z, blockedX, blockedY);
    }

    // 撕咬冷却就绪时先试着咬人；够不到人就啃贴上的门窗。
    // 漫游状态下完全不碰建筑：不扣门窗血量、也不触发咬合音效。
    if (z.mode === "hunt" && z.bite <= 0) {
      let bit = false;
      const reach = z.radius + HUMAN_DEF.radius + 2;
      // 飞扑者不撕咬人类：它的伤害来自压制，贴身后的攻击会被扑击状态机接管。
      // noAttack 的僵尸（母体 / 尖叫者）同样不撕咬人类，但仍会啃门窗。
      if (!zdef.leap && !zdef.noAttack) {
        world.humanGrid.query(z.x, z.y, reach, queryH);
        for (let k = 0; k < queryH.length; k++) {
          const h = queryH[k];
          if (!h.alive || h.turning > 0 || h.invincible) continue;
          if (dist2(z.x, z.y, h.x, h.y) <= reach * reach) {
            // 撕咬先扣真实血量，血量归零才进入异变倒计时；
            // 无敌单位在上一行已被跳过，完全免疫掉血与转化。
            // 生存模式可单独调低承伤倍率（damageTakenMul），其余模式为 undefined → 1；
            // 被尖叫强化的僵尸按强化倍率提高撕咬伤害。
            const taken = z.damage * z.buffDamageMul * (h.damageTakenMul ?? 1);
            const applied = Math.min(taken, Math.max(0, h.hp));
            h.hp = Math.max(0, h.hp - taken);
            h.hurtTimer = 3;
            world.onHumanDamage?.(h, applied);
            if (h.hp <= 0) h.turning = s.human.turnTime;
            h.vx = 0;
            h.vy = 0;
            z.bite = z.biteCycle ?? zdef.bite;
            sound.play(SFX.ZOMBIE_BITE); // 啃咬人类
            bit = true;
            break;
          }
        }
      }
      if (!bit) {
        const pursuit = pursuitModeOf(z);
        if (pursuit === "breach") {
          // 只有跨区追击（有明确破口目标）才拆建筑；同区有人时不主动破门窗
          if (!z.stranded && z.goalOpening) biteOpening(world, z, z.goalOpening);
        } else {
          // direct 模式保留旧行为：贴到哪扇完好开口就啃哪扇
          biteOpening(world, z, null);
        }
      }
    }
  }
}

/**
 * 啃门窗：贴在完好开口上的丧尸按撕咬节奏啃建筑，
 * 血量归零即破损 —— 门碎了全速涌入，窗碎了被窗檐减速挤进来。
 *
 * targetId 非空时只啃指定开口（breach 追击的最短路目标）；
 * 为空时啃身边第一扇完好的、自己体型能过的开口（direct 旧行为）。
 */
function biteOpening(world: World, z: Zombie, targetId: string | null): void {
  const def = effectiveZombie(z.kind);
  const tune = openingTuning(world.map);
  const reach = z.radius + 5;
  let target: Opening | null = null;
  if (targetId !== null) {
    const op = world.opening(targetId);
    if (
      op &&
      !op.broken &&
      // 自己体型过不去的开口不啃：胖子不会把窗啃破再卡在窗外
      openingNetWidth(op.rect) >= z.bodyDiameter &&
      pointRectDist(z.x, z.y, op.rect) <= reach
    ) {
      target = op;
    }
  } else {
    for (let i = 0; i < world.openings.length; i++) {
      const o = world.openings[i];
      if (o.broken) continue;
      if (openingNetWidth(o.rect) < z.bodyDiameter) continue;
      if (pointRectDist(z.x, z.y, o.rect) > reach) continue;
      target = o;
      break;
    }
  }
  if (!target) return;

  target.hp -= tune.buildBiteDamage;
  // 拆建筑比咬人费劲，啃一口歇更久（训练场可覆盖单个僵尸的撕咬间隔）
  z.bite = (z.biteCycle ?? def.bite) * tune.buildBiteSlow;
  sound.play(SFX.ZOMBIE_BITE); // 啃门窗（限频 400ms，密集啃咬时形成拆门节奏）
  // 啃咬的小火花，让“建筑正在被拆”看得见
  world.effects.push({
    kind: "blast",
    x: z.x,
    y: z.y,
    angle: 0,
    radius: 7,
    color: 0xd8b26a,
    age: 0,
    life: 0.16,
  });
  if (target.hp <= 0) {
    target.broken = true;
    target.hp = 0;
    world.effects.push({
      kind: "blast",
      x: target.rect.x + target.rect.w * 0.5,
      y: target.rect.y + target.rect.h * 0.5,
      angle: 0,
      radius: 30,
      color: 0xd8b26a,
      age: 0,
      life: 0.5,
    });
    // 连通关系刚变化：立刻丢掉区域图并让所有僵尸下一帧重算，
    // 不等各自 0.3~0.6 秒的索敌节拍（多层阻断要逐层推进）
    world.invalidateNavigation();
  }
}
