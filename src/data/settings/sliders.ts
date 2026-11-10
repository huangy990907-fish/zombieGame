import type { SliderDef } from "../types";
import { ZOMBIE_DEFS, getZombieDef } from "../zombies";
import { WEAPONS, getWeaponDef } from "../weapons";

/**
 * 滑块元数据（供数值调参页生成 UI）。顺序 = 面板显示顺序。
 * path 指向"覆盖值 ?? 定义默认值"的统一读取入口，不要求 SETTINGS 里再存一份同名数值。
 *
 * 只列玩法真实读取的字段：已删除的 wave.count / wave.base / wave.growth /
 * wave.reinforce / human.start 不再出现在这里。
 */

type Field = { label: string; min: number; max: number; step: number; note?: string };

const FIELD: Record<string, Field> = {
  range: { label: "射程", min: 50, max: 1200, step: 10 },
  damage: { label: "伤害", min: 0.1, max: 200, step: 0.5 },
  cooldown: { label: "射击间隔", min: 0.01, max: 5, step: 0.01 },
  magazine: { label: "弹匣", min: 1, max: 120, step: 1 },
  reload: { label: "换弹时间", min: 0.2, max: 8, step: 0.1 },
  speed: { label: "弹速", min: 0, max: 2000, step: 20 },
  spread: { label: "散布", min: 0, max: 1, step: 0.01 },
  pellets: { label: "弹丸数", min: 1, max: 20, step: 1 },
  blast: { label: "爆炸半径", min: 0, max: 200, step: 2 },
  burst: { label: "喷射时长", min: 0, max: 5, step: 0.1 },
  blastDamage: { label: "爆炸伤害", min: 0, max: 200, step: 2 },
  tracer: { label: "曳光长度", min: 0, max: 100, step: 1 },
  hitSlowMul: { label: "命中减速倍率", min: 0.1, max: 1, step: 0.05 },
  "tesla.chainRadius": { label: "链跳半径", min: 20, max: 300, step: 5 },
  "tesla.chainMaxTargets": { label: "链跳目标数", min: 1, max: 15, step: 1 },
  "tesla.chainFalloff": { label: "链跳衰减", min: 0.1, max: 1, step: 0.05 },
  "tesla.singleBonus": { label: "单体加成", min: 1, max: 5, step: 0.1 },
  "tesla.singleRadius": { label: "单体判定半径", min: 20, max: 300, step: 5 },
  "pierce.maxTargets": { label: "穿透目标数", min: 1, max: 10, step: 1 },
  "pierce.falloff": { label: "穿透衰减", min: 0.1, max: 1, step: 0.05 },
};

const ZOMBIE_FIELD: Record<string, Field> = {
  hp: { label: "血量", min: 10, max: 5000, step: 5 },
  speed: { label: "移速", min: 10, max: 200, step: 1 },
  bite: { label: "啃咬间隔", min: 0.1, max: 3, step: 0.05 },
  damage: { label: "攻击伤害", min: 0, max: 100, step: 1 },
};

const LEAP_FIELD: Record<string, Field> = {
  triggerRadius: { label: "触发距离", min: 40, max: 300, step: 5 },
  chargeTime: { label: "蓄力时间", min: 0.2, max: 3, step: 0.1 },
  hitExtend: { label: "命中判定加成", min: 0, max: 0.5, step: 0.01 },
  chargeMax: { label: "最大蓄力层", min: 1, max: 5, step: 1 },
  leapSpeedMul: { label: "扑击速度倍率", min: 1, max: 6, step: 0.1 },
  leapMinTime: { label: "最短滞空", min: 0.05, max: 1, step: 0.05 },
  leapMaxTime: { label: "最长滞空", min: 0.1, max: 2, step: 0.05 },
  missStun: { label: "扑空冷却", min: 0.5, max: 8, step: 0.5 },
  pinDuration: { label: "附身时长", min: 1, max: 15, step: 0.5 },
  pinMoveMul: { label: "附身移速倍率", min: 0, max: 1, step: 0.05 },
  pinDps: { label: "附身每秒伤害", min: 0, max: 30, step: 0.5 },
  pinKnockback: { label: "挣脱击退", min: 0, max: 60, step: 2 },
  pinTapStep: { label: "每次挣脱进度", min: 0.05, max: 1, step: 0.05 },
  pinTapMin: { label: "挣脱下限", min: 0.5, max: 6, step: 0.1 },
};

const SPIT_FIELD: Record<string, Field> = {
  range: { label: "吐毒射程", min: 50, max: 500, step: 10 },
  cooldown: { label: "吐毒冷却", min: 0.5, max: 10, step: 0.1 },
  radius: { label: "毒液半径", min: 10, max: 120, step: 2 },
  duration: { label: "毒液持续", min: 1, max: 20, step: 0.5 },
  dps: { label: "毒液每秒伤害", min: 0, max: 40, step: 1 },
  speedMul: { label: "毒液减速倍率", min: 0.2, max: 1, step: 0.05 },
  deathRadius: { label: "死亡毒液半径", min: 10, max: 160, step: 2 },
  deathDuration: { label: "死亡毒液持续", min: 1, max: 20, step: 0.5 },
};

const SPAWNER_FIELD: Record<string, Field> = {
  interval: { label: "产卵间隔", min: 1, max: 30, step: 0.5 },
  count: { label: "每次产卵数", min: 1, max: 10, step: 1 },
  cap: { label: "场上产物上限", min: 1, max: 50, step: 1 },
  deathCount: { label: "死亡爆发数量", min: 0, max: 40, step: 1 },
  childXpMul: { label: "产物经验倍率", min: 0, max: 2, step: 0.1 },
};

const SCREAM_FIELD: Record<string, Field> = {
  interval: { label: "尖叫间隔", min: 1, max: 30, step: 0.5 },
  radius: { label: "强化半径", min: 50, max: 500, step: 10 },
  duration: { label: "强化持续", min: 1, max: 20, step: 0.5 },
  speedMul: { label: "强化移速倍率", min: 1, max: 3, step: 0.05 },
  damageMul: { label: "强化伤害倍率", min: 1, max: 4, step: 0.1 },
  damageTakenMul: { label: "受伤倍率(越低越硬)", min: 0.1, max: 1, step: 0.05 },
};

/** 子配置 → 中文分区名 */
const ZOMBIE_SUB_LABEL: Record<string, string> = {
  leap: "飞扑",
  spit: "吐毒",
  spawner: "产卵",
  scream: "尖叫",
};

/** 生成一组滑块（字段缺失或没有默认定义时跳过） */
function rows(
  prefix: string,
  source: Record<string, unknown>,
  fields: Record<string, Field>,
  group: SliderDef["group"],
  note?: string,
): SliderDef[] {
  const out: SliderDef[] = [];
  for (const [field, meta] of Object.entries(fields)) {
    if (!(field in source)) continue;
    out.push({
      key: `${prefix}.${field}`,
      label: meta.label,
      group,
      min: meta.min,
      max: meta.max,
      step: meta.step,
      path: `${prefix}.${field}`,
      ...(meta.note || note ? { note: meta.note ?? note } : {}),
    });
  }
  return out;
}

const waveSliders: SliderDef[] = [
  { key: "spawnBase", label: "出怪基础速率", group: "wave", min: 5, max: 120, step: 1, path: "wave.spawnBase" },
  { key: "spawnPerWave", label: "每波速率增量", group: "wave", min: 0, max: 20, step: 0.5, path: "wave.spawnPerWave" },
  { key: "spawnMax", label: "每秒最大生速", group: "wave", min: 10, max: 300, step: 10, path: "wave.spawnMax" },
  { key: "maxAlive", label: "同屏僵尸上限", group: "wave", min: 300, max: 4000, step: 100, path: "wave.maxAlive" },
];

const humanSliders: SliderDef[] = [
  { key: "humanCap", label: "人类库存上限", group: "human", min: 10, max: 200, step: 5, path: "human.cap" },
  { key: "humanHp", label: "人类血量", group: "human", min: 30, max: 200, step: 5, path: "human.hp" },
  { key: "humanSpeed", label: "人类移速", group: "human", min: 25, max: 100, step: 1, path: "human.speed" },
  { key: "humanSight", label: "人类视野", group: "human", min: 150, max: 700, step: 10, path: "human.sight" },
  {
    key: "humanTurnTime",
    label: "转化倒计时(秒)",
    group: "human",
    min: 1.5,
    max: 6,
    step: 0.1,
    path: "human.turnTime",
  },
];

const zombieSliders: SliderDef[] = [
  { key: "zombieJitter", label: "属性随机幅度", group: "zombie", min: 0, max: 0.5, step: 0.02, path: "zombie.jitter" },
];

for (const id of Object.keys(ZOMBIE_DEFS)) {
  const def = getZombieDef(id);
  zombieSliders.push(
    ...rows(`zombie.${id}`, ZOMBIE_FIELD, ZOMBIE_FIELD, "zombie").map((s) => ({
      ...s,
      label: `${def.name}·${s.label}`,
    })),
  );
  // 半径只读：牵动碰撞 / 区域图 / 开口净宽，不开放调整
  zombieSliders.push({
    key: `zombie.${id}.radius`,
    label: `${def.name}·碰撞半径(只读)`,
    group: "zombie",
    min: def.radius,
    max: def.radius,
    step: 0.5,
    path: `zombie.${id}.radius`,
    readonly: true,
  });
  for (const sub of ["leap", "spit", "spawner", "scream"] as const) {
    const source = (def as unknown as Record<string, unknown>)[sub];
    if (!source || typeof source !== "object") continue;
    const fields =
      sub === "leap" ? LEAP_FIELD : sub === "spit" ? SPIT_FIELD : sub === "spawner" ? SPAWNER_FIELD : SCREAM_FIELD;
    zombieSliders.push(
      ...rows(`zombie.${id}.${sub}`, source as Record<string, unknown>, fields, "zombie").map((s) => ({
        ...s,
        label: `${def.name}·${ZOMBIE_SUB_LABEL[sub]}·${s.label}`,
      })),
    );
  }
}

const weaponSliders: SliderDef[] = [];
const WEAPON_FLAT_KEYS = [
  "range",
  "damage",
  "cooldown",
  "magazine",
  "reload",
  "speed",
  "spread",
  "pellets",
  "blast",
  "burst",
  "blastDamage",
  "tracer",
  "hitSlowMul",
] as const;

for (const id of Object.keys(WEAPONS)) {
  const def = getWeaponDef(id);
  const source = def as unknown as Record<string, unknown>;
  for (const key of WEAPON_FLAT_KEYS) {
    if (!(key in source)) continue;
    const meta = FIELD[key];
    if (!meta) continue;
    weaponSliders.push({
      key: `${id}.${key}`,
      label: `${def.name}·${meta.label}`,
      group: "weapons",
      min: meta.min,
      max: meta.max,
      step: meta.step,
      path: `weapons.${id}.${key}`,
    });
  }
  for (const sub of ["tesla", "pierce"] as const) {
    const nested = source[sub];
    if (!nested || typeof nested !== "object") continue;
    for (const [key, meta] of Object.entries(FIELD)) {
      if (!key.startsWith(`${sub}.`)) continue;
      const field = key.slice(sub.length + 1);
      if (!(field in (nested as Record<string, unknown>))) continue;
      weaponSliders.push({
        key: `${id}.${key}`,
        label: `${def.name}·${meta.label}`,
        group: "weapons",
        min: meta.min,
        max: meta.max,
        step: meta.step,
        path: `weapons.${id}.${sub}.${field}`,
      });
    }
  }
}

const openingSliders: SliderDef[] = [
  { key: "doorHp", label: "门血量", group: "opening", min: 100, max: 2000, step: 50, path: "opening.doorHp", note: "需重开本局" },
  { key: "winHp", label: "窗血量", group: "opening", min: 30, max: 600, step: 10, path: "opening.winHp", note: "需重开本局" },
  {
    key: "winPass",
    label: "窗破后穿窗速度",
    group: "opening",
    min: 0.15,
    max: 1,
    step: 0.05,
    path: "opening.winPassSpeed",
  },
  {
    key: "biteDmg",
    label: "啃建筑每口伤害",
    group: "opening",
    min: 1,
    max: 40,
    step: 1,
    path: "opening.buildBiteDamage",
  },
  {
    key: "biteSlow",
    label: "啃建筑减速倍率",
    group: "opening",
    min: 1,
    max: 3,
    step: 0.1,
    path: "opening.buildBiteSlow",
  },
];

const audioSliders: SliderDef[] = [
  { key: "audioMaster", label: "总音量", group: "audio", min: 0, max: 1, step: 0.05, path: "audio.master" },
  { key: "audioSfx", label: "音效音量", group: "audio", min: 0, max: 1, step: 0.05, path: "audio.sfx" },
];

export const SLIDERS: SliderDef[] = [
  ...waveSliders,
  ...humanSliders,
  ...zombieSliders,
  ...weaponSliders,
  ...openingSliders,
  ...audioSliders,
];
