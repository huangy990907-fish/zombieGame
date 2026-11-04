/**
 * 全局配置 —— 游戏里所有可调的数值都集中在这个文件。
 * 想调难度、武器手感、波次节奏，只改这里。
 */

/** 逻辑画布尺寸（CSS 会等比缩放，不影响游戏逻辑） */
export const WORLD = { width: 1180, height: 720 };

/** 封闭房间矩形，丧尸从门 / 窗三个开口涌入 */
export const ROOM = { left: 220, top: 64, right: 1140, bottom: 656, wall: 12 };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 左墙上门开口的纵向范围（高 80px，有血量，能挡一阵子） */
export const DOOR_RANGE = { y0: 356, y1: 436 };
/** 上墙窗开口的横向范围（宽 36px，血量很低但能观察 + 射击） */
export const WIN_TOP = { x0: 662, x1: 698 };
/** 下墙窗开口的横向范围 */
export const WIN_BOTTOM = { x0: 702, x1: 738 };

/**
 * 四面墙，按门窗开口拆成分段：
 *  - 上墙 / 下墙各被一扇窗断开成两段
 *  - 左墙被门断开成两段，右墙完整
 */
export const WALLS: Rect[] = [
  // 上墙（中间是窗）
  { x: ROOM.left, y: ROOM.top, w: WIN_TOP.x0 - ROOM.left, h: ROOM.wall },
  { x: WIN_TOP.x1, y: ROOM.top, w: ROOM.right - ROOM.wall - WIN_TOP.x1, h: ROOM.wall },
  // 下墙（中间是窗）
  { x: ROOM.left, y: ROOM.bottom - ROOM.wall, w: WIN_BOTTOM.x0 - ROOM.left, h: ROOM.wall },
  {
    x: WIN_BOTTOM.x1,
    y: ROOM.bottom - ROOM.wall,
    w: ROOM.right - ROOM.wall - WIN_BOTTOM.x1,
    h: ROOM.wall,
  },
  // 右墙
  { x: ROOM.right - ROOM.wall, y: ROOM.top, w: ROOM.wall, h: ROOM.bottom - ROOM.top },
  // 左墙（中间是门）
  { x: ROOM.left, y: ROOM.top, w: ROOM.wall, h: DOOR_RANGE.y0 - ROOM.top },
  { x: ROOM.left, y: DOOR_RANGE.y1, w: ROOM.wall, h: ROOM.bottom - ROOM.wall - DOOR_RANGE.y1 },
];

/** 门窗种类：门结实挡得久，窗脆弱但透明（可观察可射击），破了还会被窗檐拖慢 */
export type OpeningKind = "door" | "window";

export interface OpeningDef {
  kind: OpeningKind;
  /** 开口矩形（正好嵌在墙洞里） */
  rect: Rect;
  /** 血量：丧尸每啃一口扣 BUILD_BITE_DAMAGE，归零即破损 */
  maxHp: number;
  /** 破损后丧尸穿过时的速度倍率（窗檐绊脚，门不减速） */
  passSpeed: number;
}

/** 三个可破坏开口：下标 0 必须是门（分岗逻辑依赖这个顺序） */
export const OPENINGS: OpeningDef[] = [
  { kind: "door", rect: { x: ROOM.left, y: DOOR_RANGE.y0, w: ROOM.wall, h: DOOR_RANGE.y1 - DOOR_RANGE.y0 }, maxHp: 450, passSpeed: 1 },
  { kind: "window", rect: { x: WIN_TOP.x0, y: ROOM.top, w: WIN_TOP.x1 - WIN_TOP.x0, h: ROOM.wall }, maxHp: 100, passSpeed: 0.45 },
  { kind: "window", rect: { x: WIN_BOTTOM.x0, y: ROOM.bottom - ROOM.wall, w: WIN_BOTTOM.x1 - WIN_BOTTOM.x0, h: ROOM.wall }, maxHp: 100, passSpeed: 0.45 },
];

/** 各开口中心点：流场多源 BFS 的源点 / 丧尸的兜底目标 */
export const OPENING_CENTERS = OPENINGS.map((o) => ({
  x: o.rect.x + o.rect.w * 0.5,
  y: o.rect.y + o.rect.h * 0.5,
}));

/** 丧尸啃咬门窗时每口造成的建筑伤害 */
export const BUILD_BITE_DAMAGE = 4;
/** 啃建筑比咬人慢的倍率（拆门是个力气活） */
export const BUILD_BITE_SLOW = 1.5;

/** 人类行为模式：defend 守开口（默认）/ attack 主动出击 / guard 保护个体（留接口） */
export type HumanMode = "defend" | "attack" | "guard";

/** 丧尸在房间左侧走廊里的出生区域 */
export const SPAWN = { x0: 4, x1: 110, y0: 30, y1: 700 };

/** 人类活动范围（房间内缩一点，防止贴墙） */
export const HUMAN_BOUNDS = {
  x0: ROOM.left + ROOM.wall + 20,
  x1: ROOM.right - ROOM.wall - 20,
  y0: ROOM.top + ROOM.wall + 20,
  y1: ROOM.bottom - ROOM.wall - 20,
};

/** 武器攻击形态：直线子弹 / 霰弹多弹丸 / 喷火锥形 / 火箭爆炸 */
export type WeaponKind = "bullet" | "pellet" | "flame" | "rocket";

export interface WeaponDef {
  name: string;
  color: number;
  kind: WeaponKind;
  range: number;
  damage: number;
  /** 两次射击的最小间隔（秒） */
  cooldown: number;
  magazine: number;
  /** 换弹耗时（秒） */
  reload: number;
  /** 子弹飞行速度（像素/秒），喷火为 0 因为不走弹道 */
  speed: number;
  /** 散布角（弧度，喷火表示锥形半角） */
  spread: number;
  /** 每发弹丸数，霰弹为 5 */
  pellets: number;
  /** 爆炸半径，仅火箭用 */
  blast: number;
  /**
   * 单次持续喷射时长（秒），只有喷火用，其他武器为 0。
   * 喷火焰时不是"一发一发打"，而是按一次扣 1 格燃料、连喷这么久，
   * 期间每个 cooldown 结算一次伤害。
   */
  burst: number;
}

/** 四种武器定义，下标即 weapon 索引：0 机枪 / 1 喷火 / 2 霰弹 / 3 火箭 */
export const WEAPONS: WeaponDef[] = [
  {
    name: "机枪",
    color: 0xffe14d,
    kind: "bullet",
    range: 275,
    damage: 6,
    cooldown: 0.1,
    magazine: 60,
    reload: 1.4,
    speed: 780,
    spread: 0.05,
    pellets: 1,
    blast: 0,
    burst: 0,
  },
  {
    name: "喷火",
    color: 0xff6b3d,
    kind: "flame",
    range: 158,
    /** 每 0.06 秒结算一次的伤害，1.1 秒一轮约 18 次 ≈ 23 点 */
    damage: 1.3,
    /** 喷射期间两次伤害结算的间隔 */
    cooldown: 0.06,
    /** 燃料：可喷射的轮数 */
    magazine: 8,
    /** 每一轮喷完后的散热时间 */
    reload: 1.35,
    speed: 0,
    /** 锥形半角，越大火焰越散 */
    spread: 0.32,
    pellets: 1,
    blast: 0,
    /** 单轮持续喷射 1.1 秒 */
    burst: 1.1,
  },
  {
    name: "霰弹",
    color: 0xffa34d,
    kind: "pellet",
    range: 190,
    damage: 5.5,
    cooldown: 0.8,
    magazine: 7,
    reload: 1.6,
    speed: 560,
    spread: 0.24,
    pellets: 5,
    blast: 0,
    burst: 0,
  },
  {
    name: "火箭",
    color: 0xff3d7f,
    kind: "rocket",
    range: 480,
    damage: 20,
    cooldown: 1.9,
    magazine: 4,
    reload: 2.4,
    speed: 340,
    spread: 0.02,
    pellets: 1,
    blast: 62,
    burst: 0,
  },
];

/** 火箭爆炸时的范围伤害（误伤仅限丧尸） */
export const EXPLOSION_DAMAGE = 44;

/** 初始 50 人的兵种配比，与 HUD 顶栏顺序一致 */
export const LOADOUT = [25, 10, 10, 5];

export interface ZombieDef {
  hp: number;
  speed: number;
  radius: number;
  color: number;
  /** 两次撕咬的间隔（秒） */
  bite: number;
  name: string;
}

/** 丧尸种类：0 普通（慢、肉） / 1 狂奔（快、脆） */
export const ZOMBIE_DEFS: ZombieDef[] = [
  { hp: 90, speed: 50, radius: 5.5, color: 0x8b5cf6, bite: 0.55, name: "普通" },
  { hp: 45, speed: 90, radius: 4.5, color: 0xc77dff, bite: 0.7, name: "狂奔" },
];

export const HUMAN_DEF = { hp: 100, speed: 54, radius: 6 };

/**
 * 面板可调参数集合 —— 用 let 暴露可变性，UI 滑块直接写回这些字段，
 * 下一局重开 / 新波次按新值生效。初始化值就是游戏默认值。
 * 每个字段配一个 min/max 用于滑块范围，step 决定精度。
 */
export interface SliderDef {
  key: string;
  label: string;
  group: "wave" | "human" | "zombie" | "opening" | "audio";
  min: number;
  max: number;
  step: number;
  /** 乘以哪个 SETTINGS 字段（支持点路径如 "zombie.normal.hp"） */
  path: string;
}

export const SETTINGS = {
  wave: {
    count: 26,
    base: 260,
    growth: 1.09,
    spawnBase: 26,
    spawnPerWave: 2,
    spawnMax: 90,
    maxAlive: 2200,
    reinforce: 1,
  },
  human: {
    start: 50,
    cap: 50,
    hp: 100,
    speed: 54,
    sight: 420,
    turnTime: 2.8,
  },
  zombie: {
    /** 个体随机幅度，正态分布 ±ZOMBIE_JITTER，0 = 完全不随机 */
    jitter: 0.25,
    normal: { hp: 90, speed: 50, bite: 0.55 },
    runner: { hp: 45, speed: 90, bite: 0.7 },
  },
  opening: {
    doorHp: 450,
    winHp: 100,
    winPassSpeed: 0.45,
    buildBiteDamage: 4,
    buildBiteSlow: 1.5,
  },
  audio: {
    /** 总音量 0~1 */
    master: 1,
    /** 音效音量 0~1 */
    sfx: 1,
  },
};

/** SETTINGS 的类型别名，给其他模块做 partial 覆盖时用 */
export type Settings = typeof SETTINGS;

/**
 * 滑块元数据（供 UI 生成面板）。顺序 = 面板显示顺序。
 */
export const SLIDERS: SliderDef[] = [
  // 波次 / 规模
  { key: "waveCount", label: "总波数", group: "wave", min: 5, max: 50, step: 1, path: "wave.count" },
  { key: "waveBase", label: "首波尸数", group: "wave", min: 50, max: 800, step: 10, path: "wave.base" },
  { key: "waveGrowth", label: "波次增长", group: "wave", min: 1.02, max: 1.2, step: 0.01, path: "wave.growth" },
  { key: "spawnMax", label: "每秒最大生速", group: "wave", min: 10, max: 300, step: 10, path: "wave.spawnMax" },
  { key: "maxAlive", label: "同屏僵尸上限", group: "wave", min: 300, max: 4000, step: 100, path: "wave.maxAlive" },

  // 人类
  { key: "humanStart", label: "初始人数", group: "human", min: 20, max: 120, step: 1, path: "human.start" },
  { key: "humanHp", label: "人类血量", group: "human", min: 30, max: 200, step: 5, path: "human.hp" },
  { key: "humanSpeed", label: "人类移速", group: "human", min: 25, max: 100, step: 1, path: "human.speed" },
  { key: "humanSight", label: "人类视野", group: "human", min: 150, max: 700, step: 10, path: "human.sight" },
  { key: "humanTurnTime", label: "转化倒计时(秒)", group: "human", min: 1.5, max: 6, step: 0.1, path: "human.turnTime" },

  // 僵尸
  { key: "zombieJitter", label: "属性随机幅度", group: "zombie", min: 0, max: 0.5, step: 0.02, path: "zombie.jitter" },
  { key: "zNormHp", label: "普通·血量均值", group: "zombie", min: 20, max: 250, step: 5, path: "zombie.normal.hp" },
  { key: "zNormSpeed", label: "普通·移速均值", group: "zombie", min: 25, max: 100, step: 1, path: "zombie.normal.speed" },
  { key: "zRunHp", label: "狂奔·血量均值", group: "zombie", min: 15, max: 150, step: 5, path: "zombie.runner.hp" },
  { key: "zRunSpeed", label: "狂奔·移速均值", group: "zombie", min: 50, max: 180, step: 2, path: "zombie.runner.speed" },

  // 门窗
  { key: "doorHp", label: "门血量", group: "opening", min: 100, max: 1200, step: 50, path: "opening.doorHp" },
  { key: "winHp", label: "窗血量", group: "opening", min: 30, max: 400, step: 10, path: "opening.winHp" },
  { key: "winPass", label: "窗破后穿窗速度", group: "opening", min: 0.15, max: 1, step: 0.05, path: "opening.winPassSpeed" },
  { key: "biteDmg", label: "啃建筑每口伤害", group: "opening", min: 1, max: 20, step: 1, path: "opening.buildBiteDamage" },
  { key: "biteSlow", label: "啃建筑减速倍率", group: "opening", min: 1, max: 3, step: 0.1, path: "opening.buildBiteSlow" },

  // 音频
  { key: "audioMaster", label: "总音量", group: "audio", min: 0, max: 1, step: 0.05, path: "audio.master" },
  { key: "audioSfx", label: "音效音量", group: "audio", min: 0, max: 1, step: 0.05, path: "audio.sfx" },
];

/** 给 UI 一个按分组查的版本 */
export const SLIDER_GROUPS: Record<string, SliderDef[]> = SLIDERS.reduce<Record<string, SliderDef[]>>(
  (acc, s) => {
    (acc[s.group] ??= []).push(s);
    return acc;
  },
  {},
);

/**
 * 默认值快照 —— storage.resetToDefaults() 用。
 * SETTINGS 是可变对象，这里在模块首次加载时深拷贝一份，
 * 以后滑块调 SETTINGS 不影响这个快照，恢复出厂值就靠它。
 */
export const DEFAULT_SETTINGS = JSON.parse(JSON.stringify(SETTINGS)) as typeof SETTINGS;

/** 路径 "a.b.c" 读取 SETTINGS.a.b.c；写入同样按路径 */
export function getSetting(path: string): number {
  const parts = path.split(".");
  let v: unknown = SETTINGS;
  for (const p of parts) {
    v = (v as Record<string, unknown>)[p];
  }
  return v as number;
}

export function setSetting(path: string, value: number): void {
  const parts = path.split(".");
  const last = parts.pop()!;
  let v: unknown = SETTINGS;
  for (const p of parts) {
    v = (v as Record<string, unknown>)[p];
  }
  (v as Record<string, number>)[last] = value;
}

/**
 * 深合并一个关卡的 partial SETTINGS 到全局 SETTINGS。
 * 只覆盖 partial 里显式写过的字段（空对象 = 不覆盖）。
 * 同时会触发 storage.saveSettings() 让 localStorage 保持同步。
 */
export function applySettings(partial: Partial<typeof SETTINGS>): void {
  if (!partial) return;
  for (const grp of Object.keys(partial) as (keyof typeof SETTINGS)[]) {
    const src = partial[grp];
    if (!src || typeof src !== "object") continue;
    const dst = SETTINGS[grp] as Record<string, unknown>;
    for (const key of Object.keys(src)) {
      const val = (src as Record<string, unknown>)[key];
      if (val !== undefined) {
        dst[key] = val;
      }
    }
  }
}
