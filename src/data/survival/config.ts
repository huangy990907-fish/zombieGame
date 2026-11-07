/**
 * 0.7.0「尸潮求生」数值定义。
 *
 * 逻辑层（src/survival）只读这里，不在会话 / 入口里写魔法常量。
 * 所有数值都可在后续版本里调整，不影响其它模式。
 */
import { ZOMBIE_IDS } from "../zombies";

/** 升级奖励种类；效果由 session 按 kind 应用 */
export type SurvivalUpgradeKind =
  | "attack"
  | "fireRate"
  | "maxHp"
  | "moveSpeed"
  | "weapon"
  | "newWeapon"
  | "extraProjectile"
  | "critChance"
  | "critDamage"
  | "lifesteal"
  | "pickupRange";

export interface SurvivalUpgradeDef {
  id: string;
  name: string;
  desc: string;
  kind: SurvivalUpgradeKind;
  /**
   * 语义随 kind：
   *  - attack：伤害倍率增量（1 + 0.15 -> 1.15）
   *  - fireRate：射击间隔倍率乘数（* 0.92）
   *  - maxHp：血量上限增量，并等量回复
   *  - moveSpeed：移速倍率增量
   *  - weapon：武器等级 +1
   *  - newWeapon：进入第二段武器选择（amount 不用）
   *  - extraProjectile：额外投射物层数 +1
   *  - critChance：暴击率增量
   *  - critDamage：暴击伤害倍率增量
   *  - lifesteal：每次击杀回复最大生命的比例
   *  - pickupRange：经验拾取范围倍率增量
   */
  amount: number;
  /** 最多可叠加层数；未设置表示无上限（受其它上限过滤） */
  maxStacks?: number;
}

export const SURVIVAL = {
  /** 默认内置只读地图「空旷地」 */
  defaultMapId: "open-field",
  /** 玩家固定武器 */
  weapon: "mg",
  /** 最多同时持有的武器数量（主武器 + 副武器） */
  maxWeapons: 2,
  /** 「额外投射物」最多叠加层数 */
  extraProjectileMax: 4,
  /** 暴击伤害基础倍率（暴击率默认 0） */
  baseCritMul: 1.5,
  /** 拾取范围基础倍率 */
  basePickupMul: 1,
  /**
   * 玩家基础伤害倍率。单人面对整片尸潮，需要比放置模式更高的
   * 单位输出；升级的「火力强化」在此基础上继续累乘。
   */
  baseDamageMul: 2.6,
  /**
   * 玩家射击散布（弧度半宽）。自动索敌是持续跟枪，
   * 沿用机枪默认 0.05 会让远距离命中率过低，单人模式收窄到近似精准。
   */
  weaponSpread: 0.012,
  /**
   * 承伤倍率：单角色没有队友分摊，丧尸撕咬伤害按该值缩放。
   * 普通丧尸 25 → 11，约 9 口才会倒下，给风筝走位留出空间。
   */
  damageTakenMul: 0.45,
  /** 镜头放大倍数：大于 1 后地图比可视区域大，镜头跟随玩家 */
  cameraZoom: 1.5,

  spawn: {
    /** 出怪点与玩家的最小距离（像素） */
    minDistance: 320,
    /** 出怪点还要在可视区域外，额外留的边距 */
    offscreenMargin: 24,
    /** 地图边缘留白（像素） */
    areaPad: 16,
    /** 随机落点尝试次数 */
    attempts: 80,
    /** 开局第一次出怪延迟（秒） */
    initialDelay: 1.2,
    /** 每多少秒提升一档 */
    tierSeconds: 30,
    /** 基础出怪间隔（秒） */
    baseInterval: 2.2,
    /** 每档缩短的出怪间隔（秒） */
    intervalStep: 0.16,
    /** 出怪间隔下限（秒） */
    minInterval: 0.7,
    /** 基础同屏上限 */
    baseMaxAlive: 6,
    /** 每档增加的同屏上限 */
    maxAliveStep: 2,
    /** 同屏上限封顶 */
    maxAliveCap: 28,
  },

  difficulty: {
    /** 普通丧尸基础权重 */
    normalWeight: 12,
    /** 狂奔丧尸：基础权重 + 每级增量 */
    runnerBase: 2,
    runnerPerLevel: 3,
    /** 胖子从第几级开始出现，以及基础 / 每级权重 */
    fatStartLevel: 4,
    fatBase: 2,
    fatPerLevel: 2,
    /** 每档（30 秒）僵尸血量额外增长比例 */
    hpPerTier: 0.08,
    /** 血量倍率封顶，避免长局单只僵尸硬到打不动 */
    hpMaxScale: 2.5,
  },

  xp: {
    /** 击杀掉经验概率 */
    dropChance: 0.85,
    /** 玩家进入该半径后经验球开始吸附 */
    pickupRadius: 48,
    /** 吸附到该半径内即拾取 */
    collectRadius: 10,
    /** 吸附速度（像素/秒） */
    magnetSpeed: 180,
    /** 经验球相对尸体的随机偏移（像素） */
    orbOffset: 6,
    /** 经验球绘制半径（像素） */
    orbRadius: 5,
    /** 1 级升 2 级所需经验 */
    baseNeed: 6,
    /** 之后每级额外需要的经验 */
    needPerLevel: 2,
  },

  /** 武器等级 1..3 的伤害 / 射击间隔倍率 */
  weaponLevels: [
    { damage: 1, cooldown: 1 },
    { damage: 1.35, cooldown: 0.85 },
    { damage: 1.8, cooldown: 0.7 },
  ],

  upgrades: [
    { id: "attack", name: "火力强化", desc: "伤害 +15%", kind: "attack", amount: 0.15 },
    { id: "fireRate", name: "急速装填", desc: "射击间隔 -8%", kind: "fireRate", amount: 0.92 },
    { id: "maxHp", name: "强健体魄", desc: "血量上限 +20，并立即回复 20", kind: "maxHp", amount: 20 },
    { id: "moveSpeed", name: "轻装疾行", desc: "移动速度 +8%", kind: "moveSpeed", amount: 0.08 },
    { id: "weapon", name: "武器升级", desc: "主武器 +1 级（最高 3 级）", kind: "weapon", amount: 1 },
    {
      id: "newWeapon",
      name: "获得新武器",
      desc: "从尚未持有的武器中二选一，最多同时持有 2 把",
      kind: "newWeapon",
      amount: 1,
    },
    {
      id: "extraProjectile",
      name: "额外投射物 +1",
      desc: "多一发弹道；电击枪多一道电弧（最多叠 4 层）",
      kind: "extraProjectile",
      amount: 1,
      maxStacks: 4,
    },
    { id: "critChance", name: "致命一击", desc: "暴击率 +8%", kind: "critChance", amount: 0.08 },
    { id: "critDamage", name: "暴击强化", desc: "暴击伤害 +30%", kind: "critDamage", amount: 0.3 },
    { id: "lifesteal", name: "嗜血", desc: "每次击杀回复 2% 最大生命", kind: "lifesteal", amount: 0.02 },
    {
      id: "pickupRange",
      name: "磁力扩散",
      desc: "经验拾取范围 +25%",
      kind: "pickupRange",
      amount: 0.25,
    },
  ] satisfies SurvivalUpgradeDef[],
} as const;

/** 每种丧尸的经验值；未登记的 id 按 1 点 */
export const SURVIVAL_XP_BY_KIND: Record<string, number> = {
  [ZOMBIE_IDS.normal]: 1,
  [ZOMBIE_IDS.runner]: 1,
  [ZOMBIE_IDS.fat]: 3,
};

/** 第 level 级升下一级所需经验 */
export function xpNeedFor(level: number): number {
  return SURVIVAL.xp.baseNeed + (level - 1) * SURVIVAL.xp.needPerLevel;
}
