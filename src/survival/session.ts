/**
 * 「尸潮求生」会话 —— 单角色 Roguelike 生存。
 *
 * 复用正式玩法的 World / AI / 战斗 / 碰撞：本类只负责
 *  - 玩家操控（输入写进 Human.manual + moveX/moveY）
 *  - 距离 / 屏幕外 / 可通行的出怪选点
 *  - 时间档位、等级权重、经验球、升级三选一
 *  - 失败与两项记录（最佳存活时间 / 最高等级）
 */
import { HUMAN_DEF } from "../data/humans";
import { resolveMap, type MapDef } from "../data/maps";
import { effectiveHuman, effectiveWeapon, setZombieModeOverrides } from "../data/settings/runtime";
import {
  SURVIVAL,
  SURVIVAL_WEAPON_POOL,
  SURVIVAL_XP_BY_KIND,
  SURVIVAL_ZOMBIE_OVERRIDES,
  SURVIVAL_ZOMBIE_WEIGHTS,
  xpNeedFor,
  type SurvivalUpgradeDef,
} from "../data/survival/config";
import { ZOMBIE_IDS, getZombieDef, zombieBodyDiameter } from "../data/zombies";
import type { SpawnRegion } from "../data/types";
import { createWorld, type Human, type World, type Zombie } from "../core/world";
import { updateHumans, updateZombies } from "../systems/ai";
import { updateCombat } from "../systems/combat";
import { sound, SFX } from "../audio/manager";
import { clamp, randRange } from "../utils/math";
import { loadSurvivalRecord, saveSurvivalRecord, type SurvivalRecord } from "./storage";

export type SurvivalState = "idle" | "playing" | "paused" | "choosing" | "defeat";

export interface SurvivalOrb {
  x: number;
  y: number;
  radius: number;
  /** 拾取时获得的经验值（胖子等大型目标更高） */
  value: number;
}

export class SurvivalSession {
  map: MapDef;
  world: World;
  player: Human | undefined = undefined;

  state: SurvivalState = "idle";
  elapsed = 0;
  level = 1;
  xp = 0;
  xpNeed = xpNeedFor(1);
  /** 升到新等级后等待选择的数量（连续升级会排队） */
  pendingLevelUps = 0;
  /** 当前三选一候选 */
  choices: SurvivalUpgradeDef[] = [];
  /** 抽到「获得新武器」后的二段候选（未持有武器 id） */
  weaponPicks: string[] = [];
  /** 抽卡序号：每次重抽 +1，UI 用它区分“id 与顺序恰好相同”的两次独立结果 */
  choiceSeq = 0;
  record: SurvivalRecord = loadSurvivalRecord();

  private baseHp = HUMAN_DEF.hp;
  private attackMul = 1;
  private fireRateMul = 1;
  private maxHpBonus = 0;
  private moveMul = 1;
  private weaponLevel = 1;
  private ownedWeapons: string[] = [SURVIVAL.weapon];
  private extraProjectiles = 0;
  private critChance = 0;
  private critMul = SURVIVAL.baseCritMul;
  private lifesteal = 0;
  private pickupMul = SURVIVAL.basePickupMul;

  private inputX = 0;
  private inputY = 0;
  private spawnTimer = 0;
  private orbs: SurvivalOrb[] = [];
  private readonly area: SpawnRegion;

  constructor() {
    const resolved = resolveMap(SURVIVAL.defaultMapId);
    this.map = resolved.map;
    this.world = createWorld(this.map);
    const pad = SURVIVAL.spawn.areaPad;
    this.area = { x0: pad, y0: pad, x1: this.map.width - pad, y1: this.map.height - pad };
  }

  get kills(): number {
    return this.world.kills;
  }

  get maxHp(): number {
    return this.player?.maxHp ?? this.baseHp;
  }

  get hp(): number {
    return this.player?.hp ?? 0;
  }

  get weaponLevelMax(): number {
    return SURVIVAL.weaponLevels.length;
  }

  /** 已持有武器 id（主武器在前；最多 2 把） */
  get weapons(): string[] {
    return this.ownedWeapons.slice();
  }

  /** 第二把武器 id；未持有时 null */
  get secondaryWeapon(): string | null {
    return this.ownedWeapons.length > 1 ? this.ownedWeapons[1] : null;
  }

  /** 是否还能再拿一把武器 */
  get canTakeWeapon(): boolean {
    return this.ownedWeapons.length < SURVIVAL.maxWeapons;
  }

  /** 开始 / 重开一局；记录不重置 */
  start(mapOrId?: string): void {
    // 求生有独立平衡：进入模式即启用覆盖表，离开时由 stop() 清空
    setZombieModeOverrides(SURVIVAL_ZOMBIE_OVERRIDES);
    this.map = resolveMap(mapOrId ?? this.map.id).map;
    this.world = createWorld(this.map);
    this.elapsed = 0;
    this.level = 1;
    this.xp = 0;
    this.xpNeed = xpNeedFor(1);
    this.pendingLevelUps = 0;
    this.choices = [];
    this.weaponPicks = [];
    this.choiceSeq = 0;
    this.attackMul = 1;
    this.fireRateMul = 1;
    this.maxHpBonus = 0;
    this.moveMul = 1;
    this.weaponLevel = 1;
    this.ownedWeapons = [SURVIVAL.weapon];
    this.extraProjectiles = 0;
    this.critChance = 0;
    this.critMul = SURVIVAL.baseCritMul;
    this.lifesteal = 0;
    this.pickupMul = SURVIVAL.basePickupMul;
    this.inputX = 0;
    this.inputY = 0;
    this.spawnTimer = SURVIVAL.spawn.initialDelay;
    this.orbs = [];
    this.record = loadSurvivalRecord();

    const spot = this.findSpawnPoint();
    const baseHp = effectiveHuman().hp;
    this.baseHp = baseHp;
    const player = this.world.spawnHuman(spot.x, spot.y, SURVIVAL.weapon, baseHp);
    player.manual = true;
    player.moveX = 0;
    player.moveY = 0;
    player.spreadOverride = SURVIVAL.weaponSpread;
    player.damageTakenMul = SURVIVAL.damageTakenMul;
    player.maxHp = baseHp;
    player.hp = baseHp;
    this.player = player;
    this.syncPlayerStats();

    this.world.onKill = (z) => this.onZombieKilled(z);
    this.state = "playing";
  }

  /** 重开当前地图 */
  restart(): void {
    this.start(this.map.id);
  }

  /** 离开路由：停止推进，保留最后画面做背景；同时撤销求生专属数值覆盖 */
  stop(): void {
    this.state = "idle";
    this.inputX = 0;
    this.inputY = 0;
    this.choices = [];
    this.pendingLevelUps = 0;
    setZombieModeOverrides(null);
  }

  /** WASD / 方向键输入（-1..1），由入口每帧写入 */
  setInput(x: number, y: number): void {
    this.inputX = clamp(x, -1, 1);
    this.inputY = clamp(y, -1, 1);
  }

  togglePause(): void {
    if (this.state === "playing") this.state = "paused";
    else if (this.state === "paused") this.state = "playing";
  }

  /** 固定步长推进，只在 playing 时由入口调用 */
  tick(dt: number): void {
    if (this.state !== "playing") return;
    const player = this.player;
    if (!player) return;

    this.elapsed += dt;
    this.world.time += dt;
    player.moveX = this.inputX;
    player.moveY = this.inputY;

    this.world.rebuildGrids();
    updateHumans(this.world, dt);
    updateZombies(this.world, dt);
    updateCombat(this.world, dt);
    this.world.ageEffects(dt);
    this.world.tickTerrain(dt);
    this.world.compact();

    if (player.hp <= 0) {
      // 生存模式没有转化倒计时：血量归零立刻失败
      player.turning = 0;
      this.finish();
      return;
    }

    this.updateOrbs(dt);
    this.spawnTick(dt);

    if (this.pendingLevelUps > 0) this.beginChoice();
  }

  /** 选择一张升级卡；连续升级时继续弹下一组 */
  chooseUpgrade(id: string): void {
    if (this.state !== "choosing") return;
    const up = this.choices.find((c) => c.id === id);
    if (!up) return;
    // 「获得新武器」先进入第二段武器选择，不立即结算
    if (up.kind === "newWeapon") {
      const picks = this.rollWeaponPicks();
      if (picks.length === 0) return;
      this.weaponPicks = picks;
      this.choices = [];
      sound.play(SFX.UI_CLICK);
      return;
    }
    this.applyUpgrade(up);
    this.consumeChoice();
  }

  /** 二段武器选择：从 weaponPicks 里挑一把装备为副武器 */
  chooseWeapon(id: string): void {
    if (this.state !== "choosing") return;
    if (!this.weaponPicks.includes(id)) return;
    this.addWeapon(id);
    this.weaponPicks = [];
    this.consumeChoice();
  }

  /** 渲染层读取：经验球位置 */
  orbsForRender(): SurvivalOrb[] {
    return this.orbs;
  }

  /** 当前换弹进度（HUD / 头顶提示用）；不在换弹时返回 null */
  get reload(): { remaining: number; total: number } | null {
    const p = this.player;
    if (!p || !p.alive || p.reloadTimer <= 0) return null;
    const total = effectiveWeapon(p.weapon).reload;
    return { remaining: p.reloadTimer, total: total > 0 ? total : p.reloadTimer };
  }

  // ============================================================
  // 内部
  // ============================================================

  private findSpawnPoint(): { x: number; y: number } {
    const zones = this.map.humanZones;
    let cx = this.map.width * 0.5;
    let cy = this.map.height * 0.5;
    if (zones.length > 0) {
      // 多块人类区按面积加权求质心
      let total = 0;
      let sx = 0;
      let sy = 0;
      for (const z of zones) {
        const area = Math.max(0, (z.x1 - z.x0) * (z.y1 - z.y0));
        if (area <= 0) continue;
        total += area;
        sx += (z.x0 + z.x1) * 0.5 * area;
        sy += (z.y0 + z.y1) * 0.5 * area;
      }
      if (total > 0) {
        cx = sx / total;
        cy = sy / total;
      }
    }
    return (
      this.world.findFreeSpot(cx, cy, HUMAN_DEF.radius * 2, this.area) ?? { x: cx, y: cy }
    );
  }

  private syncPlayerStats(): void {
    const player = this.player;
    if (!player) return;
    const wl = SURVIVAL.weaponLevels[this.weaponLevel - 1] ?? SURVIVAL.weaponLevels[0];
    player.dmgMul = this.attackMul * wl.damage * SURVIVAL.baseDamageMul;
    player.cdMul = this.fireRateMul * wl.cooldown;
    player.speedOverride = effectiveHuman().speed * this.moveMul;
    player.maxHp = this.baseHp + this.maxHpBonus;
    player.hp = Math.min(player.hp, player.maxHp);
    player.extraProjectiles = this.extraProjectiles;
    player.critChance = this.critChance;
    player.critMul = this.critMul;
  }

  /** 结算一次已选升级：扣待选次数，继续弹下一组或恢复游戏 */
  private consumeChoice(): void {
    this.pendingLevelUps = Math.max(0, this.pendingLevelUps - 1);
    sound.play(SFX.UI_CLICK);
    this.weaponPicks = [];
    if (this.pendingLevelUps > 0) {
      this.choices = this.rollChoices();
    } else {
      this.choices = [];
      this.state = "playing";
    }
  }

  /** 未持有武器随机排序；抽到「获得新武器」时展示 */
  private rollWeaponPicks(): string[] {
    if (!this.canTakeWeapon) return [];
    const pool = SURVIVAL_WEAPON_POOL.filter((id) => !this.ownedWeapons.includes(id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool;
  }

  /** 装备副武器（最多 2 把）；弹药 / 冷却 / 换弹独立初始化 */
  private addWeapon(id: string): void {
    if (!this.canTakeWeapon || this.ownedWeapons.includes(id)) return;
    const player = this.player;
    this.ownedWeapons.push(id);
    if (player) {
      if (!player.weapon2) {
        const def = effectiveWeapon(id);
        player.weapon2 = id;
        player.ammo2 = def.magazine;
        player.fire2 = 0;
        player.reload2 = 0;
        player.burst2 = 0;
      }
      this.syncPlayerStats();
    }
  }

  private applyUpgrade(up: SurvivalUpgradeDef): void {
    switch (up.kind) {
      case "attack":
        this.attackMul += up.amount;
        break;
      case "fireRate":
        this.fireRateMul *= up.amount;
        break;
      case "maxHp": {
        this.maxHpBonus += up.amount;
        const player = this.player;
        if (player) {
          player.maxHp = this.baseHp + this.maxHpBonus;
          player.hp = Math.min(player.maxHp, player.hp + up.amount);
        }
        break;
      }
      case "moveSpeed":
        this.moveMul += up.amount;
        break;
      case "weapon":
        this.weaponLevel = Math.min(this.weaponLevelMax, this.weaponLevel + 1);
        break;
      case "extraProjectile":
        this.extraProjectiles = Math.min(SURVIVAL.extraProjectileMax, this.extraProjectiles + 1);
        break;
      case "critChance":
        this.critChance = Math.min(1, this.critChance + up.amount);
        break;
      case "critDamage":
        this.critMul += up.amount;
        break;
      case "lifesteal":
        this.lifesteal += up.amount;
        break;
      case "pickupRange":
        this.pickupMul += up.amount;
        break;
      case "newWeapon":
        // 二段选择在 chooseUpgrade / chooseWeapon 里处理
        break;
    }
    this.syncPlayerStats();
  }

  /**
   * 抽 3 张互不重复的升级卡。
   * 每次调用都重新拷贝候选池并完整洗牌（Fisher-Yates），不复用上一轮结果：
   * 洗牌后前 3 项即均匀无偏，同一项在后续轮次可以再次出现。
   */
  private rollChoices(): SurvivalUpgradeDef[] {
    const pool: SurvivalUpgradeDef[] = [];
    for (const u of SURVIVAL.upgrades) {
      if (u.kind === "weapon" && this.weaponLevel >= this.weaponLevelMax) continue;
      if (u.kind === "newWeapon" && !this.canTakeWeapon) continue;
      if (u.kind === "extraProjectile" && this.extraProjectiles >= SURVIVAL.extraProjectileMax) continue;
      if ("maxStacks" in u && u.maxStacks !== undefined) {
        // 目前只有额外投射物用 maxStacks；其它卡如需叠加上限在此扩展计数
        if (u.kind === "extraProjectile" && this.extraProjectiles >= u.maxStacks) continue;
      }
      pool.push(u as SurvivalUpgradeDef);
    }
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.choiceSeq++;
    return pool.slice(0, 3);
  }

  private beginChoice(): void {
    this.state = "choosing";
    this.choices = this.rollChoices();
  }

  private addXp(value: number): void {
    this.xp += value;
    while (this.xp >= this.xpNeed) {
      this.xp -= this.xpNeed;
      this.level++;
      this.pendingLevelUps++;
      this.xpNeed = xpNeedFor(this.level);
    }
  }

  private onZombieKilled(z: Zombie): void {
    // 吸血：击杀即按最大生命比例回血（与是否掉经验无关）
    const player = this.player;
    if (player && player.alive && this.lifesteal > 0) {
      const maxHp = player.maxHp ?? 100;
      player.hp = Math.min(maxHp, player.hp + maxHp * this.lifesteal);
    }
    if (Math.random() > SURVIVAL.xp.dropChance) return;
    const off = SURVIVAL.xp.orbOffset;
    this.orbs.push({
      x: z.x + randRange(-off, off),
      y: z.y + randRange(-off, off),
      radius: SURVIVAL.xp.orbRadius,
      value: SURVIVAL_XP_BY_KIND[z.kind] ?? 1,
    });
  }

  private updateOrbs(dt: number): void {
    const player = this.player;
    if (!player) return;
    const pickup2 = SURVIVAL.xp.pickupRadius * this.pickupMul;
    const pickupSq = pickup2 * pickup2;
    const collect = SURVIVAL.xp.collectRadius;
    // 本帧的吸附步长，固定不变；是否“够得着”由步长和剩余距离比较决定
    const step = SURVIVAL.xp.magnetSpeed * dt;
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const orb = this.orbs[i];
      const dx = player.x - orb.x;
      const dy = player.y - orb.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > pickupSq) continue;
      const d = Math.sqrt(d2);
      /*
       * 这一帧能走到拾取圈内（或已经贴脸）就直接吃掉。
       * 不能把步长钳成 min(step, d - collect)：那样球只会停在拾取圈外沿，
       * 而玩家每帧都在移动，下一帧判定又发生在移动之前，球就会永远尾随不消失。
       */
      if (d <= collect || step >= d - collect) {
        this.addXp(orb.value);
        this.orbs.splice(i, 1);
        continue;
      }
      orb.x += (dx / d) * step;
      orb.y += (dy / d) * step;
    }
  }

  private spawnTick(dt: number): void {
    const cfg = SURVIVAL.spawn;
    const tier = Math.floor(this.elapsed / cfg.tierSeconds);
    const interval = Math.max(cfg.minInterval, cfg.baseInterval - tier * cfg.intervalStep);
    const maxAlive = Math.min(cfg.maxAliveCap, cfg.baseMaxAlive + tier * cfg.maxAliveStep);

    this.spawnTimer -= dt;
    let guard = 0;
    while (this.spawnTimer <= 0 && guard++ < 8) {
      if (this.world.zombies.length < maxAlive) this.spawnOne();
      this.spawnTimer += interval;
    }
    if (this.spawnTimer < 0) this.spawnTimer = 0;
  }

  private spawnOne(): void {
    const player = this.player;
    if (!player) return;
    const kind = this.rollKind();
    const body = zombieBodyDiameter(getZombieDef(kind));
    const cfg = SURVIVAL.spawn;
    const min2 = cfg.minDistance * cfg.minDistance;
    const viewW = this.map.width / SURVIVAL.cameraZoom;
    const viewH = this.map.height / SURVIVAL.cameraZoom;
    // 随对局时长提升僵尸血量，与同屏上限一起构成难度曲线
    const tier = Math.floor(this.elapsed / cfg.tierSeconds);
    const hpScale = Math.min(
      SURVIVAL.difficulty.hpMaxScale,
      1 + tier * SURVIVAL.difficulty.hpPerTier,
    );

    for (let i = 0; i < cfg.attempts; i++) {
      const x = randRange(this.area.x0, this.area.x1);
      const y = randRange(this.area.y0, this.area.y1);
      const dx = x - player.x;
      const dy = y - player.y;
      if (dx * dx + dy * dy < min2) continue;
      const offscreen =
        Math.abs(dx) > viewW * 0.5 + cfg.offscreenMargin ||
        Math.abs(dy) > viewH * 0.5 + cfg.offscreenMargin;
      if (!offscreen) continue;
      const spot = this.world.findFreeSpot(x, y, body, this.area);
      if (!spot) continue;
      this.world.spawnZombie(spot.x, spot.y, kind, hpScale);
      return;
    }
  }

  private rollKind(): string {
    // 权重表集中在 data/survival/config.ts：权重随玩家等级线性增长，未到起始等级不出现
    const options: Array<{ kind: string; weight: number }> = [];
    for (const row of SURVIVAL_ZOMBIE_WEIGHTS) {
      if (this.level < row.startLevel) continue;
      options.push({
        kind: row.kind,
        weight: row.base + row.perLevel * (this.level - row.startLevel),
      });
    }
    if (options.length === 0) return getZombieDef(ZOMBIE_IDS.normal).id;
    let total = 0;
    for (const o of options) total += o.weight;
    let roll = Math.random() * total;
    for (const o of options) {
      roll -= o.weight;
      if (roll < 0) return o.kind;
    }
    return options[options.length - 1].kind;
  }

  private finish(): void {
    this.state = "defeat";
    const prev = loadSurvivalRecord();
    this.record = {
      bestTime: Math.max(prev.bestTime, this.elapsed),
      bestLevel: Math.max(prev.bestLevel, this.level),
    };
    saveSurvivalRecord(this.record);
    sound.play(SFX.DEFEAT);
  }

  /** 供 HUD 显示当前档位（0 基） */
  get tier(): number {
    return Math.floor(this.elapsed / SURVIVAL.spawn.tierSeconds);
  }

  /** 供 HUD 显示同屏上限 */
  get maxAlive(): number {
    const tier = this.tier;
    return Math.min(
      SURVIVAL.spawn.maxAliveCap,
      SURVIVAL.spawn.baseMaxAlive + tier * SURVIVAL.spawn.maxAliveStep,
    );
  }

  /** 只读导出僵尸数量与设置口径，避免 UI 直接摸 world */
  get aliveZombies(): number {
    return this.world.zombies.length;
  }

  get activeMapName(): string {
    return this.map.name || this.map.id;
  }
}
