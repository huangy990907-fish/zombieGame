/**
 * 精灵预览页的逻辑（sprites.html 通过 <script type="module"> 引入）。
 * 纯前端渲染：把字符矩阵画到 canvas，不依赖游戏现有渲染器，也不改任何现有文件。
 */
import { COMBO_SPRITES } from "./composites";
import { SPRITE_LIST } from "./sprites";
import { frameStats, getNativeFrame, isOpaqueAt, renderAtSize, type OutlineMode } from "./render";
import { SPRITE_SIZE, spriteGrid, type SpriteDef } from "./types";

interface Card {
  root: HTMLElement;
  def: SpriteDef;
  one: HTMLCanvasElement;
  game: HTMLCanvasElement;
  zoom: HTMLCanvasElement;
  frameLabel: HTMLElement;
  sequence: string[];
}

interface PreviewState {
  outline: OutlineMode;
  fps: number;
  paused: boolean;
}

const state: PreviewState = { outline: 1, fps: 6, paused: false };

/** 接入自检卡片的显示放大倍数（12px → 120px） */
const CHECK_SCALE = 10;

function must<T>(value: T | null, what: string): T {
  if (!value) throw new Error(`找不到元素：${what}`);
  return value;
}

/** 动画序列：武器 idle 停 3 拍再打一发；组合精灵 walk 两拍 + fire 一拍；倒地按定义顺序播三帧 */
function framesOf(def: SpriteDef): string[] {
  const keys = Object.keys(def.frames);
  if (keys.length <= 1) return keys;
  if (def.id === "zombie-death") return keys;
  const wanted =
    def.group === "weapon"
      ? ["idle", "idle", "idle", "fire"]
      : def.group === "combo"
        ? ["idle", "walk1", "walk2", "fire"]
        : ["idle", "walk1", "walk2"];
  const valid = wanted.filter((name) => def.frames[name]);
  return valid.length > 0 ? valid : keys;
}

function drawInto(
  canvas: HTMLCanvasElement,
  def: SpriteDef,
  frame: string,
  outline: OutlineMode,
  smoothing: boolean,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const src = getNativeFrame(def, frame, outline);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = smoothing;
  if (smoothing) ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
}

function paletteChips(def: SpriteDef): string {
  const chips = Object.entries(def.palette)
    .map(
      ([ch, color]) =>
        `<span class="chip" title="${ch} = ${color}"><i style="background:${color}"></i><code>${ch}</code></span>`,
    )
    .join("");
  return `<div class="palette">${chips}</div>`;
}

/** anchor / muzzle / footprint / 像素统计：接入时直接照抄这几个数 */
function metaRows(def: SpriteDef, firstFrame: string): string {
  const stats = frameStats(def, firstFrame);
  const bbox = stats.bbox ? `${stats.bbox.w}×${stats.bbox.h} @(${stats.bbox.x},${stats.bbox.y})` : "空";
  const muzzle = def.muzzle ? `(${def.muzzle.x},${def.muzzle.y})` : "无";
  return `
    <span>帧数 <b>${Object.keys(def.frames).length}</b>：${Object.keys(def.frames).join(" / ")}</span>
    <span>当前帧 <b class="frame-label">${firstFrame}</b></span>
    <span>anchor <b>(${def.anchor.x},${def.anchor.y})</b> · footprint <b>${def.footprintRadius}px</b> · facing <b>${def.facing}</b></span>
    <span>muzzle <b>${muzzle}</b>（fire 帧）</span>
    <span>有效像素 <b>${stats.opaque}</b> · bbox <b>${bbox}</b></span>
  `;
}

function createCard(def: SpriteDef): Card {
  const sequence = framesOf(def);
  const grid = spriteGrid(def);
  // 8× 放大按 256px 展示框反推：32 网格 → 8×，64 网格 → 4×，保证像素网格不被压缩
  const zoomScale = Math.max(1, Math.floor(256 / Math.max(grid.w, grid.h)));
  const article = document.createElement("article");
  article.className = `card group-${def.group}`;
  article.dataset.id = def.id;
  const badge = def.group === "weapon" ? "武器" : def.group === "human" ? "人类" : def.group === "combo" ? "烘焙" : "僵尸";
  article.innerHTML = `
    <header class="card-head">
      <div>
        <span class="sprite-id">${def.id}</span>
        <strong class="sprite-name">${def.name}</strong>
      </div>
      <span class="badge">${badge}</span>
    </header>
    <div class="views">
      <figure class="view">
        <div class="stage stage-one"><canvas class="one" width="${grid.w}" height="${grid.h}"></canvas></div>
        <figcaption>1× 原生 ${grid.w}×${grid.h}</figcaption>
      </figure>
      <figure class="view">
        <div class="stage stage-game"><canvas class="game" width="${def.gameDiameter}" height="${def.gameDiameter}"></canvas></div>
        <figcaption>游戏内 ≈${def.gameDiameter}px</figcaption>
      </figure>
      <figure class="view view-zoom">
        <div class="stage stage-zoom">
          <canvas class="zoom" width="${grid.w * zoomScale}" height="${grid.h * zoomScale}"></canvas>
          <div class="grid-overlay"></div>
        </div>
        <figcaption>${zoomScale}× / 像素网格</figcaption>
      </figure>
    </div>
    <div class="meta">${metaRows(def, sequence[0])}</div>
    <p class="note">${def.note}</p>
    ${paletteChips(def)}
  `;
  const one = must(article.querySelector<HTMLCanvasElement>(".one"), `${def.id} 1x 画布`);
  const game = must(article.querySelector<HTMLCanvasElement>(".game"), `${def.id} 游戏尺寸画布`);
  const zoom = must(article.querySelector<HTMLCanvasElement>(".zoom"), `${def.id} 8x 画布`);
  const frameLabel = must(article.querySelector<HTMLElement>(".frame-label"), `${def.id} 帧标签`);
  const zoomStage = must(article.querySelector<HTMLElement>(".stage-zoom"), `${def.id} 8x 容器`);
  // 大网格（如 64×64）在 1× 视图里超出 56px 固定框会被裁掉，按实际网格放宽舞台
  const oneStage = must(article.querySelector<HTMLElement>(".stage-one"), `${def.id} 1x 容器`);
  const oneSize = Math.max(56, grid.w, grid.h);
  oneStage.style.width = `${oneSize}px`;
  oneStage.style.height = `${oneSize}px`;
  zoomStage.style.setProperty("--cell", `${zoom.width / grid.w}px`);
  return { root: article, def, one, game, zoom, frameLabel, sequence };
}

function buildLoadoutStrip(): void {
  const strip = must(document.getElementById("loadout"), "尺寸对比条");
  for (const def of SPRITE_LIST) {
    const wrap = document.createElement("div");
    wrap.className = "loadout-item";
    const canvas = document.createElement("canvas");
    canvas.width = def.gameDiameter;
    canvas.height = def.gameDiameter;
    const label = document.createElement("span");
    label.textContent = def.name;
    wrap.append(canvas, label);
    strip.append(wrap);
    drawInto(canvas, def, Object.keys(def.frames)[0], state.outline, true);
    (wrap as HTMLDivElement & { __canvas?: HTMLCanvasElement }).__canvas = canvas;
  }
}

/* ---------------- 接入自检：12px 贴地 + anchor 十字 + muzzle 标记 ---------------- */

interface CheckCard {
  root: HTMLElement;
  def: SpriteDef;
  canvas: HTMLCanvasElement;
}

const checkCards: CheckCard[] = [];

function drawCheckCanvas(canvas: HTMLCanvasElement, def: SpriteDef): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = canvas.width;
  const frame = def.frames.fire ? "fire" : Object.keys(def.frames)[0];
  const small = renderAtSize(def, frame, def.gameDiameter, state.outline);

  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, size, size);

  // 精灵网格坐标 → 自检画布坐标
  const grid = spriteGrid(def);
  const kx = size / grid.w;
  const ky = size / grid.h;
  // 游戏像素 → 自检画布坐标（12px 精灵放大 CHECK_SCALE 倍）
  const g = CHECK_SCALE;

  const ax = def.anchor.x * kx;
  const ay = def.anchor.y * ky;

  // 碰撞半径（虚线圆），按 footprintRadius 换算成放大后的像素
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = "rgba(255,255,255,0.32)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(ax, ay, def.footprintRadius * g, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // anchor 十字线（青）
  ctx.save();
  ctx.strokeStyle = "#7ee7ff";
  ctx.lineWidth = 1;
  const arm = 7;
  ctx.beginPath();
  ctx.moveTo(ax - arm, ay);
  ctx.lineTo(ax + arm, ay);
  ctx.moveTo(ax, ay - arm);
  ctx.lineTo(ax, ay + arm);
  ctx.stroke();
  ctx.restore();

  // muzzle 标记（粉），只有带武器的精灵才有
  if (def.muzzle) {
    const mx = def.muzzle.x * kx;
    const my = def.muzzle.y * ky;
    ctx.save();
    ctx.strokeStyle = "#ff5c8a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mx, my, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(mx - 7, my);
    ctx.lineTo(mx - 1, my);
    ctx.moveTo(mx + 1, my);
    ctx.lineTo(mx + 7, my);
    ctx.moveTo(mx, my - 7);
    ctx.lineTo(mx, my - 1);
    ctx.moveTo(mx, my + 1);
    ctx.lineTo(mx, my + 7);
    ctx.stroke();
    ctx.restore();
  }
}

function createCheckCard(def: SpriteDef): CheckCard {
  const size = def.gameDiameter * CHECK_SCALE;
  const card = document.createElement("article");
  card.className = "check-card";
  card.dataset.id = `check-${def.id}`;
  const muzzleText = def.muzzle ? `<span><i class="swatch muzzle"></i>muzzle (${def.muzzle.x},${def.muzzle.y})</span>` : "";
  card.innerHTML = `
    <header class="check-head">
      <span class="sprite-id">${def.id}</span>
      <strong>${def.name}</strong>
    </header>
    <div class="check-stage">
      <canvas width="${size}" height="${size}"></canvas>
    </div>
    <div class="check-legend">
      <span><i class="swatch anchor"></i>anchor (${def.anchor.x},${def.anchor.y})</span>
      ${muzzleText}
      <span><i class="swatch radius"></i>r=${def.footprintRadius}px · ${def.gameDiameter}px 放大 ${CHECK_SCALE}×</span>
    </div>
  `;
  const canvas = must(card.querySelector<HTMLCanvasElement>("canvas"), `${def.id} 自检画布`);
  drawCheckCanvas(canvas, def);
  return { root: card, def, canvas };
}

/* ---------------- 渲染与动画 ---------------- */

const cards: Card[] = [];
const comboCards: Card[] = [];

function renderAll(): void {
  for (const list of [cards, comboCards]) {
    for (const card of list) {
      const frame = card.sequence[0];
      card.frameLabel.textContent = frame;
      drawInto(card.one, card.def, frame, state.outline, false);
      drawInto(card.game, card.def, frame, state.outline, true);
      drawInto(card.zoom, card.def, frame, state.outline, false);
    }
  }
  for (const card of checkCards) drawCheckCanvas(card.canvas, card.def);

  // 尺寸对比条跟着描边设置一起更新
  const strip = must(document.getElementById("loadout"), "尺寸对比条");
  strip.querySelectorAll<HTMLDivElement>(".loadout-item").forEach((item, index) => {
    const def = SPRITE_LIST[index];
    const canvas = (item as HTMLDivElement & { __canvas?: HTMLCanvasElement }).__canvas;
    if (def && canvas) drawInto(canvas, def, Object.keys(def.frames)[0], state.outline, true);
  });
}

let tick = 0;
let lastTime = 0;
let accumulator = 0;

function animate(now: number): void {
  if (!lastTime) lastTime = now;
  const delta = Math.min(now - lastTime, 250);
  lastTime = now;
  if (state.paused) {
    accumulator = 0;
    requestAnimationFrame(animate);
    return;
  }
  accumulator += delta;
  const step = 1000 / state.fps;
  if (accumulator >= step) {
    accumulator = accumulator % step;
    tick += 1;
    for (const list of [cards, comboCards]) {
      for (const card of list) {
        const frame = card.sequence[tick % card.sequence.length];
        card.frameLabel.textContent = frame;
        drawInto(card.one, card.def, frame, state.outline, false);
        drawInto(card.game, card.def, frame, state.outline, true);
        drawInto(card.zoom, card.def, frame, state.outline, false);
      }
    }
    document.body.dataset.tick = String(tick);
    document.body.dataset.frames = cards.map((c) => c.frameLabel.textContent).join(",");
    document.body.dataset.comboFrames = comboCards.map((c) => `${c.def.id}:${c.frameLabel.textContent}`).join("|");
  }
  requestAnimationFrame(animate);
}

function bindControls(): void {
  const outlineButtons = document.querySelectorAll<HTMLButtonElement>("[data-outline]");
  outlineButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const value = Number(btn.dataset.outline) as OutlineMode;
      state.outline = value;
      outlineButtons.forEach((b) => b.classList.toggle("active", b === btn));
      renderAll();
      syncStat();
    });
  });

  const gridToggle = must(document.getElementById("gridToggle"), "网格开关") as HTMLInputElement;
  gridToggle.addEventListener("change", () => {
    document.body.classList.toggle("show-grid", gridToggle.checked);
  });

  const pauseButton = must(document.getElementById("pauseToggle"), "暂停按钮") as HTMLButtonElement;
  pauseButton.addEventListener("click", () => {
    state.paused = !state.paused;
    pauseButton.textContent = state.paused ? "继续" : "暂停";
    pauseButton.classList.toggle("active", state.paused);
  });

  const fpsRange = must(document.getElementById("fpsRange"), "速度滑块") as HTMLInputElement;
  const fpsValue = must(document.getElementById("fpsValue"), "速度数值") as HTMLElement;
  fpsRange.addEventListener("input", () => {
    state.fps = Number(fpsRange.value);
    fpsValue.textContent = `${state.fps} fps`;
    state.paused = false;
    pauseButton.textContent = "暂停";
    pauseButton.classList.remove("active");
  });
  state.fps = Number(fpsRange.value);
  fpsValue.textContent = `${state.fps} fps`;
}

function syncStat(): void {
  const singles = SPRITE_LIST.reduce((sum, def) => sum + Object.keys(def.frames).length, 0);
  const combos = COMBO_SPRITES.reduce((sum, def) => sum + Object.keys(def.frames).length, 0);
  const bigGrids = SPRITE_LIST.filter((def) => def.grid).map((def) => `${def.id} ${def.grid!.w}×${def.grid!.h}`);
  const gridText = bigGrids.length > 0 ? ` · 自定义网格 ${bigGrids.join(" / ")}` : "";
  const stat = document.getElementById("stat");
  if (stat) {
    stat.textContent = `共 ${SPRITE_LIST.length} 个单体精灵（${singles} 帧）+ ${COMBO_SPRITES.length} 个烘焙组合（${combos} 帧）· 默认每帧 ${SPRITE_SIZE}×${SPRITE_SIZE}${gridText} · 当前描边 ${state.outline === 0 ? "无" : `${state.outline}px`}`;
  }
}

/** 自检报告：任一帧为全透明、anchor/muzzle 落在透明像素、行宽与声明网格不符都会在这里暴露出来 */
function collectReport() {
  const all = [...SPRITE_LIST, ...COMBO_SPRITES];
  const sprites = all.map((def) => {
    const grid = spriteGrid(def);
    const frames = Object.entries(def.frames).map(([name]) => {
      const stats = frameStats(def, name);
      return {
        frame: name,
        opaque: stats.opaque,
        bbox: stats.bbox,
        rows: def.frames[name].length,
        widthOk: def.frames[name].every((row) => row.length === grid.w),
      };
    });
    return {
      id: def.id,
      name: def.name,
      group: def.group,
      facing: def.facing,
      grid,
      anchor: def.anchor,
      muzzle: def.muzzle ?? null,
      footprintRadius: def.footprintRadius,
      anchorOpaque: isOpaqueAt(def, "idle", def.anchor),
      muzzleOpaque: def.muzzle ? isOpaqueAt(def, "fire", def.muzzle) : null,
      frames,
    };
  });
  const emptyFrames = sprites.flatMap((s) => s.frames.filter((f) => f.opaque === 0).map((f) => `${s.id}.${f.frame}`));
  const badWidth = sprites.flatMap((s) =>
    s.frames.filter((f) => !f.widthOk || f.rows !== s.grid.h).map((f) => `${s.id}.${f.frame}`),
  );
  const composites = COMBO_SPRITES.map((def) => ({
    id: def.id,
    frames: Object.keys(def.frames),
    anchor: def.anchor,
    muzzle: def.muzzle,
    footprintRadius: def.footprintRadius,
    anchorOpaque: isOpaqueAt(def, "idle", def.anchor),
    muzzleOpaque: def.muzzle ? isOpaqueAt(def, "fire", def.muzzle) : null,
    idleStats: frameStats(def, "idle"),
    fireStats: frameStats(def, "fire"),
  }));
  return { sprites, emptyFrames, badWidth, composites };
}

function main(): void {
  const grid = must(document.getElementById("spriteGrid"), "精灵网格");
  for (const def of SPRITE_LIST) {
    const card = createCard(def);
    grid.append(card.root);
    cards.push(card);
  }

  const comboGrid = document.getElementById("comboGrid");
  if (comboGrid) {
    for (const def of COMBO_SPRITES) {
      const card = createCard(def);
      card.root.classList.add("combo-card");
      comboGrid.append(card.root);
      comboCards.push(card);
    }
  }

  const checkGrid = document.getElementById("selfCheckGrid");
  if (checkGrid) {
    for (const def of [...COMBO_SPRITES, SPRITE_LIST.find((s) => s.id === "human")!].filter(Boolean)) {
      const card = createCheckCard(def);
      checkGrid.append(card.root);
      checkCards.push(card);
    }
  }

  buildLoadoutStrip();
  bindControls();
  renderAll();
  syncStat();

  const report = collectReport();
  const reportEl = document.getElementById("report");
  if (reportEl) {
    reportEl.textContent = JSON.stringify(report, null, 2);
  }
  (window as Window & { __spriteReport?: unknown }).__spriteReport = report;
  if (report.emptyFrames.length > 0) console.error("存在全透明帧", report.emptyFrames);
  if (report.badWidth.length > 0) console.error("存在宽度错误的帧", report.badWidth);
  for (const combo of report.composites) {
    if (!combo.anchorOpaque) console.error(`${combo.id} 的 anchor 落在透明像素`);
    if (!combo.muzzleOpaque) console.error(`${combo.id} 的 muzzle 落在透明像素`);
  }

  requestAnimationFrame(animate);
  document.documentElement.classList.add("ready");
}

main();
