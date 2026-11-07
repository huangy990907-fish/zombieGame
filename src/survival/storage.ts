/**
 * 「尸潮求生」仅持久化两项记录：最佳存活时间（秒）与最高等级。
 * 每次重开完全重置本局状态，存档只影响失败界面的展示。
 */

const LS_KEY = "zombieGame.survival.v1";

export interface SurvivalRecord {
  bestTime: number;
  bestLevel: number;
}

const EMPTY: SurvivalRecord = { bestTime: 0, bestLevel: 0 };

export function loadSurvivalRecord(): SurvivalRecord {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...EMPTY };
    const bestTime = Number(parsed.bestTime);
    const bestLevel = Number(parsed.bestLevel);
    return {
      bestTime: Number.isFinite(bestTime) && bestTime > 0 ? bestTime : 0,
      bestLevel: Number.isFinite(bestLevel) && bestLevel > 0 ? Math.floor(bestLevel) : 0,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveSurvivalRecord(record: SurvivalRecord): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(record));
  } catch {
    // 隐私模式等场景静默失败
  }
}

export function clearSurvivalRecord(): void {
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    // 忽略
  }
}

export function survivalRecordKey(): string {
  return LS_KEY;
}
