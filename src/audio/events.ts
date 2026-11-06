/**
 * 音效事件枚举 + 文件路径映射。
 * 想加新音效：加一个枚举值 + 在 MAP 里登记文件路径 + 调 manager.play(新事件)
 */
export const SFX = {
  // —— 武器 ——
  MG_SHOT: "weapon-mg",          // 机枪射击（单发子弹）
  FLAME: "weapon-flame",         // 喷火持续结算
  SHOTGUN: "weapon-shotgun",     // 霰弹枪扣扳机
  ROCKET: "weapon-rocket",       // 火箭发射
  EXPLOSION: "weapon-explosion", // 火箭爆炸
  RELOAD: "weapon-reload",       // 换弹

  // —— 僵尸 ——
  ZOMBIE_GROWL: "zombie-growl",  // 追击咆哮（全局限频，体现僵尸多）
  ZOMBIE_GROWL_FAT: "zombie-growl-fat", // 胖子的专属低频低吼
  ZOMBIE_BITE: "zombie-bite",    // 啃咬（人类或门窗）
  ZOMBIE_HIT: "zombie-hit",      // 被子弹命中扣血
  ZOMBIE_KILL: "zombie-kill",    // 倒地击杀

  // —— 人类 ——
  HUMAN_HURT: "human-hurt",      // 人类被丧尸咬到（扣血）
  HUMAN_TURN: "human-turn",      // 人类转化倒计时结束倒戈

  // —— 场景 ——
  WAVE_START: "wave-start",
  VICTORY: "victory",
  DEFEAT: "defeat",

  // —— UI ——
  UI_CLICK: "ui-click",
} as const;

export type SfxKey = typeof SFX[keyof typeof SFX];

/** 文件路径（相对于 public/，Vite 会原封不动拷贝） */
export const SFX_MAP: Record<SfxKey, string> = {
  [SFX.MG_SHOT]: "audio/weapon-mg.mp3",
  [SFX.FLAME]: "audio/weapon-flame.mp3",
  [SFX.SHOTGUN]: "audio/weapon-shotgun.mp3",
  [SFX.ROCKET]: "audio/weapon-rocket.mp3",
  [SFX.EXPLOSION]: "audio/weapon-explosion.mp3",
  [SFX.RELOAD]: "audio/weapon-reload.mp3",

  [SFX.ZOMBIE_GROWL]: "audio/zombie-growl.mp3",
  [SFX.ZOMBIE_GROWL_FAT]: "audio/zombie-growl-fat.mp3",
  [SFX.ZOMBIE_BITE]: "audio/zombie-bite.mp3",
  [SFX.ZOMBIE_HIT]: "audio/zombie-hit.mp3",
  [SFX.ZOMBIE_KILL]: "audio/zombie-kill.mp3",

  [SFX.HUMAN_HURT]: "audio/human-hurt.mp3",
  [SFX.HUMAN_TURN]: "audio/human-turn.mp3",

  [SFX.WAVE_START]: "audio/wave-start.mp3",
  [SFX.VICTORY]: "audio/victory.mp3",
  [SFX.DEFEAT]: "audio/defeat.mp3",

  [SFX.UI_CLICK]: "audio/ui-click.mp3",
};

/** 每个音效的全局限频（最短间隔 ms）。同一个音效在这段时间内最多响一次 */
export const SFX_THROTTLE: Record<SfxKey, number> = {
  [SFX.MG_SHOT]: 40,
  [SFX.FLAME]: 60,
  [SFX.SHOTGUN]: 200,
  [SFX.ROCKET]: 300,
  [SFX.EXPLOSION]: 500,
  [SFX.RELOAD]: 1000,

  [SFX.ZOMBIE_GROWL]: 3000,
  [SFX.ZOMBIE_GROWL_FAT]: 2200,
  [SFX.ZOMBIE_BITE]: 400,
  [SFX.ZOMBIE_HIT]: 80,
  [SFX.ZOMBIE_KILL]: 60,

  [SFX.HUMAN_HURT]: 300,
  [SFX.HUMAN_TURN]: 200,

  [SFX.WAVE_START]: 0,
  [SFX.VICTORY]: 0,
  [SFX.DEFEAT]: 0,

  [SFX.UI_CLICK]: 0,
};
