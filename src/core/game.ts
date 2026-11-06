/**
 * Game —— 游戏流程调度器（波次状态机 + 每帧逻辑编排）。
 *
 * 每帧调用顺序：
 *   spawnTick(补尸潮) -> rebuildGrids(重建空间索引)
 *   -> updateHumans -> updateZombies -> updateCombat
 *   -> ageEffects / compact(清扫) -> 波次结算
 *
 * 只负责“何时生成、何时结束”，具体行为在 systems/ 下。
 */
import { updateHumans, updateZombies } from "../systems/ai";
import { updateCombat } from "../systems/combat";
import { sound, SFX } from "../audio/manager";
import { DEFAULT_MAP, resolveMap, type MapDef } from "../data/maps";
import { applySettings, settings } from "../data/settings/runtime";
import type { HumanMode, SettingsOverrides } from "../data/types";
import { LOADOUT, WEAPON_IDS } from "../data/weapons";
import { ZOMBIE_IDS } from "../data/zombies";
import { findLevel } from "../levels";
import { randRange } from "../utils/math";
import type { Post } from "./world";
import { createWorld } from "./world";

export type Phase = "wave" | "intermission" | "victory" | "defeat";

export class Game {
  /** 当前地图；随 start() 按关卡 mapId / 显式选择切换 */
  map: MapDef = DEFAULT_MAP;
  world = createWorld(this.map);
  /** 当前关卡 id，undefined = 还没选关卡 */
  levelId: string | undefined = undefined;
  /** 构造 / start 时显式指定的地图（直接传 MapDef 时保留引用，供未注册的自定义图使用） */
  private preferredMap: MapDef | undefined = undefined;
  /** 构造 / start 时显式指定的地图 id（优先于关卡 mapId，供调试与后续选图用） */
  private preferredMapId: string | undefined = undefined;
  /** 最近一次地图解析是否发生回退（main.ts 据此给出可见提示） */
  mapFallback = false;
  /** 最近一次请求的地图 id（回退时用于提示） */
  requestedMapId: string | undefined = undefined;
  /** 当前波次，1 开始 */
  wave = 0;
  phase: Phase = "intermission";
  paused = false;
  /** 速度倍率 1 / 2 / 4 / 8 */
  speed = 1;
  /** 人类行为模式，顶栏按钮实时切换；重开不清除 */
  mode: HumanMode = "defend";
  /** 本波还剩多少丧尸没入场 */
  spawnLeft = 0;
  /** 本波还没入场的狂奔丧尸数量 */
  runnersLeft = 0;
  spawnTimer = 0;
  /** 波间隔倒计时 */
  countdown = 1.5;
  /** 本波丧尸总数（HUD 显示用） */
  waveSize = 0;
  elapsed = 0;

  /**
   * @param mapOrId 初始地图；可传 MapDef 或地图 id。省略时用默认地图。
   *               id 不存在会回退默认图，并置 mapFallback 供上层提示。
   */
  constructor(mapOrId?: MapDef | string) {
    if (typeof mapOrId === "string") this.preferredMapId = mapOrId;
    else if (mapOrId) this.preferredMap = mapOrId;
    this.applyMap(mapOrId ?? DEFAULT_MAP);
    // 不自动 start() —— main.ts 在路由跳转到 play 时显式调 start(levelId)
    // 这样关卡 settings 才有机会在 World 构造前被 apply
  }

  /** 解析并记录地图；World 在构造 / start 处按新地图重建 */
  private applyMap(mapOrId: MapDef | string): void {
    const resolved = resolveMap(mapOrId);
    this.map = resolved.map;
    this.mapFallback = resolved.fallback;
    this.requestedMapId = resolved.requestedId;
  }

  /**
   * 开始 / 重开一局。
   * @param levelId 当前关卡 id；后续重开（顶栏按钮）可省略，沿用上次关卡
   * @param levelSettings 该关卡对设置的覆盖（可选）
   */
  start(levelId?: string, levelSettings?: SettingsOverrides): void {
    if (levelId) this.levelId = levelId;
    // 优先级：显式选择（构造参数）> 关卡 mapId > 当前地图（保留未注册的自定义图）
    const level = this.levelId ? findLevel(this.levelId) : undefined;
    this.applyMap(this.preferredMap ?? this.preferredMapId ?? level?.mapId ?? this.map);
    if (levelSettings) applySettings(levelSettings);

    this.world = createWorld(this.map);
    this.wave = 0;
    this.phase = "intermission";
    this.paused = false;
    this.speed = 1;
    this.spawnLeft = 0;
    this.runnersLeft = 0;
    this.spawnTimer = 0;
    this.countdown = 1.5;
    this.waveSize = 0;
    this.elapsed = 0;
    this.spawnInitialHumans();
    this.assignPosts();
  }

  /** 按 LOADOUT 配比生成初始人类，并按当前初始人数做归一化 */
  private spawnInitialHumans(): void {
    const total = settings().human.start;
    const loadoutSum = LOADOUT.reduce((a, b) => a + b.count, 0) || 1;
    const roster: string[] = [];
    for (const entry of LOADOUT) {
      const n = Math.round((entry.count / loadoutSum) * total);
      for (let i = 0; i < n; i++) roster.push(entry.id);
    }
    // 四舍五入可能差 1-2 个，补齐
    while (roster.length < total) roster.push(LOADOUT[0].id);
    while (roster.length > total) roster.pop();
    for (let i = roster.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = roster[i];
      roster[i] = roster[j];
      roster[j] = tmp;
    }
    const bounds = this.map.humanBounds;
    for (const w of roster) {
      this.world.spawnHuman(
        randRange(bounds.x0, bounds.x1),
        randRange(bounds.y0, bounds.y1),
        w,
      );
    }
  }

  /**
   * 防守分岗：门是主动脉（走廊出生的丧尸全走门），配 32 人重兵
   * （喷火 + 霰弹 + 大量机枪），每扇窗 4 个机枪岗（隔玻璃点射 +
   * 窗檐减速的漏网），剩下的火箭/机枪进中央预备队线。
   * 窗净宽 18px 后火力线从 6 人收窄到 4 人（间距 12px = 人类身体直径），
   * 省下的 4 人补进预备队，总岗位数仍与开局人数对齐。
   * 岗位坐标按开口位置摊开，(ox,oy) 记下各自看守的开口中心。
   */
  private assignPosts(): void {
    const ws = this.world;
    ws.posts.length = 0;
    const door = ws.openings[0];
    const wins = [ws.openings[1], ws.openings[2]];

    // 门口：散兵线离门 90px —— 僵尸出 door 后要在火线上跑约 2 秒才摸到人，
    // 这段“通过时间”就是门口火力杀伤的窗口
    const doorPosts: Post[] = [];
    const postX = door.rect.x + door.rect.w + 90;
    const doorCx = door.rect.x + door.rect.w * 0.5;
    const doorCy = door.rect.y + door.rect.h * 0.5;
    for (let i = 0; i < 32; i++) {
      doorPosts.push({
        x: postX + randRange(-4, 4),
        y: door.rect.y - 8 + (i * (door.rect.h + 16)) / 31,
        ox: doorCx,
        oy: doorCy,
      });
    }

    // 窗口：紧贴窗洞正后方排开（横向 ±18px），偏太多子弹会被墙沿挡住
    const winPosts: Post[] = [];
    for (const w of wins) {
      const wcx = w.rect.x + w.rect.w * 0.5;
      const wcy = w.rect.y + w.rect.h * 0.5;
      const inward = w.rect.y < 360 ? 1 : -1; // 顶窗往房间里(+y)，底窗往上(-y)
      const postY = wcy + inward * 40;
      for (let i = 0; i < 4; i++) {
        winPosts.push({
          x: wcx + (i - 1.5) * 12 + randRange(-2, 2),
          y: postY + randRange(-2, 2),
          ox: wcx,
          oy: wcy,
        });
      }
    }

    ws.posts.push(...doorPosts, ...winPosts);

    // 中央预备队线：房间中部作第二道防线，不主动出击
    // 窗口缩编后空出的 4 人补到这里（6 → 10），总岗位数仍为 50
    const reservePosts: Post[] = [];
    for (let i = 0; i < 10; i++) {
      reservePosts.push({
        x: 620 + (i % 2) * 70 + randRange(-3, 3),
        y: 210 + Math.floor(i / 2) * 70 + randRange(-3, 3),
        ox: doorCx,
        oy: doorCy,
      });
    }
    ws.posts.push(...reservePosts);

    // 分岗顺序：喷火/霰弹 守门 -> 机枪填门岗缺额 ->
    // 其余武器（火箭/电击枪/剩余机枪）补窗岗 -> 再剩下的进预备队
    let di = 0;
    let wi = 0;
    let ri = 0;
    for (const h of ws.humans) {
      if ((h.weapon === WEAPON_IDS.flame || h.weapon === WEAPON_IDS.shotgun) && di < doorPosts.length) {
        h.post = di++;
      } else if (h.weapon === WEAPON_IDS.mg && di < doorPosts.length) {
        h.post = di++;
      } else if (wi < winPosts.length) {
        h.post = doorPosts.length + wi++;
      } else if (ri < reservePosts.length) {
        h.post = doorPosts.length + winPosts.length + ri++;
      }
    }
  }

  /** 开始第 n 波：算本波规模、狂奔占比，并补充少量兵员 */
  private beginWave(n: number): void {
    this.wave = n;
    const s = settings().wave;
    this.waveSize = Math.round(s.base * Math.pow(s.growth, n - 1));
    this.spawnLeft = this.waveSize;
    this.runnersLeft = Math.round(this.waveSize * Math.min(0.55, 0.25 + n * 0.015));
    this.spawnTimer = 0;
    this.phase = "wave";
    sound.play(SFX.WAVE_START);

    // 每波少量补充兵员，避免被一波打崩后彻底没法看
    const bounds = this.map.humanBounds;
    const add = Math.min(s.reinforce, Math.max(0, settings().human.cap - this.world.humans.length));
    for (let i = 0; i < add; i++) {
      this.world.spawnHuman(
        randRange(bounds.x0, bounds.x1),
        randRange(bounds.y0, bounds.y1),
        this.randomWeapon(),
      );
    }
  }

  /** 按 LOADOUT 配比随机抽一个兵种 id */
  private randomWeapon(): string {
    const total = LOADOUT.reduce((a, b) => a + b.count, 0);
    let r = Math.random() * total;
    for (const entry of LOADOUT) {
      r -= entry.count;
      if (r <= 0) return entry.id;
    }
    return LOADOUT[0].id;
  }

  /** 生成一只丧尸：按剩余比例决定普通/狂奔，血量随波次上浮 */
  private spawnOne(): void {
    let kind = ZOMBIE_IDS.normal;
    if (this.runnersLeft > 0) {
      const odds = this.runnersLeft / Math.max(1, this.spawnLeft);
      if (Math.random() < odds) {
        kind = ZOMBIE_IDS.runner;
        this.runnersLeft--;
      }
    }
    // 出生点：一半走左走廊冲门，另一半从上、下两侧逼近窗户
    const r = Math.random();
    const top = this.map.windowSpawn.top;
    const bottom = this.map.windowSpawn.bottom;
    const left = this.map.spawn;
    let x: number;
    let y: number;
    if (r < 0.25) {
      x = randRange(top.x0, top.x1);
      y = randRange(top.y0, top.y1);
    } else if (r < 0.5) {
      x = randRange(bottom.x0, bottom.x1);
      y = randRange(bottom.y0, bottom.y1);
    } else {
      x = randRange(left.x0, left.x1);
      y = randRange(left.y0, left.y1);
    }
    this.world.spawnZombie(x, y, kind, 1 + (this.wave - 1) * 0.05);
  }

  /** 按固定速率往场里放丧尸，超出同屏上限则暂缓 */
  private spawnTick(dt: number): void {
    if (this.spawnLeft <= 0) return;
    this.spawnTimer -= dt;
    const s = settings().wave;
    const interval = 1 / Math.min(s.spawnMax, s.spawnBase + this.wave * s.spawnPerWave);
    let guard = 0;
    while (
      this.spawnTimer <= 0 &&
      this.spawnLeft > 0 &&
      this.world.zombies.length < s.maxAlive &&
      guard++ < 12
    ) {
      this.spawnOne();
      this.spawnLeft--;
      this.spawnTimer += interval;
    }
    if (this.spawnTimer < 0) this.spawnTimer = 0;
  }

  /** 逻辑主循环，固定 dt = 1/60 秒，由 main.ts 的累加器驱动 */
  tick(dt: number): void {
    this.elapsed += dt;
    this.world.time += dt;
    this.world.mode = this.mode;

    if (this.phase === "wave") this.spawnTick(dt);

    this.world.rebuildGrids();
    updateHumans(this.world, dt);
    updateZombies(this.world, dt);
    updateCombat(this.world, dt);
    this.world.ageEffects(dt);
    this.world.compact();

    if (this.phase === "wave") {
      if (this.world.humans.length === 0) {
        this.phase = "defeat";
        sound.play(SFX.DEFEAT);
        return;
      }
      if (this.spawnLeft === 0 && this.world.zombies.length === 0) {
        if (this.wave >= settings().wave.count) {
          this.phase = "victory";
          sound.play(SFX.VICTORY);
        } else {
          this.phase = "intermission";
          this.countdown = 1.8;
        }
      }
    } else if (this.phase === "intermission") {
      this.countdown -= dt;
      if (this.countdown <= 0) this.beginWave(this.wave + 1);
    }
  }

  /** 统计存活人类按兵种 id 的数量，HUD 底栏显示用 */
  aliveByWeapon(): Map<string, number> {
    const out = new Map<string, number>();
    for (let i = 0; i < this.world.humans.length; i++) {
      const id = this.world.humans[i].weapon;
      out.set(id, (out.get(id) ?? 0) + 1);
    }
    return out;
  }
}
