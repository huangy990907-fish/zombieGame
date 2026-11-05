/**
 * 「人 + 枪」烘焙：把武器图层按 overlay 偏移压进人物帧，输出一份独立的
 * 调色板 + 字符矩阵。烘焙后它就是一个普通 SpriteDef，渲染层不需要知道枪的存在；
 * 描边也不会再出现「人一圈、枪一圈」的内部描边，而是跟着合成后的外轮廓走。
 */
import { SPRITE_SIZE, type Frames, type Palette, type SpriteDef } from "./types";

/** 烘焙后调色板可用的字模（不含 "."） */
const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export interface BakePair {
  /** 烘焙后的帧名 */
  name: string;
  /** 底图帧名 */
  base: string;
  /** 武器帧名 */
  overlay: string;
}

function paint(
  grid: Array<string | null>,
  def: SpriteDef,
  frameName: string,
  offsetX: number,
  offsetY: number,
): void {
  const rows = def.frames[frameName] ?? def.frames[Object.keys(def.frames)[0]];
  for (let y = 0; y < SPRITE_SIZE; y++) {
    const row = rows[y] ?? "";
    for (let x = 0; x < SPRITE_SIZE; x++) {
      const ch = row[x] ?? ".";
      if (ch === ".") continue;
      const color = def.palette[ch];
      if (!color) continue;
      const tx = x + offsetX;
      const ty = y + offsetY;
      if (tx < 0 || tx >= SPRITE_SIZE || ty < 0 || ty >= SPRITE_SIZE) continue;
      grid[ty * SPRITE_SIZE + tx] = color;
    }
  }
}

/**
 * 把 overlay 精灵烘焙进 base 精灵的每一帧。
 * 返回的新调色板按「首次出现的颜色」顺序分配字模，因此结果稳定、可复现。
 */
export function bakeOverlay(
  base: SpriteDef,
  overlay: SpriteDef,
  pairs: BakePair[],
): { palette: Palette; frames: Frames } {
  const palette: Palette = {};
  const hexToChar = new Map<string, string>();
  const offset = overlay.overlay ?? { dx: 0, dy: 0 };

  const charFor = (hex: string): string => {
    const found = hexToChar.get(hex);
    if (found) return found;
    const ch = CHARS[hexToChar.size];
    if (!ch) throw new Error(`烘焙调色板超过 ${CHARS.length} 色：${hex}`);
    hexToChar.set(hex, ch);
    palette[ch] = hex;
    return ch;
  };

  const frames: Frames = {};
  for (const pair of pairs) {
    const grid: Array<string | null> = new Array(SPRITE_SIZE * SPRITE_SIZE).fill(null);
    paint(grid, base, pair.base, 0, 0);
    paint(grid, overlay, pair.overlay, offset.dx, offset.dy);

    const rows: string[] = [];
    for (let y = 0; y < SPRITE_SIZE; y++) {
      let row = "";
      for (let x = 0; x < SPRITE_SIZE; x++) {
        const hex = grid[y * SPRITE_SIZE + x];
        row += hex ? charFor(hex) : ".";
      }
      rows.push(row);
    }
    frames[pair.name] = rows;
  }

  return { palette, frames };
}
