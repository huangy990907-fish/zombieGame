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

/**
 * 追击决策模式（按僵尸类型配置，行为层按模式分发）：
 *  - breach：连通区域 + 可破坏开口。本区有人直追；跨区时在区域邻接图上
 *    选“破开后最快接近活人”的最短路，破掉第一扇，逐层推进（默认）
 *  - direct：旧行为，无视墙体分区，直接朝全场最近人类走，贴到门窗就啃
 *
 * 以后要加“只追可见人类 / 只破门”等模式，在这里扩联合类型，
 * 再到 systems/ai.ts 的分发处加分支即可，不必改默认实现。
 */
export type ZombiePursuitMode = "breach" | "direct";

/**
 * 飞扑者的行为参数。
 * 蓄力完成后按 3 倍移速直线扑向目标；扑中进入压制，扑空进入硬直。
 */
export interface ZombieLeapConfig {
  /** 触发蓄力的范围（像素），只对“可见”人类生效 */
  triggerRadius: number;
  /** 蓄力时长（秒），蓄力期间原地不动 */
  chargeTime: number;
  /** 每次受击延长蓄力的时长（秒） */
  hitExtend: number;
  /** 蓄力剩余时长的上限（秒） */
  chargeMax: number;
  /** 飞扑时的移速倍率 */
  leapSpeedMul: number;
  /** 飞扑最短 / 最长时间（秒），按起跳距离换算后夹在这个区间 */
  leapMinTime: number;
  leapMaxTime: number;
  /** 扑空后的硬直时长（秒） */
  missStun: number;
  /** 压制持续时长（秒） */
  pinDuration: number;
  /** 被压制人类的移速倍率 */
  pinMoveMul: number;
  /** 被压制人类每秒掉血 */
  pinDps: number;
}

/** 腐蚀者的远程吐毒与死亡留毒参数 */
export interface ZombieSpitConfig {
  /** 吐毒射程（像素） */
  range: number;
  /** 吐毒冷却（秒） */
  cooldown: number;
  /** 毒液落点半径（像素） */
  radius: number;
  /** 毒液持续时长（秒） */
  duration: number;
  /** 毒液每秒伤害 */
  dps: number;
  /** 毒液内人类移速倍率 */
  speedMul: number;
  /** 死亡时留下的毒液半径（像素） */
  deathRadius: number;
  /** 死亡毒液持续时长（秒） */
  deathDuration: number;
}

/** 武器攻击形态：直线子弹 / 霰弹多弹丸 / 喷火锥形 / 火箭爆炸 / 电击链 */
export type WeaponKind = "bullet" | "pellet" | "flame" | "rocket" | "tesla";

/** 电击枪的链式参数（全部集中在这里，训练场/后续调参只改这份配置） */
export interface TeslaConfig {
  /** 链式跳跃搜索半径（像素） */
  chainRadius: number;
  /** 单次电击最多命中的僵尸数（含首个目标） */
  chainMaxTargets: number;
  /** 每跳伤害相对上一跳的比例 */
  chainFalloff: number;
  /** 首个目标附近没有其他僵尸时的伤害倍率 */
  singleBonus: number;
  /** “附近没有其他僵尸”的判定半径（像素） */
  singleRadius: number;
}

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
  /** 电击链参数，仅电击枪用 */
  tesla?: TeslaConfig;
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
  /** 每次成功撕咬对人类造成的伤害（人类血量归零才进入异变） */
  damage: number;
  /** 追击决策模式；缺省按 breach（连通区域 + 破口追击） */
  pursuit?: ZombiePursuitMode;
  /** 飞扑者参数；有该字段即启用蓄力飞扑与压制行为 */
  leap?: ZombieLeapConfig;
  /** 腐蚀者参数；有该字段即启用远程吐毒与死亡留毒 */
  spit?: ZombieSpitConfig;
  /** BOSS 标记：不参与尖叫强化，并可单独登记到求生的 BOSS 出怪池 */
  boss?: boolean;
  /** 不能主动攻击人类（不撕咬、不产生撕咬伤害），但仍可以啃门窗 */
  noAttack?: boolean;
  /** 母体参数；有该字段即启用周期性产卵与死亡产卵 */
  spawner?: ZombieSpawnerConfig;
  /** 尖叫者参数；有该字段即启用周期性范围强化 */
  scream?: ZombieScreamConfig;
}

/** 母体产卵参数（子体种类从求生池的非 BOSS 僵尸里抽取） */
export interface ZombieSpawnerConfig {
  /** 两次产卵的间隔（秒） */
  interval: number;
  /** 每次产卵数量 */
  count: number;
  /** 由这只母体产出的子体同屏上限 */
  cap: number;
  /** 死亡时一次性产出的数量 */
  deathCount: number;
  /** 子体经验折算倍率（1 = 正常） */
  childXpMul: number;
}

/** 尖叫者的范围强化参数 */
export interface ZombieScreamConfig {
  /** 尖叫间隔（秒） */
  interval: number;
  /** 强化半径（像素） */
  radius: number;
  /** 强化持续时间（秒） */
  duration: number;
  /** 移速倍率 */
  speedMul: number;
  /** 攻击力（撕咬伤害）倍率 */
  damageMul: number;
  /** 承伤倍率（受击伤害乘以该值，0.7 = 减免 30%） */
  damageTakenMul: number;
}

export interface ZombieTunables {
  hp: number;
  speed: number;
  bite: number;
  damage: number;
}

/**
 * 按模式的僵尸数值覆盖：只写与其它模式不同的字段，缺失字段回退基础定义。
 * 用于「求生」这类独立平衡的模式，避免把单模式数值写进基础实体定义文件。
 */
export interface ZombieModeOverride {
  hp?: number;
  speed?: number;
  bite?: number;
  damage?: number;
  /** 只覆盖飞扑参数里需要按模式调整的项（如压制时长 / DPS） */
  leap?: Partial<ZombieLeapConfig>;
  /** 只覆盖吐毒参数里需要按模式调整的项（如毒液 DPS） */
  spit?: Partial<ZombieSpitConfig>;
  /** 只覆盖产卵参数里需要按模式调整的项 */
  spawner?: Partial<ZombieSpawnerConfig>;
  /** 只覆盖尖叫强化参数里需要按模式调整的项 */
  scream?: Partial<ZombieScreamConfig>;
}

/** 一套模式覆盖表：僵尸 id -> 该模式下不同的字段；新增模式只需再加一份表 */
export type ZombieModeOverrideTable = Record<string, ZombieModeOverride>;

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
  /** 地图内唯一 id（如 "door-main" / "window-top"） */
  id: string;
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

/** 矩形出生区域（像素坐标） */
export interface SpawnRegion {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** 一张地图的全部几何与默认参数 */
export interface MapDef {
  id: string;
  name: string;
  width: number;
  height: number;
  room: RoomDef;
  walls: Rect[];
  /** 可破坏开口；编译时门排在窗之前，但守岗 / 出怪不再依赖下标顺序 */
  openings: OpeningDef[];
  /** 各开口中心点：流场多源 BFS 的源点 / 丧尸的兜底目标 */
  openingCenters: Point[];
  /** 丧尸出生区域（可多块，按面积加权抽签） */
  spawn: SpawnRegion[];
  /** 窗侧出生区域，按地图显式数据提供；缺失的方位直接不参与出怪 */
  windowSpawn: {
    top?: SpawnRegion;
    bottom?: SpawnRegion;
  };
  /** 人类出生区域（可多块，按面积加权抽签；不限制后续活动范围） */
  humanZones: SpawnRegion[];
  /** 人类移动边界（房间内缩一点，防止贴墙；只夹取位置，不决定出生点） */
  humanBounds: SpawnRegion;
  /** 丧尸啃咬门窗时每口造成的建筑伤害 */
  buildBiteDamage: number;
  /** 啃建筑比咬人慢的倍率（拆门是个力气活） */
  buildBiteSlow: number;
  /** 可通行草丛瓦片（16×16 px，逐格；燃烧 / 重生状态在 World 中维护） */
  grassTiles: Rect[];
  /** 水池瓦片（16×16 px，逐格；仅用于渲染） */
  waterTiles: Rect[];
  /** 水池合并后的阻挡矩形（碰撞 / 流场 / 区域连通用；不参与子弹与视线判定） */
  waterBlockers: Rect[];
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
