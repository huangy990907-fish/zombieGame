/**
 * AI 系统 —— 人类与丧尸的每帧行为更新。
 *
 * 人类（两种行为模式，由 world.mode 切换）：
 *   defend：有岗的人站桩守开口，只打看得见且在射程内的丧尸，不追击；
 *           没岗的人按 attack 逻辑自由交战
 *   attack：索敌后主动接敌，保持距离走位开火
 *   被咬后原地停下、仍可还击，倒计时结束倒戈成丧尸
 * 丧尸：房间外用流场涌向最近的开口 -> 贴上完好的门窗就啃 ->
 *       破口后涌入（穿窗会被窗檐减速）-> 直扑最近人类 -> 贴近就咬
 */
import { HUMAN_DEF } from "../data/humans";
import { WANDER_TUNING, ZOMBIE_IDS } from "../data/zombies";
import { effectiveWeapon, effectiveZombie, openingTuning, settings } from "../data/settings/runtime";
import { tryFire, updateFlame } from "./combat";
import { angDiff, clamp, dist2, pointRectDist, randRange, turnToward } from "../utils/math";
import type { Human, World, Zombie } from "../core/world";
import { sound, SFX } from "../audio/manager";

// 复用的查询缓冲区：每帧反复用同一个数组，避免 GC 压力
const queryZ: Zombie[] = [];
const queryH: Human[] = [];
const queryZ2: Zombie[] = [];

/** 转化完成：人类死亡，原地变成一只普通丧尸，并留下紫色转化特效 */
function convertHuman(world: World, h: Human): void {
  h.alive = false;
  world.infected++;
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

export function updateHumans(world: World, dt: number): void {
  // 守卫（guard）模式暂未实现，行为上回落到防守
  const postedMode = world.mode !== "attack";
  const s = settings();
  const bounds = world.map.humanBounds;

  for (let i = 0; i < world.humans.length; i++) {
    const h = world.humans[i];
    if (!h.alive) continue;
    const def = effectiveWeapon(h.weapon);
    const posted = postedMode && h.post >= 0 && h.post < world.posts.length;

    // 冷却与换弹计时。喷火有自己的一套"持续喷射"计时，交给 updateFlame 推进
    if (def.kind === "flame") updateFlame(world, h, dt);
    else if (h.fire > 0) h.fire -= dt;
    if (h.reloadTimer > 0) {
      h.reloadTimer -= dt;
      if (h.reloadTimer <= 0) {
        h.reloadTimer = 0;
        h.ammo = def.magazine;
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
     * 每 0.25~0.4 秒重新找一次；其余帧复用缓存的目标，
     * 目标死亡、跑出视野或视线被挡住就立刻丢掉重找。
     */
    h.sight -= dt;
    // 训练场可以给单个单位覆盖视野；普通对局 sightOverride 为 undefined，读全局值
    const sightR = h.sightOverride ?? s.human.sight;
    let best = h.target;
    if (best !== null) {
      if (
        !best.alive ||
        dist2(h.x, h.y, best.x, best.y) > sightR * sightR ||
        world.sightBlocked(h.x, h.y, best.x, best.y, WINDOW_SIGHT_PAD)
      ) {
        best = null;
      }
    }
    if (best === null && h.sight <= 0) {
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
      if (dist <= def.range && Math.abs(angDiff(h.facing, ang)) < 0.3) {
        tryFire(world, h, h.facing);
      }

      if (!posted) {
        // 进攻走位：太近后撤 / 太远推进 / 合适距离侧向绕圈
        if (dist < def.range * 0.45) {
          dx = -Math.cos(ang);
          dy = -Math.sin(ang);
        } else if (dist > def.range * 0.9) {
          dx = Math.cos(ang);
          dy = Math.sin(ang);
        } else {
          const s = h.id % 2 === 0 ? 1 : -1;
          dx = -Math.sin(ang) * s;
          dy = Math.cos(ang) * s;
          speedFactor = 0.6;
        }
      }
      // 防守模式不动：走位交给下面的“归岗 / 拒止”逻辑
    } else if (posted) {
      // 没目标：站定，朝自己看守的开口方向瞄准待命
      const p = world.posts[h.post];
      h.facing = turnToward(h.facing, Math.atan2(p.oy - h.y, p.ox - h.x), 5 * dt);
    } else {
      // 没目标：在房间里闲逛，隔几秒换一个目标点
      h.wTimer -= dt;
      if (h.wTimer <= 0 || dist2(h.x, h.y, h.wx, h.wy) < 900) {
        h.wx = randRange(bounds.x0, bounds.x1);
        h.wy = randRange(bounds.y0, bounds.y1);
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
      // 贴身拒止：有僵尸逼近到 60px 内就全速后撤拉开距离（仍不追击），
      // 站着不动只会被当场啃掉，防线瞬间雪崩；
      // 人类 54 的速度比普通丧尸 50 略快，能保持且战且退
      if (threatDist < 60) {
        dx = -Math.cos(threatAng);
        dy = -Math.sin(threatAng);
        speedFactor = 1;
      } else {
        // 否则归岗：离岗哨点超过 6px 就走回去，到位站桩
        const p = world.posts[h.post];
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

    // 期望方向 -> 平滑加速到目标速度（训练场可覆盖单个人类的移速）
    const moveSpeed = h.speedOverride ?? s.human.speed;
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

    h.x = clamp(h.x + h.vx * dt, bounds.x0, bounds.x1);
    h.y = clamp(h.y + h.vy * dt, bounds.y0, bounds.y1);

    if (h.ammo <= 0 && h.reloadTimer <= 0) h.reloadTimer = def.reload;
  }
}

/** 丧尸索敌：直接遍历人类数组（只有几十个人，比查空间哈希更快） */
function retarget(world: World, z: Zombie): void {
  // 全局限频 3 秒一次咆哮 —— 不用每只独立响，全局偶尔一声足够，
  // 但僵尸密集时刚好每隔几秒就响一声，自然营造"尸群包围"的氛围
  sound.play(SFX.ZOMBIE_GROWL);
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
  if (best) {
    z.tx = best.x;
    z.ty = best.y;
  } else {
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
}

/** 切到漫游：随机选一个方向，开始一段移动 */
function beginWander(z: Zombie): void {
  z.mode = "wander";
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

export function updateZombies(world: World, dt: number): void {
  const flow = world.flow;
  const map = world.map;
  const room = map.room;
  const s = settings();
  // 每帧只统计一次存活人类（含转化倒计时中的），所有丧尸共用一个标记
  const huntMode = world.refreshLivingHumans() > 0;
  for (let i = 0; i < world.zombies.length; i++) {
    const z = world.zombies[i];
    if (!z.alive) continue;
    if (z.bite > 0) z.bite -= dt;

    /*
     * 行为状态切换：场上有活人就索敌进攻，零人类才漫游。
     * 人类重新出现时把索敌计时清零，下一帧立刻恢复进攻，不留延迟。
     */
    if (huntMode) {
      if (z.mode !== "hunt") {
        z.mode = "hunt";
        z.retarget = 0;
      }
    } else if (z.mode !== "wander") {
      beginWander(z);
    }

    if (z.mode === "hunt") {
      // 每隔 0.3~0.6 秒重新索敌，而不是每帧都找（几千只一起找会卡）
      z.retarget -= dt;
      if (z.retarget <= 0) {
        retarget(world, z);
        z.retarget = 0.3 + Math.random() * 0.3;
      }
    }

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
    } else {
      // 是否还在房间外（墙外圈 6px 内算边界上）
      const outside =
        z.x < room.left + 6 ||
        z.y < room.top + 6 ||
        z.y > room.bottom - 6 ||
        z.x > room.right - 6;
      if (outside) {
        // 房间外：查流场方向，涌向最近的开口
        const f = flow.sample(z.x, z.y);
        dx = f.x;
        dy = f.y;
      } else {
        // 房间内：直扑索敌目标
        const tx = z.tx - z.x;
        const ty = z.ty - z.y;
        const d = Math.hypot(tx, ty) || 1;
        dx = tx / d;
        dy = ty / d;
      }
    }

    // 行走时轻微摇摆，尸群看起来更自然
    const wob = Math.sin(world.time * 3 + z.phase) * 0.28;
    const nx = -dy;
    const ny = dx;
    dx += nx * wob * 0.5;
    dy += ny * wob * 0.5;

    // 局部分离，避免完全重叠成一坨
    world.zombieGrid.query(z.x, z.y, 11, queryZ2);
    let px = 0;
    let py = 0;
    let cnt = 0;
    for (let k = 0; k < queryZ2.length; k++) {
      const o = queryZ2[k];
      if (o === z || !o.alive) continue;
      const ox = z.x - o.x;
      const oy = z.y - o.y;
      const d2 = ox * ox + oy * oy;
      if (d2 > 0.01 && d2 < 121) {
        const d = Math.sqrt(d2);
        px += (ox / d) * (1 - d / 11);
        py += (oy / d) * (1 - d / 11);
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
    const wanderMul = z.mode === "wander" ? WANDER_TUNING.speedScale : 1;
    const speed = z.speed * passMul * (cnt >= 5 ? 0.72 : 1) * wanderMul;
    let x = z.x + (dx / len) * speed * dt;
    let y = z.y + (dy / len) * speed * dt;

    // 撞墙 / 撞上完好的门窗时被挡住（破口可以钻）
    let blockedX = false;
    let blockedY = false;
    if (world.solidAt(x, z.y)) {
      x = z.x;
      blockedX = true;
    }
    if (world.solidAt(z.x, y)) {
      y = z.y;
      blockedY = true;
    }
    const cx = clamp(x, 2, map.width - 2);
    const cy = clamp(y, 2, map.height - 2);
    if (cx !== x) blockedX = true;
    if (cy !== y) blockedY = true;
    z.x = cx;
    z.y = cy;

    // 漫游撞到墙 / 地图边界时转向，不沿着墙硬顶
    if (z.mode === "wander" && (blockedX || blockedY)) {
      bounceWander(z, blockedX, blockedY);
    }

    // 撕咬冷却就绪时先试着咬人；够不到人就啃贴上的门窗。
    // 漫游状态下完全不碰建筑：不扣门窗血量、也不触发咬合音效。
    if (z.mode === "hunt" && z.bite <= 0) {
      let bit = false;
      world.humanGrid.query(z.x, z.y, 14, queryH);
      const zdef = effectiveZombie(z.kind);
      const reach = zdef.radius + HUMAN_DEF.radius + 2;
      for (let k = 0; k < queryH.length; k++) {
        const h = queryH[k];
        if (!h.alive || h.turning > 0 || h.invincible) continue;
        if (dist2(z.x, z.y, h.x, h.y) <= reach * reach) {
          h.turning = s.human.turnTime;
          h.vx = 0;
          h.vy = 0;
          z.bite = z.biteCycle ?? zdef.bite;
          sound.play(SFX.ZOMBIE_BITE); // 啃咬人类
          bit = true;
          break;
        }
      }
      if (!bit) biteOpening(world, z);
    }
  }
}

/**
 * 啃门窗：贴在完好开口上的丧尸按撕咬节奏啃建筑，
 * 血量归零即破损 —— 门碎了全速涌入，窗碎了被窗檐减速挤进来。
 */
function biteOpening(world: World, z: Zombie): void {
  const def = effectiveZombie(z.kind);
  const tune = openingTuning(world.map);
  const reach = def.radius + 5;
  for (let i = 0; i < world.openings.length; i++) {
    const o = world.openings[i];
    if (o.broken) continue;
    if (pointRectDist(z.x, z.y, o.rect) > reach) continue;

    o.hp -= tune.buildBiteDamage;
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
    if (o.hp <= 0) {
      o.broken = true;
      o.hp = 0;
      world.effects.push({
        kind: "blast",
        x: o.rect.x + o.rect.w * 0.5,
        y: o.rect.y + o.rect.h * 0.5,
        angle: 0,
        radius: 30,
        color: 0xd8b26a,
        age: 0,
        life: 0.5,
      });
    }
    return;
  }
}
