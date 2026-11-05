import type { MapDef } from "../types";
import { arena } from "./arena";

export type { MapDef } from "../types";

/**
 * 地图注册表：id -> 定义。
 * 新增地图只需新建文件并在这里加一行；MAP_LIST 会自动包含它。
 */
export const MAPS: Record<string, MapDef> = {
  arena,
};

/** 有序地图列表（顺序只影响展示，不承担身份语义） */
export const MAP_LIST: MapDef[] = Object.values(MAPS);

/** 当前默认地图；入口暂不提供地图选择 */
export const DEFAULT_MAP: MapDef = arena;

export function getMap(id: string): MapDef {
  return MAPS[id] ?? DEFAULT_MAP;
}
