/**
 * AI 系统 —— 人类与丧尸的每帧行为更新。
 *
 * 人类（两种行为模式，由 world.mode 切换）：
 *   defend：有岗的人站桩守开口，只打看得见且在射程内的丧尸，不追击；
 *           没岗的人按 attack 逻辑自由交战
 *   attack：索敌后主动接敌，保持距离走位开火
 *   被咬后原地停下、仍可还击，倒计时结束倒戈成丧尸
 * 丧尸：按类型的追击模式（默认 breach）决策 ——
 *   breach：本连通区域有人就直追（沿活人流场绕墙），没人则在区域邻接图上
 *           用破拆耗时最短路选第一扇可破坏且自己钻得过的开口，逐层破入；
 *           没有可达路径就漫游，不贴墙顶门（direct 模式保留旧的全局直追）。
 *   贴近完好开口时按撕咬节奏啃，破口后涌入（穿窗会被窗檐减速）；
 *   贴近人类就咬，血量归零后进入异变倒计时。
 */
import { HUMAN_BODY_DIAMETER, HUMAN_DEF } from "../data/humans";
import { MAX_ZOMBIE_RADIUS, WANDER_TUNING, ZOMBIE_IDS, ZOMBIE_SLOW } from "../data/zombies";
import { effectiveWeapon, effectiveZombie, openingTuning, settings } from "../data/settings/runtime";
import type { ZombiePursuitMode } from "../data/types";
import { openingNetWidth } from "./flowField";
import { tryFire, updateFlame } from "./combat";
import type { RegionMap } from "./regions";
import { angDiff, clamp, dist2, pointRectDist, randRange, turnToward } from "../utils/math";
import type { Human, Opening, World, Zombie } from "../core/world";
import { sound, SFX } from "../audio/manager";

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

export function updateHumans(world: World, dt: number): void {
  // 守卫（guard）模式暂未实现，行为上回落到防守
  const postedMode = world.mode !== "attack";
  const s = settings();
  const bounds = world.map.humanBounds;

  for (let i = 0; i < world.humans.length; i++) {
    const h = world.humans[i];
    if (!h.alive) continue;
    // 血条存续时间：受伤后 3 秒淡出，与朝向 / 移动无关
    if (h.hurtTimer > 0) h.hurtTimer = Math.max(0, h.hurtTimer - dt);
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

    /*
     * 位置推进：被分离力推挤、被目标点吸引，最终都要过同一套阻挡判定。
     * 逐轴判定，撞墙时只停被挡的那个轴，保留沿墙滑动。
     * 已经被旧存档 / 极端情况放进墙里时不做阻挡，让人能自己走出来（避免永久卡死）。
     */
    const stuck = world.solidAt(h.x, h.y, 0, HUMAN_BODY_DIAMETER);
    let nx = clamp(h.x + h.vx * dt, bounds.x0, bounds.x1);
    let ny = clamp(h.y + h.vy * dt, bounds.y0, bounds.y1);
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

    if (h.ammo <= 0 && h.reloadTimer <= 0) h.reloadTimer = def.reload;
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
  ex: new Float64Array(0),
  ey: new Float64Array(0),
  visited: new Uint8Array(0),
  prevRegion: new Int32Array(0),
  prevEdge: new Int32Array(0),
};

function ensureNavScratch(n: number): void {
  if (navScratch.n >= n) return;
  navScratch.n = n;
  navScratch.dist = new Float64Array(n);
  navScratch.ex = new Float64Array(n);
  navScratch.ey = new Float64Array(n);
  navScratch.visited = new Uint8Array(n);
  navScratch.prevRegion = new Int32Array(n);
  navScratch.prevEdge = new Int32Array(n);
}

/** 无路可走：不贴墙顶门，退化为原有漫游（慢晃 + 偶尔停） */
function setStranded(z: Zombie): void {
  z.goalOpening = null;
  if (z.stranded) return;
  z.stranded = true;
  z.wanderRest = false;
  z.wanderAngle = randRange(-Math.PI, Math.PI);
  z.wanderTimer = randRange(WANDER_TUNING.moveMin, WANDER_TUNING.moveMax);
}

/**
 * breach 索敌：
 * 1) 本连通区域有活人 -> 直追最近的同区活人，不主动破门窗；
 * 2) 本区没人 -> 在区域邻接图上跑 Dijkstra（边权 = 走到开口的距离 +
 *    破开耗时折算的等效距离），在所有“有活人的区域”里选最快到达的一个，
 *    取最短路上的第一扇开口作为当前破拆目标；
 * 3) 没有任何可达路径 -> 漫游。
 *
 * 只在索敌节拍（0.3~0.6 秒）调用，每帧不跑图；区域图本身按体型缓存，
 * 只在开口破碎时失效重建。
 */
function pursueBreach(world: World, z: Zombie, region: RegionMap): void {
  const myRegion = regionOf(region, z.x, z.y);
  z.goalOpening = null;

  // 1) 同区活人优先：直接追人，不破门窗
  let local: Human | null = null;
  let localD = Infinity;
  const humans = world.humans;
  for (let i = 0; i < humans.length; i++) {
    const h = humans[i];
    if (!h.alive) continue;
    if (regionOf(region, h.x, h.y) !== myRegion) continue;
    const d = (h.x - z.x) * (h.x - z.x) + (h.y - z.y) * (h.y - z.y);
    if (d < localD) {
      localD = d;
      local = h;
    }
  }
  if (local) {
    z.stranded = false;
    z.tx = local.x;
    z.ty = local.y;
    return;
  }

  if (myRegion < 0 || region.count === 0) {
    setStranded(z);
    return;
  }

  const tune = openingTuning(world.map);
  const def = effectiveZombie(z.kind);
  const biteCycle = (z.biteCycle ?? def.bite) * tune.buildBiteSlow;
  const biteDamage = Math.max(1, tune.buildBiteDamage);

  ensureNavScratch(region.count);
  const { dist, ex, ey, visited, prevRegion, prevEdge } = navScratch;
  dist.fill(Infinity, 0, region.count);
  visited.fill(0, 0, region.count);
  prevRegion.fill(-1, 0, region.count);
  prevEdge.fill(-1, 0, region.count);
  dist[myRegion] = 0;
  ex[myRegion] = z.x;
  ey[myRegion] = z.y;

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
    const list = region.edgesOf(u);
    for (let k = 0; k < list.length; k++) {
      const e = region.edges[list[k]];
      const op = world.opening(e.openingId);
      if (!op || op.broken) continue;
      if (openingNetWidth(op.rect) < z.bodyDiameter) continue;
      const other = e.from === u ? e.to : e.from;
      const travel = Math.hypot(e.x - ex[u], e.y - ey[u]);
      // 破拆耗时折算成“以自己移速能走多远”：越省时的开口边权越低
      const bites = Math.ceil(op.maxHp / biteDamage);
      const breakDist = bites * biteCycle * z.speed;
      const nd = dist[u] + travel + breakDist;
      if (nd < dist[other]) {
        dist[other] = nd;
        prevRegion[other] = u;
        prevEdge[other] = list[k];
        ex[other] = e.x;
        ey[other] = e.y;
      }
    }
  }

  // 2) 在所有“有活人的可达区域”里选最快到达的一个（含最后一段接近距离）
  let goalRegion = -1;
  let goalHuman: Human | null = null;
  let goalCost = Infinity;
  for (let i = 0; i < humans.length; i++) {
    const h = humans[i];
    if (!h.alive) continue;
    const hr = regionOf(region, h.x, h.y);
    if (hr < 0 || dist[hr] === Infinity) continue;
    const cost = dist[hr] + Math.hypot(h.x - ex[hr], h.y - ey[hr]);
    if (cost < goalCost) {
      goalCost = cost;
      goalRegion = hr;
      goalHuman = h;
    }
  }

  if (!goalHuman || goalRegion < 0) {
    setStranded(z);
    return;
  }

  // 目标就在本区（理论上已被同区分支拦下，这里兜底直接追人）
  if (goalRegion === myRegion) {
    z.stranded = false;
    z.tx = goalHuman.x;
    z.ty = goalHuman.y;
    return;
  }

  // 回溯最短路，找出从本区出发要破的第一扇开口
  let r = goalRegion;
  while (prevRegion[r] !== myRegion) {
    const p = prevRegion[r];
    if (p < 0) {
      setStranded(z);
      return;
    }
    r = p;
  }
  const edgeIndex = prevEdge[r];
  if (edgeIndex < 0) {
    setStranded(z);
    return;
  }
  const edge = region.edges[edgeIndex];
  z.stranded = false;
  z.goalOpening = edge.openingId;
  z.tx = edge.x;
  z.ty = edge.y;
}

/** 索敌分发：按僵尸类型的追击模式决定目标；顺带播一次全局限频的咆哮 */
function retargetZombie(world: World, z: Zombie): void {
  // 全局限频 3 秒一次咆哮 —— 不用每只独立响，全局偶尔一声足够，
  // 但僵尸密集时刚好每隔几秒就响一声，自然营造"尸群包围"的氛围。
  // 胖子用自己的低频低吼，与普通/狂奔的叫声区分。
  if (z.kind === ZOMBIE_IDS.fat) sound.play(SFX.ZOMBIE_GROWL_FAT);
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

    if (z.mode === "hunt") {
      // 每隔 0.3~0.6 秒重新索敌，而不是每帧都找（几千只一起找会卡）
      z.retarget -= dt;
      if (z.retarget <= 0) {
        retargetZombie(world, z);
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
    const speed = z.speed * passMul * (cnt >= 5 ? 0.72 : 1) * wanderMul * slowMul;
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
    if (world.solidAt(z.x, y, 0, z.bodyDiameter)) {
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

    const cx = clamp(x, 2, map.width - 2);
    const cy = clamp(y, 2, map.height - 2);
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
      const zdef = effectiveZombie(z.kind);
      const reach = z.radius + HUMAN_DEF.radius + 2;
      world.humanGrid.query(z.x, z.y, reach, queryH);
      for (let k = 0; k < queryH.length; k++) {
        const h = queryH[k];
        if (!h.alive || h.turning > 0 || h.invincible) continue;
        if (dist2(z.x, z.y, h.x, h.y) <= reach * reach) {
          // 撕咬先扣真实血量，血量归零才进入异变倒计时；
          // 无敌单位在上一行已被跳过，完全免疫掉血与转化。
          const applied = Math.min(z.damage, Math.max(0, h.hp));
          h.hp = Math.max(0, h.hp - z.damage);
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
