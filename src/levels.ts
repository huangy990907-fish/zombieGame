/**
 * 关卡展示层 —— 把 `data/levels` 的 JSON 定义投影成选关页 / 战斗需要的数据。
 *
 * 0.6.0 起 JSON 只存玩法字段（name / mapId / humans / waves）；这里补出
 * 旧 UI 需要的标题、简介、难度星、节点坐标，避免选关页在阶段 2 重写前失效。
 * `LEVELS` 与 `data/levels` 的注册表保持同步：加载完 JSON 后调用 `refreshLevelDefs()`。
 */
import { LEVELS as LEVEL_DATA, levelTotalZombies } from "./data/levels";
import type { LevelJson } from "./data/levels/schema";
import { getMap } from "./data/maps";
import type { SettingsOverrides } from "./data/types";

export type {
  LevelHumanConfig,
  LevelJson,
  LevelWave,
  LevelWaveGroup,
} from "./data/levels/schema";

/** 关卡难度星数 1~5 */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface LevelDef extends LevelJson {
  /** 显示名（= JSON name） */
  title: string;
  /** 简短介绍（由波次数 / 丧尸数 / 地图名自动生成） */
  description: string;
  /** 选关页节点坐标（百分比）；阶段 2 改为列表后仍保留，避免旧代码报错 */
  nodeX: number;
  nodeY: number;
  difficulty: Difficulty;
  /** 通关弹窗文案 */
  victoryText: string;
  /**
   * 旧版 Game 仍读取这里的设置覆盖；JSON 的 `settings` 原样透传，
   * 第 3 阶段由 `waves` 接管波次后只保留僵尸血量等微调。
   */
  settings: SettingsOverrides;
}

/** 与 data/levels 注册表同步的展示列表 */
export const LEVELS: LevelDef[] = [];

function difficultyOf(json: LevelJson): Difficulty {
  const waves = json.waves.length;
  const total = levelTotalZombies(json);
  if (waves >= 16 || total >= 3000) return 5;
  if (waves >= 12 || total >= 2000) return 4;
  if (waves >= 9 || total >= 1200) return 3;
  if (waves >= 5 || total >= 500) return 2;
  return 1;
}

function describe(json: LevelJson): string {
  const map = getMap(json.mapId);
  return `${json.waves.length} 波 · ${levelTotalZombies(json)} 只丧尸 · 地图 ${map.name}`;
}

function project(json: LevelJson, index: number): LevelDef {
  return {
    ...json,
    title: json.name,
    description: describe(json),
    nodeX: 10 + index * 12,
    nodeY: 50,
    difficulty: difficultyOf(json),
    victoryText: `「${json.name}」已通关！`,
    settings: json.settings ?? {},
  };
}

/** 关卡 JSON 重新加载后同步展示层（就地修改，保持引用稳定） */
export function refreshLevelDefs(): void {
  LEVELS.length = 0;
  LEVEL_DATA.forEach((json, index) => LEVELS.push(project(json, index)));
}

refreshLevelDefs();

/** 关卡按 id 查找 */
export function findLevel(id: string): LevelDef | undefined {
  return LEVELS.find((l) => l.id === id);
}

export type MapReferenceKind = "level" | "placement" | "challenge";

/** 一张地图被哪些关卡 / 模式引用（删除地图前的保护查询） */
export interface MapReference {
  kind: MapReferenceKind;
  /** 引用方的 id（关卡 id / 模式 id） */
  id: string;
  /** 给用户看的原因，例如「第 1 关「初次尸潮」」 */
  label: string;
  mapId: string;
}

/**
 * 未来放置 / 闯关模式的地图引用登记点：
 * 新增模式时在初始化处调用 registerMapReference()，删除保护会自动跟着生效。
 */
const EXTRA_MAP_REFERENCES: MapReference[] = [];

export function registerMapReference(ref: MapReference): void {
  EXTRA_MAP_REFERENCES.push(ref);
}

/** 扫描所有关卡 / 模式对某张地图的引用；命中则不允许删除该图 */
export function getMapReferences(mapId: string): MapReference[] {
  const refs: MapReference[] = [];
  LEVELS.forEach((level, index) => {
    if (level.mapId !== mapId) return;
    refs.push({
      kind: "level",
      id: level.id,
      label: `第 ${index + 1} 关「${level.title}」`,
      mapId,
    });
  });
  for (const ref of EXTRA_MAP_REFERENCES) {
    if (ref.mapId === mapId) refs.push(ref);
  }
  return refs;
}

export type LevelReferenceKind = "campaign" | "challenge";

/** 关卡被哪些模式引用（删除关卡前的保护查询） */
export interface LevelReference {
  kind: LevelReferenceKind;
  /** 引用方 id（模式 / 关卡链 id） */
  id: string;
  /** 给用户看的原因 */
  label: string;
}

/** 未来闯关 / 挑战模式对关卡的引用登记点 */
const EXTRA_LEVEL_REFERENCES: LevelReference[] = [];

export function registerLevelReference(ref: LevelReference): void {
  EXTRA_LEVEL_REFERENCES.push(ref);
}

export function getLevelReferences(levelId: string): LevelReference[] {
  return EXTRA_LEVEL_REFERENCES.filter((ref) => ref.id === levelId);
}
