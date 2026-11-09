import { OUTLINE_COLOR, spriteGrid, type SpriteDef, type Vec2 } from "./types";

/** 描边样式：0 = 无描边，1 = 1px，2 = 2px（加粗） */
export type OutlineMode = 0 | 1 | 2;

/** 原生分辨率画布的缓存键 */
const nativeCache = new Map<string, HTMLCanvasElement>();

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return canvas;
}

function getCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("浏览器不支持 2D canvas");
  return ctx;
}

/**
 * 把一帧字符矩阵画成原生网格画布（带描边），并按 id|帧|描边 缓存。
 * 网格尺寸取自 def.grid（默认 32×32）；描边通过对不透明像素做 N 次四邻域膨胀得到，
 * 保证外轮廓完整闭合。
 */
export function getNativeFrame(def: SpriteDef, frameName: string, outline: OutlineMode = 1): HTMLCanvasElement {
  const key = `${def.id}|${frameName}|${outline}`;
  const cached = nativeCache.get(key);
  if (cached) return cached;

  const fallbackName = Object.keys(def.frames)[0];
  const rows = def.frames[frameName] ?? def.frames[fallbackName];

  // 1. 解析字符矩阵 -> 颜色 + 不透明掩码
  const { w: size, h: height } = spriteGrid(def);
  const total = size * height;
  const colors = new Array<string | null>(total).fill(null);
  const mask = new Uint8Array(total);
  for (let y = 0; y < height; y++) {
    const row = rows?.[y] ?? "";
    for (let x = 0; x < size; x++) {
      const ch = row[x] ?? ".";
      if (ch === ".") continue;
      const color = def.palette[ch];
      if (!color) continue;
      const i = y * size + x;
      colors[i] = color;
      mask[i] = 1;
    }
  }

  // 2. 逐圈膨胀得到描边像素
  const outlineIdx: number[] = [];
  if (outline > 0) {
    let filled = mask.slice();
    for (let ring = 0; ring < outline; ring++) {
      const next = filled.slice();
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          if (filled[i]) continue;
          if (
            (x > 0 && filled[i - 1]) ||
            (x < size - 1 && filled[i + 1]) ||
            (y > 0 && filled[i - size]) ||
            (y < height - 1 && filled[i + size])
          ) {
            next[i] = 1;
            outlineIdx.push(i);
          }
        }
      }
      filled = next;
    }
  }

  // 3. 写进 ImageData，先铺描边再铺本体
  const canvas = createCanvas(size, height);
  const ctx = getCtx(canvas);
  const image = ctx.createImageData(size, height);
  const data = image.data;
  const [or, og, ob] = hexToRgb(OUTLINE_COLOR);
  for (let i = 0; i < outlineIdx.length; i++) {
    const p = outlineIdx[i] * 4;
    data[p] = or;
    data[p + 1] = og;
    data[p + 2] = ob;
    data[p + 3] = 255;
  }
  for (let i = 0; i < total; i++) {
    const color = colors[i];
    if (!color) continue;
    const [r, g, b] = hexToRgb(color);
    const p = i * 4;
    data[p] = r;
    data[p + 1] = g;
    data[p + 2] = b;
    data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);

  nativeCache.set(key, canvas);
  return canvas;
}

/** 把原生网格画布按整数倍放大（像素风必须关掉平滑） */
export function renderFrame(
  def: SpriteDef,
  frameName: string,
  opts: { scale?: number; outline?: OutlineMode } = {},
): HTMLCanvasElement {
  const scale = opts.scale ?? 1;
  const outline = opts.outline ?? 1;
  const src = getNativeFrame(def, frameName, outline);
  const canvas = createCanvas(src.width * scale, src.height * scale);
  const ctx = getCtx(canvas);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** 缩放到指定像素直径（模拟游戏内 11px / 12px 的实际观感，使用线性过滤；保持网格长宽比） */
export function renderAtSize(def: SpriteDef, frameName: string, size: number, outline: OutlineMode = 1): HTMLCanvasElement {
  const src = getNativeFrame(def, frameName, outline);
  const canvas = createCanvas(size, Math.max(1, Math.round((size * src.height) / src.width)));
  const ctx = getCtx(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameStats {
  /** 不透明像素数 */
  opaque: number;
  /** 不透明像素的包围盒；全透明帧为 null */
  bbox: BBox | null;
}

/** 统计一帧的不透明像素数与包围盒（接入时用来判断碰撞体/贴图偏移） */
export function frameStats(def: SpriteDef, frameName: string): FrameStats {
  const rows = def.frames[frameName] ?? def.frames[Object.keys(def.frames)[0]];
  const { w: width, h: height } = spriteGrid(def);
  let opaque = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = rows?.[y] ?? "";
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? ".";
      if (ch === "." || !def.palette[ch]) continue;
      opaque++;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (opaque === 0) return { opaque: 0, bbox: null };
  return { opaque, bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}

/** 统计一帧的不透明像素数，用于自检「是否画空」 */
export function countOpaquePixels(def: SpriteDef, frameName: string): number {
  return frameStats(def, frameName).opaque;
}

/** 某个网格像素是否不透明（校验 anchor / muzzle 是否压在本体上） */
export function isOpaqueAt(def: SpriteDef, frameName: string, point: Vec2): boolean {
  const { w: width, h: height } = spriteGrid(def);
  if (point.x < 0 || point.y < 0 || point.x >= width || point.y >= height) return false;
  const rows = def.frames[frameName] ?? def.frames[Object.keys(def.frames)[0]];
  const ch = (rows?.[point.y] ?? "")[point.x] ?? ".";
  return ch !== "." && Boolean(def.palette[ch]);
}

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}
