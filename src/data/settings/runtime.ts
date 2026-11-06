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
  OpeningTuning,
  RuntimeSettings,
  SettingsOverrides,
  WaveSettings,
  WeaponDef,
  WeaponTunables,
  ZombieDef,
  ZombieTunables,
} from "../types";
import { DEFAULT_BASE_SETTINGS } from "./defaults";

const WAVE_KEYS = [
  "count",
  "base",
  "growth",
  "spawnBase",
  "spawnPerWave",
  "spawnMax",
  "maxAlive",
  "reinforce",
] as const;
const HUMAN_KEYS = ["start", "cap", "hp", "speed", "sight", "turnTime"] as const;
const ZOMBIE_KEYS = ["hp", "speed", "bite", "damage"] as const;
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
] as const;

let overrides: SettingsOverrides = {};
let cache: RuntimeSettings | null = null;
/** 合并后的实体定义缓存，避免每帧为每只单位重复创建对象 */
let humanCache: HumanDef | null = null;
const zombieCache = new Map<string, ZombieDef>();
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
    wave: mergeNumbers(DEFAULT_BASE_SETTINGS.wave, overrides.wave),
    human: {
      start: overrides.human?.start ?? DEFAULT_BASE_SETTINGS.human.start,
      cap: overrides.human?.cap ?? DEFAULT_BASE_SETTINGS.human.cap,
      hp: overrides.human?.hp ?? HUMAN_DEF.hp,
      speed: overrides.human?.speed ?? HUMAN_DEF.speed,
      sight: overrides.human?.sight ?? HUMAN_DEF.sight,
      turnTime: overrides.human?.turnTime ?? HUMAN_DEF.turnTime,
    },
    zombie: {
      jitter: overrides.zombie?.jitter ?? DEFAULT_BASE_SETTINGS.zombie.jitter,
    },
    opening: openingTuning(map),
    audio: mergeNumbers(DEFAULT_BASE_SETTINGS.audio, overrides.audio),
  };
}

/** 当前生效设置（默认地图口径；只有一个地图时足够用） */
export function settings(): RuntimeSettings {
  return (cache ??= build(DEFAULT_MAP));
}

/** 把地图自带的开口默认值和玩家覆盖值合并 */
export function openingTuning(map: MapDef = DEFAULT_MAP): OpeningTuning {
  if (openingCache && openingCache.map === map) return openingCache.value;
  const door = map.openings.find((o) => o.kind === "door") ?? map.openings[0];
  const win = map.openings.find((o) => o.kind === "window") ?? map.openings[0];
  const value: OpeningTuning = {
    doorHp: overrides.opening?.doorHp ?? door.maxHp,
    winHp: overrides.opening?.winHp ?? win.maxHp,
    winPassSpeed: overrides.opening?.winPassSpeed ?? win.passSpeed,
    buildBiteDamage: overrides.opening?.buildBiteDamage ?? map.buildBiteDamage,
    buildBiteSlow: overrides.opening?.buildBiteSlow ?? map.buildBiteSlow,
  };
  openingCache = { map, value };
  return value;
}

/** 合并过覆盖值的僵尸定义（unknown id 回落 normal） */
export function effectiveZombie(id: string): ZombieDef {
  const def = getZombieDef(id);
  const hit = zombieCache.get(def.id);
  if (hit) return hit;
  const o = overrides.zombie?.types?.[def.id];
  const value: ZombieDef = {
    ...def,
    hp: o?.hp ?? def.hp,
    speed: o?.speed ?? def.speed,
    bite: o?.bite ?? def.bite,
    damage: o?.damage ?? def.damage,
  };
  zombieCache.set(def.id, value);
  return value;
}

/** 合并过覆盖值的人类定义 */
export function effectiveHuman(): HumanDef {
  if (humanCache) return humanCache;
  humanCache = {
    ...HUMAN_DEF,
    hp: overrides.human?.hp ?? HUMAN_DEF.hp,
    speed: overrides.human?.speed ?? HUMAN_DEF.speed,
    sight: overrides.human?.sight ?? HUMAN_DEF.sight,
    turnTime: overrides.human?.turnTime ?? HUMAN_DEF.turnTime,
  };
  return humanCache;
}

/** 合并过覆盖值的武器定义（unknown id 回落 mg） */
export function effectiveWeapon(id: string): WeaponDef {
  const def = getWeaponDef(id);
  const hit = weaponCache.get(def.id);
  if (hit) return hit;
  const o = overrides.weapons?.[def.id];
  const out: Record<string, unknown> = { ...def };
  if (o) {
    for (const key of WEAPON_KEYS) {
      const v = num((o as Record<string, unknown>)[key]);
      if (v !== undefined) out[key] = v;
    }
  }
  const value = out as unknown as WeaponDef;
  weaponCache.set(def.id, value);
  return value;
}

// ============================================================
// 路径读写（滑块 / 关卡覆盖 / 存档共用）
// ============================================================

/** 读取设置路径的有效值（覆盖值 ?? 定义默认值） */
export function getSetting(path: string): number {
  const parts = path.split(".");
  const group = parts[0];

  if (group === "wave" && parts.length === 2) {
    const key = parts[1] as keyof WaveSettings;
    const v = overrides.wave?.[key] ?? DEFAULT_BASE_SETTINGS.wave[key];
    return isNum(v) ? v : 0;
  }
  if (group === "human" && parts.length === 2) {
    const key = parts[1] as keyof HumanSettings;
    const base = key === "start" || key === "cap" ? settings().human[key] : effectiveHuman()[key as keyof HumanDef];
    return isNum(base) ? base : 0;
  }
  if (group === "zombie" && parts.length === 2 && parts[1] === "jitter") {
    return settings().zombie.jitter;
  }
  if (group === "zombie" && parts.length === 3) {
    const def = effectiveZombie(parts[1]);
    const v = (def as unknown as Record<string, unknown>)[parts[2]];
    return isNum(v) ? v : 0;
  }
  if (group === "opening" && parts.length === 2) {
    const v = (openingTuning() as unknown as Record<string, unknown>)[parts[1]];
    return isNum(v) ? v : 0;
  }
  if (group === "audio" && parts.length === 2) {
    const key = parts[1] as keyof AudioSettings;
    const v = overrides.audio?.[key] ?? DEFAULT_BASE_SETTINGS.audio[key];
    return isNum(v) ? v : 0;
  }
  if (group === "weapons" && parts.length === 3) {
    const v = (effectiveWeapon(parts[1]) as unknown as Record<string, unknown>)[parts[2]];
    return isNum(v) ? v : 0;
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
    z.types[parts[1]] = { ...(z.types[parts[1] ?? ""] ?? {}), [field]: value } as Partial<ZombieTunables>;
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
  } else {
    return;
  }
  invalidate();
}

// ============================================================
// 关卡覆盖 / 存档
// ============================================================

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
      const parsed = pickNumbers(value, ZOMBIE_KEYS);
      if (Object.keys(parsed).length > 0) types[id] = parsed as Partial<ZombieTunables>;
    }
    // 新格式：zombie.types.<id>
    if (zo.types && typeof zo.types === "object") {
      for (const [id, value] of Object.entries(zo.types as Record<string, unknown>)) {
        if (!hasOwn(ZOMBIE_DEFS, id)) continue;
        const parsed = pickNumbers(value, ZOMBIE_KEYS);
        if (Object.keys(parsed).length > 0) types[id] = parsed as Partial<ZombieTunables>;
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
      const parsed = pickNumbers(value, WEAPON_KEYS);
      if (Object.keys(parsed).length > 0) weapons[id] = parsed as Partial<WeaponTunables>;
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
        z.types[id] = { ...(z.types[id] ?? {}), ...value };
      }
    }
  }
  if (src.weapons) {
    overrides.weapons ??= {};
    for (const [id, value] of Object.entries(src.weapons)) {
      overrides.weapons[id] = { ...(overrides.weapons[id] ?? {}), ...value };
    }
  }
  invalidate();
}

/** 合并一组覆盖值（关卡 settings、导入存档用） */
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

/** 清空全部覆盖值，回到定义默认值 */
export function clearOverrides(): void {
  overrides = {};
  invalidate();
}

/** 落盘用的纯数据快照（深拷贝，避免外部改动运行时状态） */
export function getOverridesSnapshot(): SettingsOverrides {
  return JSON.parse(JSON.stringify(overrides)) as SettingsOverrides;
}
