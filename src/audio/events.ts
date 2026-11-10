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
  TESLA: "weapon-tesla",         // 电击枪放电
  SNIPER: "weapon-sniper",       // 狙击枪射击
  EXPLOSION: "weapon-explosion", // 火箭爆炸
  RELOAD: "weapon-reload",       // 换弹

  // —— 僵尸 ——
  ZOMBIE_GROWL: "zombie-growl",  // 追击咆哮（全局限频，体现僵尸多）
  ZOMBIE_GROWL_FAT: "zombie-growl-fat", // 胖子的专属低频低吼
  ZOMBIE_GROWL_LEAPER: "zombie-growl-leaper", // 飞扑者的高频尖啸
  ZOMBIE_GROWL_CORRODER: "zombie-growl-corroder", // 腐蚀者的含液咕噜声
  ZOMBIE_GROWL_MATRIARCH: "zombie-growl-matriarch", // 母体的低沉轰鸣
  ZOMBIE_SPAWN: "zombie-spawn",  // 母体产卵 / 死亡产卵
  ZOMBIE_MATRIARCH_DEATH: "zombie-matriarch-death", // 母体倒地
  ZOMBIE_SCREAM: "zombie-scream", // 尖叫者范围强化
  ZOMBIE_LEAP: "zombie-leap",    // 飞扑者起跳
  ZOMBIE_SPIT: "zombie-spit",    // 腐蚀者吐毒
  ZOMBIE_SPLAT: "zombie-splat",  // 毒液弹落地溅开
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
  [SFX.TESLA]: "audio/weapon-tesla.mp3",
  [SFX.SNIPER]: "audio/weapon-sniper.mp3",
  [SFX.EXPLOSION]: "audio/weapon-explosion.mp3",
  [SFX.RELOAD]: "audio/weapon-reload.mp3",

  [SFX.ZOMBIE_GROWL]: "audio/zombie-growl.mp3",
  [SFX.ZOMBIE_GROWL_FAT]: "audio/zombie-growl-fat.mp3",
  [SFX.ZOMBIE_GROWL_LEAPER]: "audio/zombie-growl-leaper.mp3",
  [SFX.ZOMBIE_GROWL_CORRODER]: "audio/zombie-growl-corroder.mp3",
  [SFX.ZOMBIE_GROWL_MATRIARCH]: "audio/zombie-growl-matriarch.mp3",
  [SFX.ZOMBIE_SPAWN]: "audio/zombie-spawn.mp3",
  [SFX.ZOMBIE_MATRIARCH_DEATH]: "audio/zombie-matriarch-death.mp3",
  [SFX.ZOMBIE_SCREAM]: "audio/zombie-scream.mp3",
  [SFX.ZOMBIE_LEAP]: "audio/zombie-leap.mp3",
  [SFX.ZOMBIE_SPIT]: "audio/zombie-spit.mp3",
  [SFX.ZOMBIE_SPLAT]: "audio/zombie-splat.mp3",
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
  [SFX.TESLA]: 250,
  [SFX.SNIPER]: 350,
  [SFX.EXPLOSION]: 500,
  [SFX.RELOAD]: 1000,

  [SFX.ZOMBIE_GROWL]: 3000,
  [SFX.ZOMBIE_GROWL_FAT]: 2200,
  [SFX.ZOMBIE_GROWL_LEAPER]: 2600,
  [SFX.ZOMBIE_GROWL_CORRODER]: 2800,
  [SFX.ZOMBIE_GROWL_MATRIARCH]: 3200,
  [SFX.ZOMBIE_SPAWN]: 800,
  [SFX.ZOMBIE_MATRIARCH_DEATH]: 0,
  [SFX.ZOMBIE_SCREAM]: 1200,
  [SFX.ZOMBIE_LEAP]: 300,
  [SFX.ZOMBIE_SPIT]: 350,
  [SFX.ZOMBIE_SPLAT]: 120,
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
