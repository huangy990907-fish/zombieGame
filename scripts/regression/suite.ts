/**
 * 回归场景：直接加载真实的 src 模块，覆盖 0.8.0 的关键规则。
 *
 * 由 run.mjs 用 esbuild 打包后执行；每个场景失败只影响自己的断言，
 * 汇总后统一打印失败场景名，并让入口以非零退出码结束。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MapDef, OpeningDef, Rect, SpawnRegion } from "../../src/data/types";
import { HUMAN_DEF } from "../../src/data/humans";
import { TERRAIN } from "../../src/data/terrain";
import { WEAPON_LIST } from "../../src/data/weapons";
import { ZOMBIE_IDS } from "../../src/data/zombies";
import { effectiveWeapon } from "../../src/data/settings/runtime";
import { compileTilesToMapDef } from "../../src/data/maps/compile";
import { validateMapJson } from "../../src/data/maps/schema";
import { validateLevelJson } from "../../src/data/levels/schema";
import { registerRuntimeMap } from "../../src/data/maps";
import { World } from "../../src/core/world";
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
  teslaWorld.spawnZombie(340, 300, ZOMBIE_IDS.normal);
  teslaWorld.rebuildGrids();
  tryFire(teslaWorld, teslaHuman, 0, 0);
  const arcs = teslaWorld.effects.filter((e) => e.kind === "arc").length;
  assert(arcs === 2, `电击枪 1 层额外应产生 2 道电弧，实际 ${arcs}`);

  const singleWorld = new World(mapDef({ id: "t-extra-tesla-single" }));
  const singleHuman = singleWorld.spawnHuman(300, 300, "tesla");
  singleWorld.spawnZombie(340, 300, ZOMBIE_IDS.normal);
  singleWorld.rebuildGrids();
  tryFire(singleWorld, singleHuman, 0, 0);
  const singleArcs = singleWorld.effects.filter((e) => e.kind === "arc").length;
  assert(singleArcs === 1, `无额外层数时电击枪应只有 1 道电弧，实际 ${singleArcs}`);
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
