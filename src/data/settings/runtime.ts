/**
 * 设置运行时 —— 存"玩家覆盖值"，读取时按 `覆盖值 ?? 实体/地图默认值` 合并。
 *
 *  - 滑块、关卡覆盖、导入存档都只写 overrides
 *  - 玩法代码通过 settings() / effectiveZombie() / effectiveWeapon() 读合并后的值
 *  - 旧存档里的数字 kind/weapon 等脏数据不会被识别，未知字段一律忽略并回落默认
 */
import { HUMAN_DEF } from "../humans";
import { DEFAULT_MAP, type MapDef } from "../maps";
import { ZOMBIE_DEFS, getZombieDef } from "../zombies";
import { WEAPONS, getWeaponDef } from "../weapons";
import type {
  AudioSettings,
  HumanDef,
  HumanSettings,
  OpeningDef,
  OpeningTuning,
  RuntimeSettings,
  SettingsOverrides,
  WaveSettings,
  WeaponDef,
  WeaponTunables,
  ZombieDef,
  ZombieModeOverrideTable,
  ZombieTunables,
} from "../types";
import { DEFAULT_BASE_SETTINGS } from "./defaults";

const WAVE_KEYS = ["spawnBase", "spawnPerWave", "spawnMax", "maxAlive"] as const;
const HUMAN_KEYS = ["cap", "hp", "speed", "sight", "turnTime"] as const;
const ZOMBIE_KEYS = ["hp", "speed", "bite", "damage"] as const;
const LEAP_KEYS = [
  "triggerRadius",
  "chargeTime",
  "hitExtend",
  "chargeMax",
  "leapSpeedMul",
  "leapMinTime",
  "leapMaxTime",
  "missStun",
  "pinDuration",
  "pinMoveMul",
  "pinDps",
  "pinKnockback",
  "pinTapStep",
  "pinTapMin",
] as const;
const SPIT_KEYS = [
  "range",
  "cooldown",
  "radius",
  "duration",
  "dps",
  "speedMul",
  "deathRadius",
  "deathDuration",
] as const;
const SPAWNER_KEYS = ["interval", "count", "cap", "deathCount", "childXpMul"] as const;
const SCREAM_KEYS = [
  "interval",
  "radius",
  "duration",
  "speedMul",
  "damageMul",
  "damageTakenMul",
] as const;
const OPENING_KEYS = ["doorHp", "winHp", "winPassSpeed", "buildBiteDamage", "buildBiteSlow"] as const;
const AUDIO_KEYS = ["master", "sfx"] as const;
const WEAPON_KEYS = [
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
const TESLA_KEYS = ["chainRadius", "chainMaxTargets", "chainFalloff", "singleBonus", "singleRadius"] as const;
const PIERCE_KEYS = ["maxTargets", "falloff"] as const;

/** 僵尸子配置 → 可覆盖字段白名单 */
const ZOMBIE_SUB_KEYS = {
  leap: LEAP_KEYS,
  spit: SPIT_KEYS,
  spawner: SPAWNER_KEYS,
  scream: SCREAM_KEYS,
} as const;
type ZombieSubKey = keyof typeof ZOMBIE_SUB_KEYS;

/** 武器子配置 → 可覆盖字段白名单 */
const WEAPON_SUB_KEYS = { tesla: TESLA_KEYS, pierce: PIERCE_KEYS } as const;
type WeaponSubKey = keyof typeof WEAPON_SUB_KEYS;

let overrides: SettingsOverrides = {};
/**
 * 关卡自带的本局覆盖值。和玩家覆盖值分开存放：
 * 关卡值只作用于这一局，退出 / 换关即清空，不会残留在数值面板上。
 */
let levelOverrides: SettingsOverrides = {};
let cache: RuntimeSettings | null = null;
/** 当前场景使用的地图；settings() / openingTuning() 的默认口径跟随它，而不是固定默认图 */
let activeMap: MapDef = DEFAULT_MAP;
/** 合并后的实体定义缓存，避免每帧为每只单位重复创建对象 */
let humanCache: HumanDef | null = null;
const zombieCache = new Map<string, ZombieDef>();
/**
 * 当前生效的按模式僵尸覆盖表。模式自己持有数据（如求生 config），
 * 进入该模式时启用、离开时清空，这里只负责合并与缓存失效。
 */
let modeZombieOverrides: ZombieModeOverrideTable = {};
const weaponCache = new Map<string, WeaponDef>();
let openingCache: { map: MapDef; value: OpeningTuning } | null = null;

function invalidate(): void {
  cache = null;
  humanCache = null;
  zombieCache.clear();
  weaponCache.clear();
  openingCache = null;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function num(v: unknown): number | undefined {
  return isNum(v) ? v : undefined;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** 从对象里挑出指定 key 的有限数字，其余忽略 */
function pickNumbers(src: unknown, keys: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  if (!src || typeof src !== "object") return out;
  const obj = src as Record<string, unknown>;
  for (const key of keys) {
    const v = num(obj[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function mergeNumbers<T extends object>(base: T, src: Partial<Record<keyof T, number>> | undefined): T {
  const out = { ...base } as Record<string, number>;
  if (src) {
    for (const key of Object.keys(src) as (keyof T)[]) {
      const v = num(src[key]);
      if (v !== undefined) out[key as string] = v;
    }
  }
  return out as T;
}

// ============================================================
// 默认值与有效值
// ============================================================

/** 把设置解析成当前有效值（读取时合并覆盖值） */
function build(map: MapDef): RuntimeSettings {
  return {
    wave: mergeNumbers(
      mergeNumbers(DEFAULT_BASE_SETTINGS.wave, levelOverrides.wave),
      overrides.wave,
    ),
    human: {
      cap: overrides.human?.cap ?? levelOverrides.human?.cap ?? DEFAULT_BASE_SETTINGS.human.cap,
      hp: overrides.human?.hp ?? levelOverrides.human?.hp ?? HUMAN_DEF.hp,
      speed: overrides.human?.speed ?? levelOverrides.human?.speed ?? HUMAN_DEF.speed,
      sight: overrides.human?.sight ?? levelOverrides.human?.sight ?? HUMAN_DEF.sight,
      turnTime: overrides.human?.turnTime ?? levelOverrides.human?.turnTime ?? HUMAN_DEF.turnTime,
    },
    zombie: {
      jitter:
        overrides.zombie?.jitter ?? levelOverrides.zombie?.jitter ?? DEFAULT_BASE_SETTINGS.zombie.jitter,
    },
    opening: openingTuning(map),
    audio: mergeNumbers(mergeNumbers(DEFAULT_BASE_SETTINGS.audio, levelOverrides.audio), overrides.audio),
  };
}

/**
 * 切换当前地图口径（World 构造时调用）。
 * 同一张图不重复清缓存；换图后 settings() / openingTuning() 的默认值立刻跟随。
 */
export function setActiveMap(map: MapDef): void {
  if (activeMap === map) return;
  activeMap = map;
  invalidate();
}

/** 当前生效设置（开口默认值跟随当前地图，其余数值与地图无关） */
export function settings(): RuntimeSettings {
  return (cache ??= build(activeMap));
}

/** 把地图自带的开口默认值和玩家覆盖值合并（聚合口径，滑块展示与啃咬参数用） */
export function openingTuning(map: MapDef = activeMap): OpeningTuning {
  if (openingCache && openingCache.map === map) return openingCache.value;
  const door = map.openings.find((o) => o.kind === "door") ?? map.openings[0];
  const win = map.openings.find((o) => o.kind === "window") ?? map.openings[0];
  const value: OpeningTuning = {
    // 「空旷地」这类没有门窗的图：缺省值取 0 / 1，不参与任何门窗结算
    doorHp: overrides.opening?.doorHp ?? levelOverrides.opening?.doorHp ?? door?.maxHp ?? 0,
    winHp: overrides.opening?.winHp ?? levelOverrides.opening?.winHp ?? win?.maxHp ?? 0,
    winPassSpeed:
      overrides.opening?.winPassSpeed ?? levelOverrides.opening?.winPassSpeed ?? win?.passSpeed ?? 1,
    buildBiteDamage:
      overrides.opening?.buildBiteDamage ?? levelOverrides.opening?.buildBiteDamage ?? map.buildBiteDamage,
    buildBiteSlow:
      overrides.opening?.buildBiteSlow ?? levelOverrides.opening?.buildBiteSlow ?? map.buildBiteSlow,
  };
  openingCache = { map, value };
  return value;
}

/**
 * 单扇开口的生效参数：优先玩家全局覆盖（仍按门 / 窗种类），否则用该扇 JSON 自己的默认值。
 * 门没有全局速度覆盖，始终用自身 JSON 的 `passSpeed`。
 */
export function openingInstance(def: OpeningDef): { maxHp: number; passSpeed: number } {
  const maxHp =
    def.kind === "door"
      ? overrides.opening?.doorHp ?? levelOverrides.opening?.doorHp ?? def.maxHp
      : overrides.opening?.winHp ?? levelOverrides.opening?.winHp ?? def.maxHp;
  const passSpeed =
    def.kind === "window"
      ? overrides.opening?.winPassSpeed ?? levelOverrides.opening?.winPassSpeed ?? def.passSpeed
      : def.passSpeed;
  return { maxHp, passSpeed };
}

/**
 * 启用 / 清空一套按模式的僵尸数值覆盖。
 * 传 null 即回到基础定义；模式数据仍住在各自 config 里，这里不存任何模式专有数值。
 */
export function setZombieModeOverrides(table: ZombieModeOverrideTable | null): void {
  modeZombieOverrides = table ?? {};
  invalidate();
}

/**
 * 合并过覆盖值的僵尸定义（unknown id 回落 normal）。
 * 优先级：玩家覆盖值 > 关卡覆盖值 > 当前模式覆盖表 > 基础定义；
 * 嵌套的 leap / spit / spawner / scream 只在定义已存在时逐字段合并。
 */
export function effectiveZombie(id: string): ZombieDef {
  const def = getZombieDef(id);
  const hit = zombieCache.get(def.id);
  if (hit) return hit;
  const o = overrides.zombie?.types?.[def.id];
  const lo = levelOverrides.zombie?.types?.[def.id];
  const mo = modeZombieOverrides[def.id];
  const value: ZombieDef = {
    ...def,
    hp: o?.hp ?? lo?.hp ?? mo?.hp ?? def.hp,
    speed: o?.speed ?? lo?.speed ?? mo?.speed ?? def.speed,
    bite: o?.bite ?? lo?.bite ?? mo?.bite ?? def.bite,
    damage: o?.damage ?? lo?.damage ?? mo?.damage ?? def.damage,
  };
  if (def.leap) value.leap = { ...def.leap, ...(mo?.leap ?? {}), ...(lo?.leap ?? {}), ...(o?.leap ?? {}) };
  if (def.spit) value.spit = { ...def.spit, ...(mo?.spit ?? {}), ...(lo?.spit ?? {}), ...(o?.spit ?? {}) };
  if (def.spawner)
    value.spawner = { ...def.spawner, ...(mo?.spawner ?? {}), ...(lo?.spawner ?? {}), ...(o?.spawner ?? {}) };
  if (def.scream)
    value.scream = { ...def.scream, ...(mo?.scream ?? {}), ...(lo?.scream ?? {}), ...(o?.scream ?? {}) };
  zombieCache.set(def.id, value);
  return value;
}

/** 合并过覆盖值的人类定义 */
export function effectiveHuman(): HumanDef {
  if (humanCache) return humanCache;
  humanCache = {
    ...HUMAN_DEF,
    hp: overrides.human?.hp ?? levelOverrides.human?.hp ?? HUMAN_DEF.hp,
    speed: overrides.human?.speed ?? levelOverrides.human?.speed ?? HUMAN_DEF.speed,
    sight: overrides.human?.sight ?? levelOverrides.human?.sight ?? HUMAN_DEF.sight,
    turnTime: overrides.human?.turnTime ?? levelOverrides.human?.turnTime ?? HUMAN_DEF.turnTime,
  };
  return humanCache;
}

/** 合并过覆盖值的武器定义（unknown id 回落 mg） */
export function effectiveWeapon(id: string): WeaponDef {
  const def = getWeaponDef(id);
  const hit = weaponCache.get(def.id);
  if (hit) return hit;
  const o = overrides.weapons?.[def.id];
  const lo = levelOverrides.weapons?.[def.id];
  const out: Record<string, unknown> = { ...def };
  for (const src of [lo, o]) {
    if (!src) continue;
    for (const key of WEAPON_KEYS) {
      const v = num((src as Record<string, unknown>)[key]);
      if (v !== undefined) out[key] = v;
    }
  }
  if (def.tesla) out.tesla = { ...def.tesla, ...(lo?.tesla ?? {}), ...(o?.tesla ?? {}) };
  if (def.pierce) out.pierce = { ...def.pierce, ...(lo?.pierce ?? {}), ...(o?.pierce ?? {}) };
  const value = out as unknown as WeaponDef;
  weaponCache.set(def.id, value);
  return value;
}

// ============================================================
// 路径读写（滑块 / 关卡覆盖 / 存档共用）
// ============================================================

/** 从嵌套对象里读一个有限数字，缺失返回 0 */
function nestedNum(obj: unknown, key: string): number {
  if (!obj || typeof obj !== "object") return 0;
  const v = (obj as Record<string, unknown>)[key];
  return isNum(v) ? v : 0;
}

/** 读取设置路径的有效值（覆盖值 ?? 定义默认值） */
export function getSetting(path: string): number {
  const parts = path.split(".");
  const group = parts[0];

  if (group === "wave" && parts.length === 2) {
    const v = settings().wave[parts[1] as keyof WaveSettings];
    return isNum(v) ? v : 0;
  }
  if (group === "human" && parts.length === 2) {
    const v = settings().human[parts[1] as keyof HumanSettings];
    return isNum(v) ? v : 0;
  }
  if (group === "zombie" && parts.length === 2 && parts[1] === "jitter") {
    return settings().zombie.jitter;
  }
  if (group === "zombie" && parts.length === 3) {
    const v = (effectiveZombie(parts[1]) as unknown as Record<string, unknown>)[parts[2]];
    return isNum(v) ? v : 0;
  }
  if (group === "zombie" && parts.length === 4 && parts[2] in ZOMBIE_SUB_KEYS) {
    return nestedNum((effectiveZombie(parts[1]) as unknown as Record<string, unknown>)[parts[2]], parts[3]);
  }
  if (group === "opening" && parts.length === 2) {
    const v = (openingTuning() as unknown as Record<string, unknown>)[parts[1]];
    return isNum(v) ? v : 0;
  }
  if (group === "audio" && parts.length === 2) {
    const v = settings().audio[parts[1] as keyof AudioSettings];
    return isNum(v) ? v : 0;
  }
  if (group === "weapons" && parts.length === 3) {
    const v = (effectiveWeapon(parts[1]) as unknown as Record<string, unknown>)[parts[2]];
    return isNum(v) ? v : 0;
  }
  if (group === "weapons" && parts.length === 4 && parts[2] in WEAPON_SUB_KEYS) {
    return nestedNum((effectiveWeapon(parts[1]) as unknown as Record<string, unknown>)[parts[2]], parts[3]);
  }
  return 0;
}

function setGroupValue(group: keyof SettingsOverrides, key: string, value: number): void {
  const current = (overrides[group] ?? {}) as Record<string, number>;
  current[key] = value;
  overrides[group] = current as never;
}

/** 写入设置路径（只写缓存覆盖值，不落盘） */
export function setSetting(path: string, value: number): void {
  if (!isNum(value)) return;
  const parts = path.split(".");
  const group = parts[0];

  if (group === "wave" && parts.length === 2 && (WAVE_KEYS as readonly string[]).includes(parts[1])) {
    setGroupValue("wave", parts[1], value);
  } else if (group === "human" && parts.length === 2 && (HUMAN_KEYS as readonly string[]).includes(parts[1])) {
    setGroupValue("human", parts[1], value);
  } else if (group === "zombie" && parts.length === 2 && parts[1] === "jitter") {
    overrides.zombie = { ...(overrides.zombie ?? {}), jitter: value };
  } else if (group === "zombie" && parts.length === 3 && hasOwn(ZOMBIE_DEFS, parts[1])) {
    const field = parts[2];
    if (!(ZOMBIE_KEYS as readonly string[]).includes(field)) return;
    const z = (overrides.zombie ??= {});
    z.types ??= {};
    z.types[parts[1]] = { ...(z.types[parts[1]] ?? {}), [field]: value } as Partial<ZombieTunables>;
  } else if (
    group === "zombie" &&
    parts.length === 4 &&
    hasOwn(ZOMBIE_DEFS, parts[1]) &&
    parts[2] in ZOMBIE_SUB_KEYS
  ) {
    const sub = parts[2] as ZombieSubKey;
    if (!(ZOMBIE_SUB_KEYS[sub] as readonly string[]).includes(parts[3])) return;
    const z = (overrides.zombie ??= {});
    z.types ??= {};
    const entry = (z.types[parts[1]] ??= {}) as ZombieTunables;
    entry[sub] = { ...(entry[sub] ?? {}), [parts[3]]: value } as never;
  } else if (group === "opening" && parts.length === 2 && (OPENING_KEYS as readonly string[]).includes(parts[1])) {
    setGroupValue("opening", parts[1], value);
  } else if (group === "audio" && parts.length === 2 && (AUDIO_KEYS as readonly string[]).includes(parts[1])) {
    setGroupValue("audio", parts[1], value);
  } else if (group === "weapons" && parts.length === 3 && hasOwn(WEAPONS, parts[1])) {
    if (!(WEAPON_KEYS as readonly string[]).includes(parts[2])) return;
    overrides.weapons ??= {};
    overrides.weapons[parts[1]] = {
      ...(overrides.weapons[parts[1]] ?? {}),
      [parts[2]]: value,
    } as Partial<WeaponTunables>;
  } else if (
    group === "weapons" &&
    parts.length === 4 &&
    hasOwn(WEAPONS, parts[1]) &&
    parts[2] in WEAPON_SUB_KEYS
  ) {
    const sub = parts[2] as WeaponSubKey;
    if (!(WEAPON_SUB_KEYS[sub] as readonly string[]).includes(parts[3])) return;
    overrides.weapons ??= {};
    const entry = (overrides.weapons[parts[1]] ??= {}) as WeaponTunables;
    entry[sub] = { ...(entry[sub] ?? {}), [parts[3]]: value } as never;
  } else {
    return;
  }
  invalidate();
}

// ============================================================
// 关卡覆盖 / 存档
// ============================================================

/** 解析单只僵尸的覆盖对象：扁平 4 字段 + leap/spit/spawner/scream 子配置 */
function parseZombieEntry(value: unknown): Partial<ZombieTunables> | null {
  if (!value || typeof value !== "object") return null;
  const parsed: Record<string, unknown> = pickNumbers(value, ZOMBIE_KEYS);
  for (const sub of Object.keys(ZOMBIE_SUB_KEYS) as ZombieSubKey[]) {
    const nested = pickNumbers((value as Record<string, unknown>)[sub], ZOMBIE_SUB_KEYS[sub]);
    if (Object.keys(nested).length > 0) parsed[sub] = nested;
  }
  return Object.keys(parsed).length > 0 ? (parsed as Partial<ZombieTunables>) : null;
}

/** 解析单把武器的覆盖对象：扁平字段 + tesla/pierce 子配置 */
function parseWeaponEntry(value: unknown): Partial<WeaponTunables> | null {
  if (!value || typeof value !== "object") return null;
  const parsed: Record<string, unknown> = pickNumbers(value, WEAPON_KEYS);
  for (const sub of Object.keys(WEAPON_SUB_KEYS) as WeaponSubKey[]) {
    const nested = pickNumbers((value as Record<string, unknown>)[sub], WEAPON_SUB_KEYS[sub]);
    if (Object.keys(nested).length > 0) parsed[sub] = nested;
  }
  return Object.keys(parsed).length > 0 ? (parsed as Partial<WeaponTunables>) : null;
}

/** 把两层子配置合并（后层覆盖前层，未出现的字段保留） */
function mergeSub(
  prev: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!prev && !next) return undefined;
  return { ...(prev ?? {}), ...(next ?? {}) };
}

/** 解析任意来源（新格式 / 旧 SETTINGS 快照 / 脏数据）为安全覆盖值 */
export function parseOverrides(raw: unknown): SettingsOverrides {
  const out: SettingsOverrides = {};
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;

  const wave = pickNumbers(src.wave, WAVE_KEYS);
  if (Object.keys(wave).length > 0) out.wave = wave as Partial<WaveSettings>;

  const human = pickNumbers(src.human, HUMAN_KEYS);
  if (Object.keys(human).length > 0) out.human = human as SettingsOverrides["human"];

  const opening = pickNumbers(src.opening, OPENING_KEYS);
  if (Object.keys(opening).length > 0) out.opening = opening as Partial<OpeningTuning>;

  const audio = pickNumbers(src.audio, AUDIO_KEYS);
  if (Object.keys(audio).length > 0) out.audio = audio as Partial<AudioSettings>;

  const zsrc = src.zombie;
  if (zsrc && typeof zsrc === "object") {
    const zo = zsrc as Record<string, unknown>;
    const types: Record<string, Partial<ZombieTunables>> = {};
    // 兼容旧格式：zombie.normal / zombie.runner 直接挂在 zombie 下
    for (const [id, value] of Object.entries(zo)) {
      if (id === "jitter" || id === "types") continue;
      if (!hasOwn(ZOMBIE_DEFS, id)) continue;
      const parsed = parseZombieEntry(value);
      if (parsed) types[id] = parsed;
    }
    // 新格式：zombie.types.<id>
    if (zo.types && typeof zo.types === "object") {
      for (const [id, value] of Object.entries(zo.types as Record<string, unknown>)) {
        if (!hasOwn(ZOMBIE_DEFS, id)) continue;
        const parsed = parseZombieEntry(value);
        if (parsed) types[id] = parsed;
      }
    }
    const jitter = num(zo.jitter);
    if (jitter !== undefined || Object.keys(types).length > 0) {
      out.zombie = { ...(jitter !== undefined ? { jitter } : {}), ...(Object.keys(types).length > 0 ? { types } : {}) };
    }
  }

  const wsrc = src.weapons;
  if (wsrc && typeof wsrc === "object") {
    const weapons: Record<string, Partial<WeaponTunables>> = {};
    for (const [id, value] of Object.entries(wsrc as Record<string, unknown>)) {
      if (!hasOwn(WEAPONS, id)) continue;
      const parsed = parseWeaponEntry(value);
      if (parsed) weapons[id] = parsed;
    }
    if (Object.keys(weapons).length > 0) out.weapons = weapons;
  }

  return out;
}

function mergeParsed(src: SettingsOverrides): void {
  if (src.wave) overrides.wave = { ...(overrides.wave ?? {}), ...src.wave };
  if (src.human) overrides.human = { ...(overrides.human ?? {}), ...src.human };
  if (src.opening) overrides.opening = { ...(overrides.opening ?? {}), ...src.opening };
  if (src.audio) overrides.audio = { ...(overrides.audio ?? {}), ...src.audio };
  if (src.zombie) {
    const z = (overrides.zombie ??= {});
    if (src.zombie.jitter !== undefined) z.jitter = src.zombie.jitter;
    if (src.zombie.types) {
      z.types ??= {};
      for (const [id, value] of Object.entries(src.zombie.types)) {
        const prev = z.types[id] as Record<string, unknown> | undefined;
        const next = value as Record<string, unknown>;
        z.types[id] = {
          ...(prev ?? {}),
          ...next,
          leap: mergeSub(prev?.leap as Record<string, unknown>, next.leap as Record<string, unknown>),
          spit: mergeSub(prev?.spit as Record<string, unknown>, next.spit as Record<string, unknown>),
          spawner: mergeSub(prev?.spawner as Record<string, unknown>, next.spawner as Record<string, unknown>),
          scream: mergeSub(prev?.scream as Record<string, unknown>, next.scream as Record<string, unknown>),
        } as Partial<ZombieTunables>;
      }
    }
  }
  if (src.weapons) {
    overrides.weapons ??= {};
    for (const [id, value] of Object.entries(src.weapons)) {
      const prev = overrides.weapons[id] as Record<string, unknown> | undefined;
      const next = value as Record<string, unknown>;
      overrides.weapons[id] = {
        ...(prev ?? {}),
        ...next,
        tesla: mergeSub(prev?.tesla as Record<string, unknown>, next.tesla as Record<string, unknown>),
        pierce: mergeSub(prev?.pierce as Record<string, unknown>, next.pierce as Record<string, unknown>),
      } as Partial<WeaponTunables>;
    }
  }
  invalidate();
}

/** 应用一局的关卡覆盖值（替换而非合并，退出 / 换关由 clearLevelOverrides 清空） */
export function setLevelOverrides(partial: SettingsOverrides | undefined): void {
  levelOverrides = parseOverrides(partial);
  invalidate();
}

/** 清空本局关卡覆盖值（离开战斗路由 / 换关时调用） */
export function clearLevelOverrides(): void {
  levelOverrides = {};
  invalidate();
}

/** 合并一组覆盖值（导入存档用；不再用于关卡，避免污染全局面板） */
export function applySettings(partial: SettingsOverrides | undefined): void {
  if (!partial) return;
  mergeParsed(parseOverrides(partial));
}

/** 用存档内容替换全部覆盖值（启动读取 / 本地目录读取用） */
export function replaceOverrides(raw: unknown): void {
  overrides = parseOverrides(raw);
  invalidate();
}

/** 合并存档内容到当前覆盖值（手动导入用） */
export function mergeOverrides(raw: unknown): void {
  mergeParsed(parseOverrides(raw));
}

/** 清空全部覆盖值（含本局关卡值），回到定义默认值 */
export function clearOverrides(): void {
  overrides = {};
  levelOverrides = {};
  invalidate();
}

/** 落盘用的纯数据快照（深拷贝，避免外部改动运行时状态） */
export function getOverridesSnapshot(): SettingsOverrides {
  return JSON.parse(JSON.stringify(overrides)) as SettingsOverrides;
}
