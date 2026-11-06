/** 数据层共享类型 —— 所有实体定义、地图、设置都只依赖这里。 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 房间矩形（带墙厚），与 Rect 区分：这是区域定义，不是单个矩形。 */
export interface RoomDef {
  left: number;
  top: number;
  right: number;
  bottom: number;
  wall: number;
}

/** 人类行为模式：defend 守开口（默认）/ attack 主动出击 / guard 保护个体（留接口） */
export type HumanMode = "defend" | "attack" | "guard";

/**
 * 丧尸行为状态：hunt 索敌进攻（默认）/ wander 场上零人类时漫游。
 * 每只丧尸独立持有，行为层按世界级人数标记统一切换，
 * 方便以后按僵尸类型接入别的索敌机制。
 */
export type ZombieMode = "hunt" | "wander";

/** 武器攻击形态：直线子弹 / 霰弹多弹丸 / 喷火锥形 / 火箭爆炸 */
export type WeaponKind = "bullet" | "pellet" | "flame" | "rocket";

export interface WeaponDef {
  /** 代码里唯一使用的身份，例如 "mg" */
  id: string;
  /** 界面显示用的中文名 */
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
  /** 爆炸伤害，仅火箭用 */
  blastDamage: number;
}

/** 武器定义里允许被玩家覆盖的数值字段 */
export type WeaponTunables = Omit<WeaponDef, "id" | "name" | "kind" | "color">;

export interface ZombieDef {
  /** 代码里唯一使用的身份，例如 "normal" */
  id: string;
  /** 界面显示用的中文名 */
  name: string;
  hp: number;
  speed: number;
  /**
   * 物理碰撞半径：分离、咬人判定、子弹命中用。
   * 体型口径也由它推导：可见体宽 / 通行直径 = radius * 2，
   * 渲染盒宽 = radius * 2 * VISUAL_SCALE（含精灵透明留白）。两者都不再二次放大半径。
   */
  radius: number;
  color: number;
  /** 两次撕咬的间隔（秒） */
  bite: number;
}

export interface ZombieTunables {
  hp: number;
  speed: number;
  bite: number;
}

export interface HumanDef {
  /** 代码里唯一使用的身份 */
  id: string;
  /** 界面显示用的中文名 */
  name: string;
  hp: number;
  speed: number;
  radius: number;
  sight: number;
  turnTime: number;
}

export type OpeningKind = "door" | "window";

export interface OpeningDef {
  kind: OpeningKind;
  /** 开口矩形（正好嵌在墙洞里） */
  rect: Rect;
  /** 默认血量：丧尸每啃一口扣 buildBiteDamage，归零即破损 */
  maxHp: number;
  /** 破损后丧尸穿过时的速度倍率（窗檐绊脚，门不减速） */
  passSpeed: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 一张地图的全部几何与默认参数 */
export interface MapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  room: RoomDef;
  walls: Rect[];
  /** 三个可破坏开口；约定下标 0 必须是门（分岗逻辑依赖这个顺序） */
  openings: OpeningDef[];
  /** 各开口中心点：流场多源 BFS 的源点 / 丧尸的兜底目标 */
  openingCenters: Point[];
  /** 丧尸在房间左侧走廊里的出生区域 */
  spawn: { x0: number; x1: number; y0: number; y1: number };
  /** 从上 / 下墙外侧逼近窗户的出生区域 */
  windowSpawn: {
    top: { x0: number; x1: number; y0: number; y1: number };
    bottom: { x0: number; x1: number; y0: number; y1: number };
  };
  /** 人类活动范围（房间内缩一点，防止贴墙） */
  humanBounds: { x0: number; x1: number; y0: number; y1: number };
  /** 丧尸啃咬门窗时每口造成的建筑伤害 */
  buildBiteDamage: number;
  /** 啃建筑比咬人慢的倍率（拆门是个力气活） */
  buildBiteSlow: number;
}

// ============================================================
// 设置项
// ============================================================

export interface WaveSettings {
  count: number;
  base: number;
  growth: number;
  spawnBase: number;
  spawnPerWave: number;
  spawnMax: number;
  maxAlive: number;
  reinforce: number;
}

/** 人类相关的有效设置：前两项是场景参数，后四项来自人类定义或覆盖值 */
export interface HumanSettings {
  start: number;
  cap: number;
  hp: number;
  speed: number;
  sight: number;
  turnTime: number;
}

export interface OpeningTuning {
  doorHp: number;
  winHp: number;
  winPassSpeed: number;
  buildBiteDamage: number;
  buildBiteSlow: number;
}

export interface AudioSettings {
  master: number;
  sfx: number;
}

/** 玩家覆盖值 —— 只存改过的字段，读取时与实体定义默认值合并 */
export interface SettingsOverrides {
  wave?: Partial<WaveSettings>;
  human?: Partial<HumanSettings>;
  zombie?: {
    jitter?: number;
    /** 按僵尸 id 存放的覆盖值，如 { normal: { hp: 90 } } */
    types?: Record<string, Partial<ZombieTunables>>;
  };
  opening?: Partial<OpeningTuning>;
  /** 按武器 id 存放的覆盖值，当前没有滑块，留作扩展 */
  weapons?: Record<string, Partial<WeaponTunables>>;
  audio?: Partial<AudioSettings>;
}

/** 合并后的运行时设置（只读视图，不落盘） */
export interface RuntimeSettings {
  wave: WaveSettings;
  human: HumanSettings;
  zombie: { jitter: number };
  opening: OpeningTuning;
  audio: AudioSettings;
}

export type SliderGroup = "wave" | "human" | "zombie" | "opening" | "audio";

export interface SliderDef {
  key: string;
  label: string;
  group: SliderGroup;
  min: number;
  max: number;
  step: number;
  /** 设置路径，支持点路径如 "zombie.normal.hp" */
  path: string;
}
