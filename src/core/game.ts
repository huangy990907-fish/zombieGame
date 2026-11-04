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
import {
  applySettings,
  HUMAN_BOUNDS,
  LOADOUT,
  SETTINGS,
  SPAWN,
} from "../config";
import type { HumanMode, Settings } from "../config";
import { randRange } from "../utils/math";
import type { Post } from "./world";
import { World } from "./world";

export type Phase = "wave" | "intermission" | "victory" | "defeat";

export class Game {
  world = new World();
  /** 当前关卡 id，undefined = 还没选关卡 */
  levelId: string | undefined = undefined;
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

  constructor() {
    // 不自动 start() —— main.ts 在路由跳转到 play 时显式调 start(levelId)
    // 这样关卡 settings 才有机会在 World 构造前被 apply
  }

  /**
   * 开始 / 重开一局。
   * @param levelId 当前关卡 id；后续重开（顶栏按钮）可省略，沿用上次关卡
   * @param levelSettings 该关卡对 SETTINGS 的覆盖（可选）
   */
  start(levelId?: string, levelSettings?: Partial<Settings>): void {
    if (levelId) this.levelId = levelId;
    if (levelSettings) applySettings(levelSettings);

    this.world = new World();
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

  /** 按 LOADOUT 配比生成初始人类，并按 SETTINGS.human.start 做归一化 */
  private spawnInitialHumans(): void {
    const total = SETTINGS.human.start;
    const loadoutSum = LOADOUT.reduce((a, b) => a + b, 0) || 1;
    const roster: number[] = [];
    for (let w = 0; w < LOADOUT.length; w++) {
      const n = Math.round((LOADOUT[w] / loadoutSum) * total);
      for (let i = 0; i < n; i++) roster.push(w);
    }
    // 四舍五入可能差 1-2 个，补齐
    while (roster.length < total) roster.push(0);
    while (roster.length > total) roster.pop();
    for (let i = roster.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = roster[i];
      roster[i] = roster[j];
      roster[j] = tmp;
    }
    for (const w of roster) {
      this.world.spawnHuman(
        randRange(HUMAN_BOUNDS.x0, HUMAN_BOUNDS.x1),
        randRange(HUMAN_BOUNDS.y0, HUMAN_BOUNDS.y1),
        w,
      );
    }
  }

  /**
   * 防守分岗：门是主动脉（走廊出生的丧尸全走门），配 32 人重兵
   * （喷火 + 霰弹 + 大量机枪），每扇窗 6 个机枪岗（隔玻璃点射 +
   * 窗檐减速的漏网），剩下的火箭/机枪进中央预备队线。
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

    // 窗口：紧贴窗洞正后方排开（横向 ±32px），偏太多子弹会被墙沿挡住
    const winPosts: Post[] = [];
    for (const w of wins) {
      const wcx = w.rect.x + w.rect.w * 0.5;
      const wcy = w.rect.y + w.rect.h * 0.5;
      const inward = w.rect.y < 360 ? 1 : -1; // 顶窗往房间里(+y)，底窗往上(-y)
      const postY = wcy + inward * 40;
      for (let i = 0; i < 6; i++) {
        winPosts.push({
          x: wcx + (i - 2.5) * 13 + randRange(-2, 2),
          y: postY + randRange(-2, 2),
          ox: wcx,
          oy: wcy,
        });
      }
    }

    ws.posts.push(...doorPosts, ...winPosts);

    // 中央预备队线：房间中部作第二道防线，不主动出击
    const reservePosts: Post[] = [];
    for (let i = 0; i < 6; i++) {
      reservePosts.push({
        x: 620 + (i % 2) * 70 + randRange(-3, 3),
        y: 210 + Math.floor(i / 2) * 70 + randRange(-3, 3),
        ox: doorCx,
        oy: doorCy,
      });
    }
    ws.posts.push(...reservePosts);

    // 分岗顺序：喷火(1)/霰弹(2) 守门 -> 机枪(0) 填门岗缺额 -> 火箭(3)/
    // 剩余机枪 守窗 -> 再剩下的进预备队
    let di = 0;
    let wi = 0;
    let ri = 0;
    for (const h of ws.humans) {
      if ((h.weapon === 1 || h.weapon === 2) && di < doorPosts.length) {
        h.post = di++;
      } else if (h.weapon === 0 && di < doorPosts.length) {
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
    const s = SETTINGS.wave;
    this.waveSize = Math.round(s.base * Math.pow(s.growth, n - 1));
    this.spawnLeft = this.waveSize;
    this.runnersLeft = Math.round(this.waveSize * Math.min(0.55, 0.25 + n * 0.015));
    this.spawnTimer = 0;
    this.phase = "wave";
    sound.play(SFX.WAVE_START);

    // 每波少量补充兵员，避免被一波打崩后彻底没法看
    const add = Math.min(s.reinforce, Math.max(0, SETTINGS.human.cap - this.world.humans.length));
    for (let i = 0; i < add; i++) {
      this.world.spawnHuman(
        randRange(HUMAN_BOUNDS.x0, HUMAN_BOUNDS.x1),
        randRange(HUMAN_BOUNDS.y0, HUMAN_BOUNDS.y1),
        this.randomWeapon(),
      );
    }
  }

  /** 按 LOADOUT 配比随机抽一个兵种 */
  private randomWeapon(): number {
    const total = LOADOUT.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < LOADOUT.length; i++) {
      r -= LOADOUT[i];
      if (r <= 0) return i;
    }
    return 0;
  }

  /** 生成一只丧尸：按剩余比例决定普通/狂奔，血量随波次上浮 */
  private spawnOne(): void {
    let kind: 0 | 1 = 0;
    if (this.runnersLeft > 0) {
      const odds = this.runnersLeft / Math.max(1, this.spawnLeft);
      if (Math.random() < odds) {
        kind = 1;
        this.runnersLeft--;
      }
    }
    // 出生点：一半走左走廊冲门，另一半从上、下两侧逼近窗户
    const r = Math.random();
    let x: number;
    let y: number;
    if (r < 0.25) {
      x = randRange(360, 1000);
      y = randRange(6, 52);
    } else if (r < 0.5) {
      x = randRange(360, 1000);
      y = randRange(668, 714);
    } else {
      x = randRange(SPAWN.x0, SPAWN.x1);
      y = randRange(SPAWN.y0, SPAWN.y1);
    }
    this.world.spawnZombie(x, y, kind, 1 + (this.wave - 1) * 0.05);
  }

  /** 按固定速率往场里放丧尸，超出同屏上限则暂缓 */
  private spawnTick(dt: number): void {
    if (this.spawnLeft <= 0) return;
    this.spawnTimer -= dt;
    const s = SETTINGS.wave;
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
        if (this.wave >= SETTINGS.wave.count) {
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

  /** 统计存活人类按兵种的数量，HUD 底栏显示用 */
  aliveByWeapon(): number[] {
    const out = new Array(LOADOUT.length).fill(0) as number[];
    for (let i = 0; i < this.world.humans.length; i++) {
      out[this.world.humans[i].weapon]++;
    }
    return out;
  }
}
