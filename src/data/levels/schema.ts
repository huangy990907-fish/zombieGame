/**
 * 关卡 JSON 结构与校验。
 *
 * 0.6.0 起关卡以 `public/levels/<id>.json` + manifest 为运行时来源：
 * 关卡只引用地图 id，不复制地图数据；人类按武器种类配置库存，波次按组配置。
 */
import { MAPS } from "../maps";
import { WEAPON_IDS, WEAPONS } from "../weapons";
import { ZOMBIE_IDS } from "../zombies";
import type { SettingsOverrides } from "../types";

export const LEVEL_SCHEMA_VERSION = 1;

/** 一种「人类种类」= 一种武器；库存与生命值按武器独立配置 */
export interface LevelHumanConfig {
  /** 武器 id（= 人类种类） */
  id: string;
  /** 是否在本关启用 */
  enabled: boolean;
  /** 该种类人类的血量上限 */
  hp: number;
  /** 开局库存 */
  initial: number;
  /** 库存上限 */
  cap: number;
  /** 恢复间隔（秒 / 个）；满仓停表 */
  regen: number;
}

/** 一波内的一种僵尸与只数 */
export interface LevelWaveGroup {
  kind: string;
  count: number;
}

export interface LevelWave {
  zombies: LevelWaveGroup[];
  /** 本波结束后到下一波的间隔（秒）；缺省 1.8 */
  interval?: number;
}

export interface LevelJson {
  schemaVersion: number;
  id: string;
  name: string;
  /** 绑定地图 id；必须已在地图注册表中 */
  mapId: string;
  mode: "placement";
  humans: LevelHumanConfig[];
  waves: LevelWave[];
  /**
   * 可选的兼容调参块（沿用旧关卡的波次节奏 / 僵尸血量）。
   * 第 3 阶段局内玩法接管后，`waves` 是正式波次来源；编辑器表单不编辑这里。
   */
  settings?: SettingsOverrides;
}

export function levelTotalZombies(level: Pick<LevelJson, "waves">): number {
  return level.waves.reduce(
    (sum, wave) => sum + wave.zombies.reduce((n, group) => n + group.count, 0),
    0,
  );
}

export function levelEnabledHumans(level: Pick<LevelJson, "humans">): LevelHumanConfig[] {
  return level.humans.filter((h) => h.enabled);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * 校验关卡 JSON。
 * 返回空数组表示通过；否则每条是可直接展示给用户的中文错误。
 */
export function validateLevelJson(raw: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(raw)) return ["关卡数据不是对象"];

  if (raw.schemaVersion !== LEVEL_SCHEMA_VERSION) {
    errors.push(`schemaVersion 必须为 ${LEVEL_SCHEMA_VERSION}`);
  }

  const id = raw.id;
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) {
    errors.push("id 必须是 1–32 位小写字母 / 数字 / - / _");
  }

  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (name.length < 1 || name.length > 24) {
    errors.push("name 去首尾空格后必须是 1–24 个字符");
  }

  if (raw.mode !== "placement") {
    errors.push("mode 必须是 placement");
  }

  if (typeof raw.mapId !== "string" || !MAPS[raw.mapId]) {
    errors.push(`mapId「${String(raw.mapId)}」未注册`);
  }

  // 人类：至少启用 1 种，且字段合法
  if (!Array.isArray(raw.humans) || raw.humans.length === 0) {
    errors.push("humans 至少需要 1 项");
  } else {
    const seen = new Set<string>();
    let enabled = 0;
    raw.humans.forEach((item, i) => {
      if (!isRecord(item)) {
        errors.push(`humans[${i}] 不是对象`);
        return;
      }
      const hid = item.id;
      if (typeof hid !== "string" || !WEAPONS[hid]) {
        errors.push(`humans[${i}].id「${String(hid)}」不是已注册武器`);
      } else if (seen.has(hid)) {
        errors.push(`humans 中武器「${hid}」重复`);
      } else {
        seen.add(hid);
      }
      if (typeof item.enabled !== "boolean") errors.push(`humans[${i}].enabled 必须是布尔值`);
      if (item.enabled === true) enabled++;
      if (typeof item.hp !== "number" || !(item.hp > 0)) {
        errors.push(`humans[${i}].hp 必须大于 0`);
      }
      if (!isPositiveInt(item.cap)) {
        errors.push(`humans[${i}].cap 必须是正整数`);
      }
      if (
        !Number.isInteger(item.initial) ||
        (item.initial as number) < 0 ||
        (typeof item.cap === "number" && (item.initial as number) > item.cap)
      ) {
        errors.push(`humans[${i}].initial 必须是 0..cap 的整数`);
      }
      if (typeof item.regen !== "number" || !(item.regen > 0)) {
        errors.push(`humans[${i}].regen 必须大于 0`);
      }
    });
    if (enabled === 0) errors.push("至少需要启用 1 种人类");
  }

  // 波次
  if (!Array.isArray(raw.waves) || raw.waves.length === 0) {
    errors.push("waves 至少需要 1 波");
  } else {
    const knownZombies = new Set<string>(Object.values(ZOMBIE_IDS));
    raw.waves.forEach((wave, wi) => {
      if (!isRecord(wave)) {
        errors.push(`waves[${wi}] 不是对象`);
        return;
      }
      if (wave.interval !== undefined && (typeof wave.interval !== "number" || wave.interval < 0)) {
        errors.push(`waves[${wi}].interval 必须是不小于 0 的数字`);
      }
      if (!Array.isArray(wave.zombies) || wave.zombies.length === 0) {
        errors.push(`waves[${wi}] 至少需要 1 种僵尸`);
        return;
      }
      let total = 0;
      wave.zombies.forEach((group, gi) => {
        if (!isRecord(group)) {
          errors.push(`waves[${wi}].zombies[${gi}] 不是对象`);
          return;
        }
        if (typeof group.kind !== "string" || !knownZombies.has(group.kind)) {
          errors.push(`waves[${wi}].zombies[${gi}].kind「${String(group.kind)}」未注册`);
        }
        if (!isPositiveInt(group.count)) {
          errors.push(`waves[${wi}].zombies[${gi}].count 必须是正整数`);
        } else {
          total += group.count;
        }
      });
      if (total === 0) errors.push(`waves[${wi}] 的僵尸总数为 0`);
    });
  }

  if (raw.settings !== undefined && !isRecord(raw.settings)) {
    errors.push("settings 必须是对象");
  }

  return errors;
}

/** 关卡 id 白名单（与工坊一致） */
export const LEVEL_ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const LEVEL_WEAPON_ORDER: string[] = [
  WEAPON_IDS.mg,
  WEAPON_IDS.flame,
  WEAPON_IDS.shotgun,
  WEAPON_IDS.rocket,
  WEAPON_IDS.tesla,
];
