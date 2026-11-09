/**
 * 回归场景：直接加载真实的 src 模块，覆盖 0.8.2 的关键规则。
 *
 * 由 run.mjs 用 esbuild 打包后执行；每个场景失败只影响自己的断言，
 * 汇总后统一打印失败场景名，并让入口以非零退出码结束。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MapDef, OpeningDef, Rect, SpawnRegion } from "../../src/data/types";
import { HUMAN_DEF } from "../../src/data/humans";
import { TERRAIN } from "../../src/data/terrain";
import { WEAPON_IDS, WEAPON_LIST } from "../../src/data/weapons";
import { ZOMBIE_IDS } from "../../src/data/zombies";
import { effectiveWeapon, effectiveZombie, setZombieModeOverrides } from "../../src/data/settings/runtime";
import {
  SURVIVAL_BOSS_POOL,
  SURVIVAL_WEAPON_POOL,
  SURVIVAL_ZOMBIE_OVERRIDES,
  SURVIVAL_ZOMBIE_WEIGHTS,
  survivalXpFor,
} from "../../src/data/survival/config";
import { compileTilesToMapDef } from "../../src/data/maps/compile";
import { validateMapJson } from "../../src/data/maps/schema";
import { validateLevelJson } from "../../src/data/levels/schema";
import { registerRuntimeMap } from "../../src/data/maps";
import { World, type Zombie } from "../../src/core/world";
import { updateHumans, updateZombies } from "../../src/systems/ai";
import { damageZombie, tryFire } from "../../src/systems/combat";
import { openingNetWidth } from "../../src/systems/flowField";
import { isBlockedForBody } from "../../src/systems/collision";
import { SurvivalSession } from "../../src/survival/session";

const ROOT = process.env.REGRESSION_ROOT ?? process.cwd();
const AREA: SpawnRegion = { x0: 0, y0: 0, x1: 1184, y1: 720 };

interface Scenario {
  name: string;
  run: () => void;
}

const scenarios: Scenario[] = [];

function scenario(name: string, run: () => void): void {
  scenarios.push({ name, run });
}

function assert(cond: boolean, message: string): void {
  if (!cond) throw new Error(message);
}

function readJson(rel: string): any {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
}

function mapDef(over: Partial<MapDef> & { id: string }): MapDef {
  const width = 1184;
  const height = 720;
  return {
    name: over.id,
    width,
    height,
    room: { left: 0, top: 0, right: width, bottom: height, wall: 16 },
    walls: [],
    openings: [],
    openingCenters: [],
    spawn: [AREA],
    windowSpawn: {},
    humanZones: [],
    humanBounds: { x0: 20, y0: 20, x1: width - 20, y1: height - 20 },
    buildBiteDamage: 50,
    buildBiteSlow: 2,
    grassTiles: [],
    waterTiles: [],
    waterBlockers: [],
    ...over,
  };
}

/** 生成一排 16×16 草丛格 */
function grassRow(x0: number, y0: number, cells: number): Rect[] {
  const rects: Rect[] = [];
  for (let i = 0; i < cells; i++) {
    rects.push({ x: x0 + i * 16, y: y0, w: 16, h: 16 });
  }
  return rects;
}

/** 拖动某个手动操控的人类向右走一秒，返回位移 */
function moveRightForOneSecond(map: MapDef, x: number, y: number): number {
  const world = new World(map);
  const h = world.spawnHuman(x, y, "mg");
  h.manual = true;
  h.moveX = 1;
  h.moveY = 0;
  h.speedOverride = 70;
  for (let i = 0; i < 60; i++) updateHumans(world, 1 / 60);
  return h.x - x;
}

/** 房间 + 左右两扇门；几何按 16px 瓦片对齐，与编译后的地图口径一致 */
function roomMap(leftHp: number, rightHp: number): MapDef {
  const walls: Rect[] = [
    { x: 192, y: 192, w: 624, h: 16 },
    { x: 192, y: 512, w: 624, h: 16 },
    { x: 192, y: 208, w: 16, h: 128 },
    { x: 192, y: 416, w: 16, h: 96 },
    { x: 800, y: 208, w: 16, h: 128 },
    { x: 800, y: 416, w: 16, h: 96 },
  ];
  const openings: OpeningDef[] = [
    {
      id: "door-left",
      kind: "door",
      rect: { x: 192, y: 336, w: 16, h: 80 },
      maxHp: leftHp,
      passSpeed: 1,
    },
    {
      id: "door-right",
      kind: "door",
      rect: { x: 800, y: 336, w: 16, h: 80 },
      maxHp: rightHp,
      passSpeed: 1,
    },
  ];
  return mapDef({
    id: "t-breach",
    walls,
    openings,
    openingCenters: [
      { x: 200, y: 376 },
      { x: 808, y: 376 },
    ],
  });
}

// ============================================================
// 场景
// ============================================================

scenario("开口通行口径：16px 破损窗 / 完好门窗 / 80px 门", () => {
  const brokenWindow = { rect: { x: 400, y: 200, w: 16, h: 16 }, broken: true };
  assert(openingNetWidth(brokenWindow.rect) === 16, "16px 窗净宽应为 16");
  assert(
    !isBlockedForBody(11, 408, 208, [], [brokenWindow]),
    "普通丧尸（直径 11）应能穿过 16px 破损窗",
  );
  assert(
    isBlockedForBody(22, 408, 208, [], [brokenWindow]),
    "胖子（直径 22）不应穿过 16px 破损窗",
  );
  assert(
    isBlockedForBody(11, 408, 208, [], [{ ...brokenWindow, broken: false }]),
    "完好的窗应阻挡普通丧尸",
  );

  const brokenDoor = { rect: { x: 500, y: 200, w: 80, h: 16 }, broken: true };
  assert(
    !isBlockedForBody(22, 540, 208, [], [brokenDoor]),
    "胖子应能穿过 80px 破损门",
  );
  assert(
    isBlockedForBody(11, 540, 208, [], [{ ...brokenDoor, broken: false }]),
    "完好的门应阻挡普通丧尸",
  );
  assert(
    isBlockedForBody(11, 495, 208, [{ x: 490, y: 200, w: 16, h: 16 }], []),
    "墙体应阻挡贴近的人类 / 丧尸",
  );
});

scenario("人类不穿墙：手动向右移动被墙挡住", () => {
  const wall: Rect = { x: 400, y: 100, w: 16, h: 400 };
  const world = new World(mapDef({ id: "t-wall", walls: [wall] }));
  const h = world.spawnHuman(340, 300, "mg");
  h.manual = true;
  h.moveX = 1;
  h.moveY = 0;
  h.facing = 0;
  h.speedOverride = 70;
  for (let i = 0; i < 180; i++) updateHumans(world, 1 / 60);
  assert(h.x > 340, "人类应确实向右移动了");
  assert(h.x < wall.x, "人类不得穿过墙体");
  assert(!world.solidAt(h.x, h.y, 0, HUMAN_DEF.radius * 2), "人类最终位置不应落在阻挡内");
});

scenario("breach 破门顺序：同血量选近门，血量悬殊选省时门，破口后改为直追", () => {
  // 两扇门同血量：距离更近的左门应被选中
  const world = new World(roomMap(450, 450));
  world.spawnHuman(500, 380, "mg");
  const z = world.spawnZombie(170, 380, ZOMBIE_IDS.normal);
  z.speed = 70;
  z.bite = 1;
  world.rebuildGrids();
  z.retarget = 0;
  updateZombies(world, 0.016);
  assert(z.goalOpening === "door-left", `同血量时应选近门，实际 ${z.goalOpening}`);

  // 左门血量极高、右门极低：绕远去右门更划算
  const farWorld = new World(roomMap(2000, 100));
  farWorld.spawnHuman(500, 380, "mg");
  const z2 = farWorld.spawnZombie(170, 380, ZOMBIE_IDS.normal);
  z2.speed = 70;
  z2.bite = 1;
  farWorld.rebuildGrids();
  z2.retarget = 0;
  updateZombies(farWorld, 0.016);
  assert(z2.goalOpening === "door-right", `血量悬殊时应选省时的右门，实际 ${z2.goalOpening}`);

  // 左门被打碎后，外区与内区连通，应放弃破门直接追人
  const left = farWorld.opening("door-left");
  if (left) left.broken = true;
  farWorld.invalidateNavigation();
  z2.retarget = 0;
  updateZombies(farWorld, 0.016);
  assert(z2.goalOpening === null, "破口后应改为同区直追，不再指定破拆目标");
  assert(!z2.stranded, "破口后不应进入无解漫游");
});

scenario("求生经验拾取：击杀掉球 → 靠近吸附 → 经验增加", () => {
  registerRuntimeMap(compileTilesToMapDef(readJson("public/maps/open-field.json")));
  const session = new SurvivalSession();
  session.start("open-field");
  const player = session.player;
  assert(player !== undefined, "求生玩家应已生成");

  const z = session.world.spawnZombie(player!.x + 30, player!.y, ZOMBIE_IDS.normal);
  session.world.rebuildGrids();
  // 固定随机数，保证必掉经验球且落点稳定
  const originalRandom = Math.random;
  Math.random = () => 0;
  try {
    damageZombie(session.world, z, z.hp + 10, { humanId: player!.id, weapon: "mg" });
  } finally {
    Math.random = originalRandom;
  }

  const before = session.xp;
  for (let i = 0; i < 40 && session.xp === before; i++) session.tick(0.05);
  assert(session.xp > before, "经验球应被吸附拾取并增加经验");
  assert(session.orbsForRender().length === 0, "拾取后经验球应从场上移除");
  session.stop(); // 离开求生模式：撤销模式覆盖表，避免污染后续场景
});

scenario("求生目标切换：最近目标死亡后立即改锁下一个", () => {
  const session = new SurvivalSession();
  session.start("open-field");
  const player = session.player;
  assert(player !== undefined, "求生玩家应已生成");

  const far = session.world.spawnZombie(player!.x + 120, player!.y, ZOMBIE_IDS.normal);
  const near = session.world.spawnZombie(player!.x + 50, player!.y, ZOMBIE_IDS.normal);
  far.hp = far.maxHp = far.hp * 10;
  near.hp = near.maxHp = near.hp * 10;

  session.tick(0.05);
  assert(player!.target === near, "应优先锁定最近的丧尸");
  near.alive = false;
  near.hp = 0;
  session.tick(0.05);
  assert(player!.target === far, "最近目标死亡后应切换到下一只存活丧尸");
  session.stop(); // 离开求生模式：撤销模式覆盖表，避免污染后续场景
});

scenario("地图与关卡 JSON 校验：内置数据全部合法，非法数据被拦截", () => {
  const mapManifest = readJson("public/maps/manifest.json");
  const mapIds = new Set<string>();
  for (const entry of mapManifest.maps) {
    const raw = readJson(`public/maps/${entry.file}`);
    assert(raw.id === entry.id, `地图 ${entry.file} 的 id 与 manifest 不一致`);
    const errors = validateMapJson(raw);
    assert(
      errors.length === 0,
      `地图 ${entry.file} 不应该校验失败：${errors.map((e) => e.message).join("；")}`,
    );
    const compiled = compileTilesToMapDef(raw);
    mapIds.add(compiled.id);
    assert(
      Array.isArray(compiled.grassTiles) &&
        Array.isArray(compiled.waterTiles) &&
        Array.isArray(compiled.waterBlockers),
      `地图 ${entry.file} 编译后应包含地形字段`,
    );
  }
  assert(mapIds.has("open-field"), "open-field 应在合法地图清单里");

  const arenaRaw = readJson("public/maps/arena.json");
  const badMap = JSON.parse(JSON.stringify(arenaRaw));
  const row = badMap.tiles[3];
  badMap.tiles[3] = row.slice(0, 10) + "?" + row.slice(11);
  const badErrors = validateMapJson(badMap);
  assert(badErrors.length > 0, "未知瓦片字符应被校验拦截");

  const ctx = {
    mapIds,
    weaponIds: new Set(WEAPON_LIST.map((w) => w.id)),
    zombieIds: new Set(Object.values(ZOMBIE_IDS)),
  };
  const levelManifest = readJson("public/levels/manifest.json");
  for (const entry of levelManifest.levels) {
    const raw = readJson(`public/levels/${entry.file}`);
    assert(raw.id === entry.id, `关卡 ${entry.file} 的 id 与 manifest 不一致`);
    const errors = validateLevelJson(raw, ctx);
    assert(
      errors.length === 0,
      `关卡 ${entry.file} 不应该校验失败：${errors.join("；")}`,
    );
  }

  const baseLevel = readJson(`public/levels/${levelManifest.levels[0].file}`);
  const badLevel = JSON.parse(JSON.stringify(baseLevel));
  badLevel.mapId = "missing-map";
  assert(validateLevelJson(badLevel, ctx).length > 0, "引用不存在的地图应被校验拦截");
});

scenario("草丛：减速 20%，燃烧期间效果归零，休眠后渐隐重生", () => {
  const grass = grassRow(480, 352, 10);
  const grassMap = mapDef({ id: "t-grass", grassTiles: grass });
  const bareMap = mapDef({ id: "t-bare" });

  const bare = moveRightForOneSecond(bareMap, 488, 360);
  const covered = moveRightForOneSecond(grassMap, 488, 360);
  assert(bare > 0 && covered > 0, "两次移动都应有位移");
  const ratio = covered / bare;
  assert(
    Math.abs(ratio - TERRAIN.grass.speedMul) < 0.02,
    `草丛位移应约为裸地的 ${TERRAIN.grass.speedMul}，实际 ${ratio.toFixed(3)}`,
  );

  const world = new World(grassMap);
  assert(world.grassEffectAt(488, 360) === 1, "正常草丛效果应为 1");
  world.igniteGrassAt(488, 360);
  assert(world.grassEffectAt(488, 360) === 0, "燃烧中的草丛效果应为 0");

  world.tickTerrain(TERRAIN.grass.burnTime + 0.05);
  assert(world.grass[0].phase === 2, "烧完应进入休眠阶段");
  assert(world.grassEffectAt(488, 360) === 0, "休眠中的草丛效果应为 0");

  world.tickTerrain(TERRAIN.grass.regrowDelay + 0.05);
  assert(world.grass[0].phase === 3, "休眠结束应进入重生阶段");
  assert(world.grassEffectAt(488, 360) < 0.01, "重生刚开始时应几乎无效");

  world.tickTerrain(TERRAIN.grass.regrowFade / 2);
  const mid = world.grassEffectAt(488, 360);
  assert(mid > 0.4 && mid < 0.6, `重生过半时效果应约为 0.5，实际 ${mid.toFixed(3)}`);

  world.tickTerrain(TERRAIN.grass.regrowFade / 2 + 0.05);
  assert(world.grass[0].phase === 0, "重生结束应恢复为正常草丛");
  assert(world.grassEffectAt(488, 360) === 1, "重生结束后效果应恢复为 1");
});

scenario("水池：阻挡单位寻路，但不挡子弹与视线", () => {
  const water: Rect = { x: 500, y: 350, w: 64, h: 64 };
  const world = new World(
    mapDef({ id: "t-water", waterTiles: [water], waterBlockers: [water] }),
  );

  assert(world.solidAt(530, 380, 0, 11), "水池内部应阻挡普通丧尸");
  assert(!world.solidAt(460, 380, 0, 11), "水池外应可通行");

  const h = world.spawnHuman(460, 380, "mg");
  h.manual = true;
  h.moveX = 1;
  h.moveY = 0;
  h.speedOverride = 70;
  for (let i = 0; i < 60; i++) updateHumans(world, 1 / 60);
  assert(h.x < water.x, `人类不应进入水池，实际 x=${h.x.toFixed(1)}`);

  assert(!world.bulletBlocked(460, 380, 620, 380), "子弹应能穿过水池");
  assert(!world.sightBlocked(460, 380, 620, 380), "视线应能穿过水池");

  const spot = world.findFreeSpot(530, 380, 11, AREA);
  assert(spot !== null, "水池附近仍应能找到可用落点");
  assert(!world.solidAt(spot!.x, spot!.y, 0, 11), "找到的落点不应位于水池内");
});

scenario("双武器同时开火：同一帧两把武器各自消耗弹药与冷却", () => {
  const world = new World(mapDef({ id: "t-dual" }));
  const h = world.spawnHuman(300, 300, "mg");
  const shotgun = effectiveWeapon("shotgun");
  h.ammo = effectiveWeapon("mg").magazine;
  h.fire = 0;
  h.weapon2 = "shotgun";
  h.ammo2 = shotgun.magazine;
  h.fire2 = 0;
  h.reload2 = 0;
  h.burst2 = 0;
  h.facing = 0;

  const z = world.spawnZombie(400, 300, ZOMBIE_IDS.normal);
  z.hp = z.maxHp = 100000;
  h.target = z;
  world.rebuildGrids();

  const bulletsBefore = world.bullets.length;
  updateHumans(world, 0.05);

  const mgMag = effectiveWeapon("mg").magazine;
  const sgMag = shotgun.magazine;
  assert(h.ammo === mgMag - 1, `主武器应消耗 1 发，实际 ${h.ammo}`);
  assert(h.ammo2 === sgMag - 1, `副武器应独立消耗 1 发，实际 ${h.ammo2}`);
  assert(h.fire > 0, "主武器应进入冷却");
  assert((h.fire2 ?? 0) > 0, "副武器应进入自己的冷却");
  const added = world.bullets.length - bulletsBefore;
  assert(
    added === 1 + shotgun.pellets,
    `同一帧应打出 1 发机枪 + ${shotgun.pellets} 颗霰弹，实际 ${added}`,
  );
});

scenario("额外投射物层数：机枪 / 霰弹 / 火箭 / 电击枪按层数增加", () => {
  // 机枪：1 + extra 条弹道
  const mgWorld = new World(mapDef({ id: "t-extra-mg" }));
  const mgHuman = mgWorld.spawnHuman(300, 300, "mg");
  mgHuman.extraProjectiles = 3;
  tryFire(mgWorld, mgHuman, 0, 0);
  assert(mgWorld.bullets.length === 4, `机枪 3 层额外应打出 4 发，实际 ${mgWorld.bullets.length}`);

  // 霰弹：pellets + extra 颗弹丸
  const sgWorld = new World(mapDef({ id: "t-extra-sg" }));
  const sgHuman = sgWorld.spawnHuman(300, 300, "shotgun");
  sgHuman.extraProjectiles = 1;
  const pellets = effectiveWeapon("shotgun").pellets;
  tryFire(sgWorld, sgHuman, 0, 0);
  assert(
    sgWorld.bullets.length === pellets + 1,
    `霰弹 1 层额外应打出 ${pellets + 1} 颗，实际 ${sgWorld.bullets.length}`,
  );

  // 火箭：1 + extra 条弹道
  const rocketWorld = new World(mapDef({ id: "t-extra-rocket" }));
  const rocketHuman = rocketWorld.spawnHuman(300, 300, "rocket");
  rocketHuman.extraProjectiles = 2;
  tryFire(rocketWorld, rocketHuman, 0, 0);
  assert(
    rocketWorld.bullets.length === 3,
    `火箭 2 层额外应打出 3 发，实际 ${rocketWorld.bullets.length}`,
  );

  // 电击枪：1 + extra 道电弧，各自独立选目标
  const teslaWorld = new World(mapDef({ id: "t-extra-tesla" }));
  const teslaHuman = teslaWorld.spawnHuman(300, 300, "tesla");
  teslaHuman.extraProjectiles = 1;
  // 血量显式拉高：僵尸出生血量带随机抖动，低血时首道电弧直接打死目标会让第二道找不到目标
  const teslaTarget = teslaWorld.spawnZombie(340, 300, ZOMBIE_IDS.normal);
  teslaTarget.hp = teslaTarget.maxHp = 100000;
  teslaWorld.rebuildGrids();
  tryFire(teslaWorld, teslaHuman, 0, 0);
  const arcs = teslaWorld.effects.filter((e) => e.kind === "arc").length;
  assert(arcs === 2, `电击枪 1 层额外应产生 2 道电弧，实际 ${arcs}`);

  const singleWorld = new World(mapDef({ id: "t-extra-tesla-single" }));
  const singleHuman = singleWorld.spawnHuman(300, 300, "tesla");
  const singleTarget = singleWorld.spawnZombie(340, 300, ZOMBIE_IDS.normal);
  singleTarget.hp = singleTarget.maxHp = 100000;
  singleWorld.rebuildGrids();
  tryFire(singleWorld, singleHuman, 0, 0);
  const singleArcs = singleWorld.effects.filter((e) => e.kind === "arc").length;
  assert(singleArcs === 1, `无额外层数时电击枪应只有 1 道电弧，实际 ${singleArcs}`);
});

scenario("飞扑者：蓄力受击只延长不打断，扑中压制 3 秒后自动挣脱", () => {
  // 受击延长：0.6 + 0.12 = 0.72；连续受击夹在 2.0 秒上限
  const chargeWorld = new World(mapDef({ id: "t-leaper-charge" }));
  const cz = chargeWorld.spawnZombie(100, 100, ZOMBIE_IDS.leaper);
  cz.hp = cz.maxHp = 100000;
  cz.leapPhase = 1;
  cz.leapTimer = 0.6;
  damageZombie(chargeWorld, cz, 1);
  assert(Math.abs(cz.leapTimer - 0.72) < 1e-6, `受击应把蓄力延到 0.72，实际 ${cz.leapTimer}`);
  assert(cz.leapPhase === 1, "受击不应打断蓄力");
  for (let i = 0; i < 20; i++) damageZombie(chargeWorld, cz, 1);
  const cfg = effectiveZombie(ZOMBIE_IDS.leaper).leap!;
  assert(cz.leapTimer <= cfg.chargeMax + 1e-6, `蓄力不应超过 ${cfg.chargeMax} 秒`);

  // 压制与挣脱
  const world = new World(mapDef({ id: "t-leaper" }));
  const h = world.spawnHuman(600, 360, "mg");
  h.manual = true;
  h.moveX = 0;
  h.moveY = 0;
  h.ammo = 0;
  h.reloadTimer = 999;
  const z = world.spawnZombie(660, 360, ZOMBIE_IDS.leaper);
  z.hp = z.maxHp = 100000;
  z.speed = 150;
  world.rebuildGrids();

  let pinned = false;
  for (let f = 0; f < 180; f++) {
    updateHumans(world, 1 / 60);
    updateZombies(world, 1 / 60);
    if (h.pinTimer > 0 && z.pinTargetId === h.id) {
      pinned = true;
      break;
    }
  }
  assert(pinned, "飞扑者应在 3 秒内扑中并压制目标");
  assert(h.pinBy === z.id, "压制者应是该飞扑者");
  const hpAtPin = h.hp;

  let released = false;
  for (let f = 0; f < 240; f++) {
    updateHumans(world, 1 / 60);
    updateZombies(world, 1 / 60);
    if (h.pinTimer <= 0) {
      released = true;
      break;
    }
  }
  assert(released, "压制应在约 3 秒后自动挣脱");
  assert(z.pinTargetId === null, "挣脱后飞扑者应清除压制目标");
  assert(h.pinBy === null, "挣脱后人类应清除压制来源");
  const lost = hpAtPin - h.hp;
  assert(lost >= 20 && lost <= 28, `3 秒压制应掉约 24 血，实际 ${lost.toFixed(1)}`);
});

scenario("腐蚀毒液：持续伤害 / 减速 / 不叠加 / 不伤僵尸 / 不挡子弹与视线", () => {
  const world = new World(mapDef({ id: "t-poison" }));
  const h = world.spawnHuman(500, 360, "mg");
  const z = world.spawnZombie(500, 360, ZOMBIE_IDS.normal);
  const zHp = z.hp;
  world.addPoison(500, 360, 40, 6, 6, 0.8);

  const hp0 = h.hp;
  for (let f = 0; f < 60; f++) world.tickTerrain(1 / 60);
  const lost = hp0 - h.hp;
  assert(Math.abs(lost - 6) < 0.4, `毒液 1 秒应掉约 6 血，实际 ${lost.toFixed(2)}`);
  assert(z.hp === zHp, "毒液不应伤害丧尸");

  // 同位置更强的毒液替换较弱的一团；再叠弱毒也不增加层数
  world.addPoison(500, 360, 44, 6, 12, 0.5);
  assert(world.poison.length === 1, "同位置更强的毒液应替换旧团，不叠加");
  const eff = world.poisonEffectAt(500, 360);
  assert(eff !== null && eff.dps === 12 && eff.speedMul === 0.5, "同位置应取最高伤害 / 最强减速");
  world.addPoison(500, 360, 40, 6, 6, 0.8);
  assert(world.poison.length === 1, "同位置再叠弱毒不应增加层数");
  assert(world.poisonEffectAt(500, 360)!.dps === 12, "弱毒不应覆盖更强的伤害");

  assert(!world.solidAt(500, 360, 0, 11), "毒液不应阻挡单位");
  assert(!world.bulletBlocked(460, 360, 540, 360), "毒液不应挡子弹");
  assert(!world.sightBlocked(460, 360, 540, 360), "毒液不应挡视线");

  // 减速：在毒液里移动 1 秒与裸地对比
  const bare = moveRightForOneSecond(mapDef({ id: "t-poison-bare" }), 488, 360);
  const poisonWorld = new World(mapDef({ id: "t-poison-speed" }));
  poisonWorld.addPoison(520, 360, 40, 6, 6, 0.8);
  const ph = poisonWorld.spawnHuman(488, 360, "mg");
  ph.manual = true;
  ph.moveX = 1;
  ph.moveY = 0;
  ph.speedOverride = 70;
  for (let i = 0; i < 60; i++) updateHumans(poisonWorld, 1 / 60);
  const covered = ph.x - 488;
  assert(bare > 0 && covered > 0, "两次移动都应有位移");
  const ratio = covered / bare;
  assert(
    Math.abs(ratio - 0.8) < 0.02,
    `毒液位移应约为裸地的 0.8，实际 ${ratio.toFixed(3)}`,
  );
});

scenario("腐蚀者：射程内吐毒，死亡在尸体位置留下大毒团", () => {
  const spit = effectiveZombie(ZOMBIE_IDS.corroder).spit!;
  const world = new World(mapDef({ id: "t-corroder" }));
  const h = world.spawnHuman(600, 360, "mg");
  h.manual = true;
  h.moveX = 0;
  h.moveY = 0;
  const z = world.spawnZombie(780, 360, ZOMBIE_IDS.corroder);
  z.hp = z.maxHp = 1000;
  z.speed = 38;
  world.rebuildGrids();

  updateZombies(world, 1 / 60);
  assert(world.poison.length === 1, "腐蚀者应在 200px 射程内立即吐毒");
  const pool = world.poison[0];
  assert(
    Math.abs(pool.x - h.x) < 1 && Math.abs(pool.y - h.y) < 1,
    `毒液落点应贴近目标人类，实际 (${pool.x.toFixed(1)}, ${pool.y.toFixed(1)})`,
  );
  assert(
    pool.radius === spit.radius &&
      pool.dps === spit.dps &&
      Math.abs(pool.remaining - spit.duration) < 1e-6,
    "吐出毒液的半径 / 伤害 / 持续时间应与定义文件一致",
  );
  assert(z.spit > spit.cooldown - 0.1, "吐毒后应进入完整冷却");

  damageZombie(world, z, z.hp + 10);
  assert(!z.alive, "腐蚀者应被击杀");
  const dead = world.poison.find(
    (p) => Math.hypot(p.x - z.x, p.y - z.y) < 1,
  );
  assert(dead !== undefined, "腐蚀者死亡应在尸体位置留下毒液");
  assert(
    dead!.radius === spit.deathRadius &&
      Math.abs(dead!.remaining - spit.deathDuration) < 1e-6,
    "死亡毒液的半径 / 持续时间应与定义文件一致",
  );
});

/** 推进若干秒僵尸行为（固定 60Hz，和游戏主循环口径一致） */
function stepZombies(world: World, seconds: number): void {
  const dt = 1 / 60;
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) updateZombies(world, dt);
}

/** 某只母体当前存活的子体数量 */
function childCount(world: World, mother: Zombie): number {
  return world.zombies.filter((z) => z.alive && z.spawnedBy === mother.id).length;
}

scenario("母体：产卵节奏、子体同屏上限与不撕咬人类", () => {
  const world = new World(mapDef({ id: "t-matriarch" }));
  const m = world.spawnZombie(592, 360, ZOMBIE_IDS.matriarch);
  m.speed = 0;

  stepZombies(world, 5.5);
  assert(childCount(world, m) === 0, "母体在 6 秒前不应产卵");
  stepZombies(world, 0.6);
  assert(childCount(world, m) === 2, `首轮应产 2 只，实际 ${childCount(world, m)}`);

  stepZombies(world, 24);
  assert(childCount(world, m) === 10, `子体同屏上限应为 10，实际 ${childCount(world, m)}`);
  stepZombies(world, 12);
  assert(childCount(world, m) === 10, "达到上限后不应继续增加子体");

  // 清掉子体并把撕咬伤害临时调高：母体依然不能主动攻击人类
  for (const z of world.zombies) if (z !== m) z.alive = false;
  m.spawnerTimer = 9999;
  m.damage = 50;
  const h = world.spawnHuman(m.x + 10, m.y, "mg");
  h.hp = 100;
  stepZombies(world, 2);
  assert(h.hp === 100, "母体不应主动撕咬人类");
});

scenario("母体：死亡产出最后一波，子体经验按 70% 折算", () => {
  const world = new World(mapDef({ id: "t-matriarch-death" }));
  const m = world.spawnZombie(592, 360, ZOMBIE_IDS.matriarch);
  damageZombie(world, m, m.hp + 1);
  const children = world.zombies.filter((z) => z.alive && z.spawnedBy === m.id);
  assert(children.length === 12, `死亡应产 12 只，实际 ${children.length}`);
  assert(children.every((z) => z.xpMul === 0.7), "母体子体的经验倍率应为 0.7");
  assert(
    Math.abs(survivalXpFor(ZOMBIE_IDS.normal, 0.7) - 0.7) < 1e-9,
    "普通子体经验应为正常值的 70%",
  );
  assert(
    Math.abs(survivalXpFor(ZOMBIE_IDS.matriarch, 0.7) - 28) < 1e-9,
    "母体经验应按 40 的 70% 折算",
  );
});

scenario("尖叫者：强化移速 / 攻击 / 承伤，且不强化 BOSS 与自己", () => {
  const world = new World(mapDef({ id: "t-scream" }));
  const s = world.spawnZombie(592, 360, ZOMBIE_IDS.screamer);
  s.speed = 0;
  const n = world.spawnZombie(620, 360, ZOMBIE_IDS.normal);
  n.speed = 0;
  n.maxHp = 100;
  n.hp = 100;
  const m = world.spawnZombie(640, 360, ZOMBIE_IDS.matriarch);
  m.speed = 0;
  m.spawnerTimer = 9999;
  const far = world.spawnZombie(900, 600, ZOMBIE_IDS.normal);
  far.speed = 0;

  s.screamTimer = 1 / 60;
  updateZombies(world, 1 / 60);
  assert(n.buffTimer > 5.9, "半径内的僵尸应获得 6 秒强化");
  assert(Math.abs(n.buffSpeedMul - 1.3) < 1e-9, "强化移速应为 +30%");
  assert(Math.abs(n.buffDamageMul - 1.5) < 1e-9, "强化攻击力应为 +50%");
  assert(Math.abs(n.buffTakenMul - 0.7) < 1e-9, "强化受伤减免应为 30%");
  assert(m.buffTimer === 0, "母体（BOSS）不应被尖叫强化");
  assert(s.buffTimer === 0, "尖叫者不应强化自己");
  assert(far.buffTimer === 0, "半径外的僵尸不应被强化");

  damageZombie(world, n, 10);
  assert(Math.abs(n.hp - 93) < 1e-6, `强化后 10 点伤害应只扣 7 点，实际剩余 ${n.hp}`);
});

scenario("求生池守卫：所有僵尸 / 武器均已登记，模式覆盖表只在求生生效", () => {
  // 新增僵尸漏登记出怪权重表或 BOSS 池、新增武器漏登记武器池，这里直接失败
  const bossKinds = new Set(SURVIVAL_BOSS_POOL.map((b) => b.kind));
  for (const id of Object.values(ZOMBIE_IDS)) {
    assert(
      SURVIVAL_ZOMBIE_WEIGHTS.some((row) => row.kind === id) || bossKinds.has(id),
      `僵尸 ${id} 未登记求生出怪权重表或 BOSS 池`,
    );
  }
  for (const id of Object.values(WEAPON_IDS)) {
    assert(SURVIVAL_WEAPON_POOL.includes(id), `武器 ${id} 未登记求生武器池`);
  }
  for (const boss of SURVIVAL_BOSS_POOL) {
    assert(
      !SURVIVAL_ZOMBIE_WEIGHTS.some((row) => row.kind === boss.kind),
      `BOSS ${boss.kind} 不应同时出现在普通出怪权重表`,
    );
    assert(
      effectiveZombie(boss.kind).boss === true,
      `BOSS 池里的 ${boss.kind} 必须在定义文件标记 boss`,
    );
  }

  // 覆盖表：求生飞扑者压制 1.5 秒 / 4 DPS，腐蚀者毒液 4 DPS；切回基础模式回退定义值
  setZombieModeOverrides(SURVIVAL_ZOMBIE_OVERRIDES);
  try {
    const leap = effectiveZombie(ZOMBIE_IDS.leaper).leap!;
    assert(
      leap.pinDuration === 1.5 && leap.pinDps === 4,
      `求生飞扑者压制应为 1.5 秒 / 4 DPS，实际 ${leap.pinDuration} / ${leap.pinDps}`,
    );
    const spit = effectiveZombie(ZOMBIE_IDS.corroder).spit!;
    assert(spit.dps === 4, `求生腐蚀者毒液应为 4 DPS，实际 ${spit.dps}`);
    assert(leap.chargeTime === 0.8, `覆盖表不应改写未覆盖的蓄力时长，实际 ${leap.chargeTime}`);
  } finally {
    setZombieModeOverrides(null);
  }
  const leapBase = effectiveZombie(ZOMBIE_IDS.leaper).leap!;
  assert(
    leapBase.pinDuration === 3 && leapBase.pinDps === 8,
    `基础模式应回退 3 秒 / 8 DPS，实际 ${leapBase.pinDuration} / ${leapBase.pinDps}`,
  );
  assert(effectiveZombie(ZOMBIE_IDS.corroder).spit!.dps === 6, "基础模式毒液应回退 6 DPS");
});

// ============================================================
// 入口
// ============================================================

export async function runScenarios(): Promise<number> {
  console.log(`\n[regression] 共 ${scenarios.length} 个场景\n`);
  let failed = 0;
  for (const item of scenarios) {
    try {
      item.run();
      console.log(`  ✓ ${item.name}`);
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ✗ ${item.name}`);
      console.log(`      ${msg}`);
    }
  }
  console.log(
    `\n[regression] ${scenarios.length - failed} 通过 / ${failed} 失败\n`,
  );
  return failed;
}

/** 兼容直接 import 使用：只有显式调用 runScenarios 才会执行 */
export default runScenarios;
