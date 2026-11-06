/**
 * 关卡定义 —— 每关有独立的 settings 覆盖，以及可选的开场/胜利文案。
 * 现在只有一关，但结构按可扩展设计。
 */
import type { SettingsOverrides } from "./data/types";

/** 关卡难度星数 1~5 */
export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface LevelDef {
  /** 唯一 ID，存档里用 */
  id: string;
  /** 显示名，选关页卡片标题 */
  title: string;
  /** 简短介绍 */
  description: string;
  /** 选关地图上的节点 X 坐标（0~100 百分比）—— 横向节点式布局 */
  nodeX: number;
  /** 选关地图上的节点 Y 坐标（百分比）—— 允许轻微上下起伏让地图好看 */
  nodeY: number;
  /** 难度星数 */
  difficulty: Difficulty;
  /** 本关使用的地图 id（对应 public/maps/<id>.json）；不存在时回退默认图并提示 */
  mapId: string;
  /**
   * 这关专属的设置覆盖。只写要改的字段，没写的沿用实体定义默认值。
   * 比如第 1 关僵尸弱，就只覆盖 zombie.types.normal.hp / speed；第 2 关波次更长，覆盖 wave.count。
   * 空对象就是"用默认设置不做任何改动"。
   */
  settings: SettingsOverrides;
  /** 通关弹窗显示的祝贺文案 */
  victoryText?: string;
}

/**
 * 所有关卡列表 —— 按顺序排（选关地图从左到右）。
 * 以后加关卡只需 push 一项，ID 不要改，改了存档里的进度会乱。
 */
export const LEVELS: LevelDef[] = [
  {
    id: "level-1",
    title: "初次尸潮",
    description: "第一批丧尸从走廊和窗口逼近。守住门口，别让它扩散到中央区。",
    nodeX: 10,
    nodeY: 50,
    difficulty: 1,
    mapId: "arena",
    settings: {
      wave: { count: 8, base: 120, growth: 1.06, spawnBase: 12, spawnPerWave: 2, spawnMax: 80, maxAlive: 400, reinforce: 1 },
      human: { start: 50, cap: 50, hp: 100, speed: 54, sight: 420, turnTime: 2.8 },
      zombie: { jitter: 0.2, types: { normal: { hp: 80, speed: 48, bite: 0.55 }, runner: { hp: 40, speed: 85, bite: 0.7 } } },
      opening: { doorHp: 450, winHp: 100, winPassSpeed: 0.45, buildBiteDamage: 4, buildBiteSlow: 1.5 },
    },
    victoryText: "第 1 关已通关！你守住了第一次尸潮。",
  },
];

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
