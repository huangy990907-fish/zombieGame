/**
 * 入口 —— 启动游戏、驱动主循环、绑定操作。
 *
 * 五屏 SPA（hash 路由）：
 *   #/ 或 #/menu     → 主菜单（PixiJS 画面做静态背景 + 半透明遮罩）
 *   #/levels         → 选关页（横向节点式地图）
 *   #/play           → 战斗场景（原有顶栏 + PixiJS + HUD）
 *   #/training       → 训练场
 *   #/workshop       → 工坊编辑器（阶段 2，仅地址直达）
 *
 * 主循环是固定步长 + 累加器模式：
 *   渲染帧率可能波动，但逻辑永远以 1/60 秒为一步；
 *   速度倍率就是"这一帧多走几步"，2x 就是每帧走 2 步逻辑。
 *
 * menu/levels/workshop 路由下 ticker 继续跑（保证 Pixi 渲染帧稳定），
 * 但 game.tick() 不被调用——战斗逻辑停止，画面冻结成静态背景。
 */
import { getSetting, setSetting, clearLevelOverrides } from "./data/settings/runtime";
import { SLIDERS } from "./data/settings/sliders";
import { loadBuiltinMaps, getMap, isReadOnlyMap, registerRuntimeMap, MAP_LIST } from "./data/maps";
import { SURVIVAL } from "./data/survival/config";
import { SurvivalSession } from "./survival/session";
import { SurvivalUi } from "./survival/ui";
import {
  isReadOnlyLevel,
  levelLoadError,
  levelsFallback,
  loadLevels,
  resetLevelCatalog,
} from "./data/levels";
import { sound, SFX } from "./audio/manager";
import { WorkshopPage } from "./workshop/page";
import type { LevelEditorPage } from "./levelEditor/page";
import { WORKSHOP_PREVIEW_MAP_ID, compileWorkshopPreview } from "./workshop/storage";
import {
  FSA_SUPPORTED,
  clearProgress,
  clearSaveDir,
  exportToFile,
  getSaveDir,
  importFromFile,
  loadProgress,
  loadSettings,
  recordBeaten,
  resetToDefaults,
  saveSettings,
  selectSaveDir,
} from "./core/storage";
import { Game } from "./core/game";
import { checkDevPassword, isDevModeEnabled, setDevModeEnabled } from "./core/devMode";
import { Hud } from "./ui/hud";
import { InventoryPanel } from "./ui/inventory";
import { Renderer } from "./render/renderer";
import { TrainingSession } from "./training/session";
import { TrainingPanel } from "./training/panel";
import { LEVELS, findLevel, refreshLevelDefs, type LevelDef } from "./levels";
import { router, type Route } from "./router";
import type { SliderDef } from "./data/types";

const STEP = 1 / 60;

/** 地图名来自 manifest / 工坊 JSON，写进 HTML 前转义 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => {
    switch (ch) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}

async function boot(): Promise<void> {
  const host = document.getElementById("screen");
  if (!host) throw new Error("missing #screen");

  // ====== 先加载内置地图（JSON -> MapDef），再构造任何依赖地图的实例 ======
  await loadBuiltinMaps();

  // ====== 关卡 JSON 依赖地图注册表（校验 mapId），必须在地图之后加载 ======
  await loadLevels();
  refreshLevelDefs();

  // 调试 / 阶段 1A 的临时选图入口：?map=<id>（正式选图 UI 留到阶段 3）
  const mapOverrideId = new URLSearchParams(window.location.search).get("map") ?? undefined;

  // 工坊「试玩」：把预览草稿注册成运行时地图，再按 ?map=workshop-draft 解析
  if (mapOverrideId === WORKSHOP_PREVIEW_MAP_ID) {
    const preview = compileWorkshopPreview();
    if (preview) registerRuntimeMap(preview);
  }

  // ====== 先加载存档，再构造 Game（覆盖值先就位，Game 启动按合并后的值读） ======
  const loadedFrom = await loadSettings();

  // ====== 初始化 AudioManager（预加载音效文件，音量从设置读） ======
  sound.init();
  sound.setMaster(getSetting("audio.master"));
  sound.setSfx(getSetting("audio.sfx"));

  const game = new Game(mapOverrideId);
  const renderer = new Renderer();
  await renderer.init(host);
  const hud = new Hud(game);

  // ====== 放置模式库存面板：点「开始」放第一波 ======
  const inventoryPanel = new InventoryPanel(game, () => {
    if (!game.beginBattle()) {
      showMapNotice("至少放置一名人类后再开始");
    }
  });

  // ====== 训练场：一个和正常对局完全独立的沙盒 World ======
  // 面板常驻 DOM，只在 #/training 路由滑出；退出时整个会话被丢弃，不残留任何修改。
  // 换图由面板下拉触发：重建 World + 静态层；reset 同时清空单位与读数，避免跨图混算。
  const training = new TrainingSession(mapOverrideId);
  // 训练场地形画笔改动后重画静态层（水面 / 水体边框）；草丛由渲染层逐帧绘制
  training.onTerrainChanged = () => renderer.setMap(training.world.map);
  const switchTrainingMap = (id: string): void => {
    training.reset(id);
    reportMapFallback(training.mapFallback, training.requestedMapId, training.world.map.name);
    renderer.setMap(training.world.map);
  };
  const trainingPanel = new TrainingPanel(training, () => router.go("menu"), switchTrainingMap);
  trainingPanel.attachCanvas(renderer.app.canvas as HTMLCanvasElement);

  // ====== 尸潮求生：单角色生存会话，独立于关卡流程 ======
  const survival = new SurvivalSession();
  const startSurvival = (mapId: string): void => {
    survival.start(mapId);
    renderer.setMap(survival.world.map);
    survivalUi.showGame();
    // 点击按钮后焦点会留在按钮上，空格键会再次触发按钮点击（看起来像暂停失败）
    (document.activeElement as HTMLElement | null)?.blur();
    sound.resumeAudio();
  };
  const survivalUi = new SurvivalUi(survival, {
    onStart: startSurvival,
    onUpgrade: (id) => {
      (document.activeElement as HTMLElement | null)?.blur();
      survival.chooseUpgrade(id);
    },
    onWeaponPick: (id) => {
      (document.activeElement as HTMLElement | null)?.blur();
      survival.chooseWeapon(id);
    },
    onReplay: () => startSurvival(survival.map.id),
    onMenu: () => router.go("menu"),
    onWorkshop: () => router.go("workshop"),
    // 暂停菜单：继续只是切回 playing；重开等同死亡页重开；退出直接回主菜单、不结算
    onResume: () => {
      (document.activeElement as HTMLElement | null)?.blur();
      survival.togglePause();
    },
    onRestart: () => startSurvival(survival.map.id),
    onQuit: () => router.go("menu"),
  });

  // ====== 放置：play 路由下点击人类区空地放下当前选中的人类 ======
  (renderer.app.canvas as HTMLCanvasElement).addEventListener("pointerdown", (e) => {
    if (router.get() !== "play") return;
    if (game.phase === "victory" || game.phase === "defeat") return;
    const rect = (renderer.app.canvas as HTMLCanvasElement).getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * game.map.width;
    const y = ((e.clientY - rect.top) / rect.height) * game.map.height;
    const result = game.placeHuman(x, y);
    if (result === "zone") showMapNotice("只能放在人类区（绿色区域）内");
    else if (result === "blocked") showMapNotice("这里被墙体或门挡住了，换一块空地");
    else if (result === "empty") showMapNotice("该人类库存已用完，等待恢复");
  });

  // ====== 工坊编辑器：整页 DOM overlay，仅 #/workshop 路由显示 ======
  const workshop = new WorkshopPage(
    () => router.go("menu"),
    async (savedId: string) => {
      await loadBuiltinMaps();
      trainingPanel.reloadMaps(savedId);
    },
    async (deletedId: string) => {
      const wasTraining = training.world.map.id === deletedId;
      const deletedName = wasTraining
        ? training.world.map.name
        : getMap(deletedId).name || deletedId;
      await loadBuiltinMaps();
      if (wasTraining) {
        // 删掉的正是当前训练图：立刻切回默认图并重建 World / 静态层，不整页 reload
        switchTrainingMap("arena");
        showMapNotice(`地图「${deletedName}」已删除，训练场已切回「竞技场」`);
      }
      trainingPanel.reloadMaps();
    },
  );

  // DOM 引用
  const topbar = document.getElementById("topbar") as HTMLElement;
  const bottom = document.getElementById("bottom") as HTMLElement;
  const pauseBtn = document.getElementById("btnPause") as HTMLButtonElement;
  const speedBtn = document.getElementById("btnSpeed") as HTMLButtonElement;
  const restartBtn = document.getElementById("btnRestart") as HTMLButtonElement;
  const modeBtn = document.getElementById("btnMode") as HTMLButtonElement;
  const backMenuBtn = document.getElementById("btnBackMenu") as HTMLButtonElement;
  const tuningOverlay = document.getElementById("tuningOverlay") as HTMLElement;
  const tuningBody = document.getElementById("tuningBody") as HTMLElement;
  const storageStatusEl = document.getElementById("storageStatus") as HTMLElement;

  const menuOverlay = document.getElementById("menuOverlay") as HTMLElement;
  const levelsOverlay = document.getElementById("levelsOverlay") as HTMLElement;
  const levelsListEl = document.getElementById("levelsList") as HTMLElement;
  const levelsDetailEl = document.getElementById("levelsDetail") as HTMLElement;
  const levelsProgressEl = document.getElementById("levelsProgress") as HTMLElement;
  const levelNewBtn = document.getElementById("btnLevelNew") as HTMLButtonElement;

  const resultOverlay = document.getElementById("resultOverlay") as HTMLElement;
  const resultCard = document.getElementById("resultCard") as HTMLElement;
  const resultTitle = document.getElementById("resultTitle") as HTMLElement;
  const resultSubtitle = document.getElementById("resultSubtitle") as HTMLElement;

  // 主菜单弹窗：设置 / 清档二次确认
  const menuSettingsOverlay = document.getElementById("menuSettingsOverlay") as HTMLElement;
  const clearSaveOverlay = document.getElementById("clearSaveOverlay") as HTMLElement;
  const menuVolMaster = document.getElementById("menuVolMaster") as HTMLInputElement;
  const menuVolMasterVal = document.getElementById("menuVolMasterVal") as HTMLElement;
  const menuVolSfx = document.getElementById("menuVolSfx") as HTMLInputElement;
  const menuVolSfxVal = document.getElementById("menuVolSfxVal") as HTMLElement;

  /** 当前选中关卡（选关页点中节点或结算弹窗的"重玩"都会更新这个值） */
  let currentLevel: LevelDef | null = null;

  /** 当前从 localStorage 载入的进度 */
  let progress = loadProgress();

  // ============================================================
  // 数值调参页（开发者专属独立路由 #/tuning）
  // ============================================================

  /** 一个可折叠分区：僵尸 / 武器按实体拆分，避免单列过长 */
  interface TuningSection {
    key: string;
    title: string;
    note?: string;
    items: SliderDef[];
  }

  const SECTION_TITLES: Record<string, string> = {
    wave: "波次 / 规模",
    human: "人类配置",
    zombie: "僵尸·全局",
    opening: "门窗配置",
    audio: "音频",
  };

  const sectionOf = (s: SliderDef): { key: string; title: string; note?: string } => {
    const parts = s.path.split(".");
    const name = s.label.split("·")[0];
    if (parts[0] === "zombie" && parts.length > 2) {
      return { key: `zombie.${parts[1]}`, title: `僵尸·${name}`, note: "对新生成单位生效" };
    }
    if (parts[0] === "weapons" && parts.length > 2) {
      return { key: `weapons.${parts[1]}`, title: `武器·${name}` };
    }
    return {
      key: parts[0],
      title: SECTION_TITLES[parts[0]] ?? parts[0],
      note: parts[0] === "opening" ? "血量项需重开本局" : undefined,
    };
  };

  const buildTuningPanel = (): void => {
    const sections = new Map<string, TuningSection>();
    for (const s of SLIDERS) {
      const meta = sectionOf(s);
      const sec = sections.get(meta.key) ?? { ...meta, items: [] };
      sec.items.push(s);
      sections.set(meta.key, sec);
    }

    let html = "";
    for (const sec of sections.values()) {
      html += `<section class="tuning-group"><h3>${sec.title}${
        sec.note ? ` <span class="group-note">· ${sec.note}</span>` : ""
      }</h3>`;
      for (const s of sec.items) {
        if (s.readonly) {
          html += `<div class="settings-row readonly" data-path="${s.path}" data-step="${s.step}">
            <label>${s.label}</label>
            <span class="val" data-val="${s.path}"></span>
          </div>`;
          continue;
        }
        html += `<div class="settings-row" data-path="${s.path}" data-step="${s.step}">
          <label>${s.label}</label>
          <input type="range"
                 data-path="${s.path}"
                 data-step="${s.step}"
                 min="${s.min}"
                 max="${s.max}"
                 step="${s.step}" />
          <span class="val" data-val="${s.path}"></span>
          ${s.note ? `<span class="row-note">${s.note}</span>` : ""}
        </div>`;
      }
      html += `</section>`;
    }
    tuningBody.innerHTML = html;

    const inputs = tuningBody.querySelectorAll<HTMLInputElement>('input[type="range"]');
    for (const input of inputs) {
      const path = input.dataset.path!;
      const row = input.parentElement!;
      const valSpan = row.querySelector<HTMLSpanElement>(".val")!;
      input.addEventListener("input", () => {
        const v = Number(input.value);
        setSetting(path, v);
        valSpan.textContent = formatVal(v, Number(input.dataset.step!));
        void saveSettings();
        // 音量滑块变化时即时同步到 AudioManager
        if (path === "audio.master") sound.setMaster(v);
        else if (path === "audio.sfx") sound.setSfx(v);
      });
    }
    refreshPanelValues();
  };

  const refreshStorageStatus = async (): Promise<void> => {
    const dir = await getSaveDir();
    if (dir) {
      storageStatusEl.textContent = `📁 自动存：${dir.name}/settings.json`;
      storageStatusEl.classList.toggle("has-dir", true);
    } else {
      storageStatusEl.textContent = FSA_SUPPORTED
        ? "💾 仅 localStorage · 点「选存档目录」开启跨设备同步"
        : "💾 仅 localStorage · 当前浏览器不支持自动读写目录";
      storageStatusEl.classList.toggle("has-dir", false);
    }
    const pickBtn = document.getElementById("btnPickDir") as HTMLButtonElement | null;
    const clearBtn = document.getElementById("btnClearDir") as HTMLButtonElement | null;
    if (pickBtn) pickBtn.disabled = !FSA_SUPPORTED;
    if (clearBtn) clearBtn.disabled = !dir;
  };

  const announceLoadedFrom = (src: "dir" | "local" | "default"): void => {
    const msg =
      src === "dir" ? "✅ 已从存档目录加载设置" :
      src === "local" ? "✅ 已从本地缓存恢复设置" :
      "ℹ️ 使用默认设置（首次访问）";
    console.info(`[storage] ${msg}`);
  };
  announceLoadedFrom(loadedFrom);

  const formatVal = (v: number, step: number): string => {
    if (step >= 1) return String(Math.round(v));
    const digits = String(step).split(".")[1]?.length ?? 2;
    return v.toFixed(digits);
  };

  const refreshPanelValues = (): void => {
    tuningBody.querySelectorAll<HTMLElement>(".settings-row").forEach((row) => {
      const path = row.dataset.path;
      if (!path) return;
      const v = getSetting(path);
      const valSpan = row.querySelector<HTMLSpanElement>(".val");
      if (valSpan) valSpan.textContent = formatVal(v, Number(row.dataset.step ?? "1"));
    });
  };

  const refreshButtons = (): void => {
    pauseBtn.textContent = game.paused ? "继续" : "暂停";
    speedBtn.textContent = `${game.speed}x`;
    modeBtn.textContent = game.mode === "defend" ? "防守" : "进攻";
  };

  // ============================================================
  // 选关页：列表 + 解锁状态 + 开发者操作入口
  // ============================================================

  /** 解锁规则：开发者模式全开；玩家模式第一关常开，通关上一关即解锁下一关（兼容旧存档的 unlocked 列表） */
  const isLevelUnlocked = (index: number, id: string): boolean => {
    if (isDevModeEnabled()) return true;
    if (index === 0) return true;
    if (progress.beaten.includes(LEVELS[index - 1]?.id)) return true;
    return progress.unlocked.includes(id);
  };

  const levelZombieTotal = (lvl: LevelDef): number =>
    lvl.waves.reduce((sum, w) => sum + w.zombies.reduce((s, g) => s + g.count, 0), 0);

  const refreshLevelsPage = (selectId?: string): void => {
    progress = loadProgress();
    const dev = isDevModeEnabled();
    const beatenCount = LEVELS.filter((l) => progress.beaten.includes(l.id)).length;
    levelsProgressEl.textContent = `已通关 ${beatenCount} / ${LEVELS.length}`;
    levelNewBtn.classList.toggle("hidden", !dev);

    // 选中项：显式指定 > 上次选中 > 第一个已解锁关卡
    let selectedId = selectId ?? currentLevel?.id;
    let selectedIndex = LEVELS.findIndex((l) => l.id === selectedId);
    if (selectedIndex < 0) {
      selectedIndex = LEVELS.findIndex((l, i) => isLevelUnlocked(i, l.id));
    }
    currentLevel = LEVELS[selectedIndex] ?? null;

    let rows = "";
    LEVELS.forEach((lvl, i) => {
      const unlocked = isLevelUnlocked(i, lvl.id);
      const beaten = progress.beaten.includes(lvl.id);
      const map = getMap(lvl.mapId);
      const cls = beaten ? "beaten" : unlocked ? "unlocked" : "locked";
      const selected = i === selectedIndex;
      const status = beaten
        ? "✓ 已通关"
        : unlocked
          ? "可挑战"
          : `🔒 通关「${LEVELS[i - 1]?.title ?? "上一关"}」后解锁`;
      const readOnly = isReadOnlyLevel(lvl.id);
      const actions = dev
        ? `<div class="row-actions">
             ${readOnly ? "" : `<button data-act="edit" data-id="${lvl.id}">编辑</button>`}
             <button data-act="copy" data-id="${lvl.id}">复制</button>
             ${readOnly ? "" : `<button data-act="delete" data-id="${lvl.id}">删除</button>`}
           </div>`
        : "";
      rows += `<div class="level-row ${cls} ${selected ? "selected" : ""}"
                    data-id="${lvl.id}" ${unlocked ? "" : 'data-locked="1"'}>
        <div class="row-no">${beaten ? "✓" : i + 1}</div>
        <div class="row-main">
          <div class="row-name">${escapeHtml(lvl.title)}</div>
          <div class="row-meta">${escapeHtml(map.name)} · ${lvl.waves.length} 波 · ${levelZombieTotal(lvl)} 只丧尸</div>
        </div>
        <div class="row-status">${status}</div>
        ${actions}
      </div>`;
    });
    levelsListEl.innerHTML = rows;

    levelsListEl.querySelectorAll<HTMLElement>(".level-row").forEach((row) => {
      row.addEventListener("click", (ev) => {
        const target = ev.target as HTMLElement;
        const actionBtn = target.closest<HTMLButtonElement>("[data-act]");
        if (actionBtn) {
          ev.stopPropagation();
          const act = actionBtn.dataset.act;
          const id = actionBtn.dataset.id!;
          if (!isDevModeEnabled()) {
            showMapNotice("关卡编辑仅对开发者模式开放");
            return;
          }
          if (act === "edit") {
            if (isReadOnlyLevel(id)) {
              showMapNotice("内置教学关为只读，请先「复制」后再编辑");
              return;
            }
            openLevelEditor("edit", id);
          } else if (act === "copy") {
            openLevelEditor("copy", id);
          } else if (act === "delete") {
            void deleteLevelFromList(id);
          }
          return;
        }
        if (row.dataset.locked === "1" && !isDevModeEnabled()) {
          showMapNotice("该关卡尚未解锁：先通关上一关");
          return;
        }
        const id = row.dataset.id!;
        const lvl = findLevel(id);
        if (!lvl) return;
        currentLevel = lvl;
        refreshLevelsPage(id);
      });
    });

    // 详情面板
    const selected = currentLevel;
    if (selected) {
      const idx = LEVELS.indexOf(selected);
      const unlocked = isLevelUnlocked(idx, selected.id);
      const beaten = progress.beaten.includes(selected.id);
      const map = getMap(selected.mapId);
      const diffStars = "★".repeat(selected.difficulty) + "☆".repeat(5 - selected.difficulty);
      const lockHint =
        idx > 0 ? `通关「${LEVELS[idx - 1]?.title ?? "上一关"}」后解锁` : "首关默认解锁";
      levelsDetailEl.innerHTML = `
        <div class="detail-left">
          <div class="detail-title">${escapeHtml(selected.title)}${beaten ? ' <span style="color:#4ade80;font-size:12px">✓ 已通关</span>' : ""}</div>
          <div class="detail-diff">难度 ${diffStars}</div>
          <div class="detail-map">🗺 地图：${escapeHtml(map.name)}（${escapeHtml(map.id)}） · ${map.width}×${map.height}</div>
          <div class="detail-desc">${selected.waves.length} 波 · ${levelZombieTotal(selected)} 只丧尸${unlocked ? "" : ` · ${lockHint}`}</div>
        </div>
        <button class="start-btn" id="btnLevelStart" ${unlocked ? "" : "disabled"}>
          ${unlocked ? `▶ 开始战斗 · ${escapeHtml(map.name)}` : "🔒 未解锁"}
        </button>
      `;
      const startBtn = document.getElementById("btnLevelStart") as HTMLButtonElement | null;
      startBtn?.addEventListener("click", () => {
        if (!currentLevel) return;
        const i = LEVELS.indexOf(currentLevel);
        if (!isLevelUnlocked(i, currentLevel.id)) return;
        sound.play(SFX.UI_CLICK);
        router.go("play", { level: currentLevel.id });
      });
    } else {
      levelsDetailEl.innerHTML = `<div class="detail-left"><div class="detail-desc">请选择一个关卡</div></div>`;
    }
  };

  levelNewBtn.addEventListener("click", () => {
    openLevelEditor("new");
  });

  // ============================================================
  // 路由切换 —— 显示哪个 overlay、显示顶栏/底部、是否驱动 game.tick
  // ============================================================

  const showOverlay = (overlay: "menu" | "levels" | null): void => {
    menuOverlay.classList.toggle("active", overlay === "menu");
    levelsOverlay.classList.toggle("active", overlay === "levels");
    // 结算弹窗独立，由 victory/defeat 触发，不受路由控制
  };

  /** 弹窗统一开合：hidden 控制 display，active 触发淡入 */
  const openModal = (el: HTMLElement): void => {
    el.classList.remove("hidden");
    requestAnimationFrame(() => el.classList.add("active"));
  };
  const closeModal = (el: HTMLElement): void => {
    el.classList.remove("active");
    el.classList.add("hidden");
  };
  const closeMenuModals = (): void => {
    closeModal(menuSettingsOverlay);
    closeModal(clearSaveOverlay);
  };

  /** 生存模式按住式按键（WASD / 方向键），路由切换时清空 */
  const heldKeys = new Set<string>();

  /** 地图 id 缺失时的可见提示：回退默认图不静默 */
  let mapNoticeTimer = 0;
  const showMapNotice = (text: string): void => {
    let el = document.getElementById("mapNotice");
    if (!el) {
      el = document.createElement("div");
      el.id = "mapNotice";
      el.className = "map-notice";
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add("show");
    window.clearTimeout(mapNoticeTimer);
    mapNoticeTimer = window.setTimeout(() => el?.classList.remove("show"), 4500);
  };
  const reportMapFallback = (
    fallback: boolean,
    requested: string | undefined,
    actualName: string,
  ): void => {
    if (fallback && requested) {
      showMapNotice(`地图「${requested}」不存在，已回退默认图「${actualName}」`);
    }
  };

  /** 关卡保存 / 删除后的热刷新：重读 manifest → 同步展示层 → 重绘列表（不整页 reload） */
  const refreshLevelCatalog = async (selectId?: string): Promise<void> => {
    resetLevelCatalog();
    await loadLevels();
    refreshLevelDefs();
    if (levelsFallback && levelLoadError) {
      showMapNotice(`关卡加载异常：${levelLoadError}；已回退安全默认关卡`);
    }
    refreshLevelsPage(selectId);
  };

  // ====== 关卡编辑器：整块只在开发态加载（生产构建不含编辑器代码与接口文案） ======
  let levelEditor: LevelEditorPage | undefined;
  let pendingEditorRequest: { mode: "new" | "edit" | "copy"; id?: string } | undefined;
  if (import.meta.env.DEV) {
    void import("./levelEditor/page")
      .then(({ LevelEditorPage: Editor }) => {
        levelEditor = new Editor({
          onClose: () => {
            if (router.get() !== "levels") return;
            // 从 #/levels/edit 直达打开的编辑器，关闭后回到普通选关页
            if (isLevelEditPath()) router.go("levels");
            else refreshLevelsPage();
          },
          onSaved: async (id) => {
            await refreshLevelCatalog(id);
            showMapNotice("关卡已保存，选关列表已刷新");
          },
          onDeleted: async (id) => {
            await refreshLevelCatalog();
            showMapNotice(`关卡「${id}」已删除`);
          },
        });
        if (pendingEditorRequest && isDevModeEnabled()) {
          levelEditor.open(pendingEditorRequest.mode, pendingEditorRequest.id);
        }
        pendingEditorRequest = undefined;
      })
      .catch((err) => console.warn("[levelEditor] 开发态编辑器加载失败", err));
  }

  /** 是否为关卡编辑器直达路径 `#/levels/edit` */
  function isLevelEditPath(): boolean {
    return window.location.hash.replace(/^#/, "").split("?")[0] === "/levels/edit";
  }

  /**
   * 打开编辑器前统一校验开发者模式：玩家模式不渲染、也不允许进入编辑页。
   * 生产构建里 levelEditor 恒为 undefined（模块整块被剔除）。
   */
  const openLevelEditor = (mode: "new" | "edit" | "copy", id?: string): void => {
    if (!isDevModeEnabled()) {
      showMapNotice("关卡编辑器仅对开发者模式开放");
      if (router.get() !== "levels") router.go("levels");
      return;
    }
    if (!levelEditor) {
      pendingEditorRequest = { mode, id };
      showMapNotice(
        import.meta.env.DEV ? "关卡编辑器正在加载…" : "关卡编辑器只在开发态可用",
      );
      return;
    }
    levelEditor.open(mode, id);
  };

  /** 列表「删除」：只在开发态可用；只读关与仍被引用的关卡受保护 */
  const deleteLevelFromList = async (id: string): Promise<void> => {
    if (!import.meta.env.DEV) {
      showMapNotice("该操作只在开发态可用");
      return;
    }
    const lvl = findLevel(id);
    if (!lvl) return;
    if (isReadOnlyLevel(id)) {
      showMapNotice("内置教学关为只读，不能删除");
      return;
    }
    const confirmed = window.confirm(
      `确定删除「${lvl.title}」（${id}）？\n删除前会备份到 public/levels/.bak/。`,
    );
    if (!confirmed) return;
    // 动态导入只放在 DEV 分支里，生产构建会把整块剔除
    if (import.meta.env.DEV) {
      try {
        const { deleteLevelFromProject } = await import("./levelEditor/devDelete");
        const result = await deleteLevelFromProject(id);
        if (!result.ok) {
          showMapNotice(result.message || "删除失败");
          return;
        }
        await refreshLevelCatalog();
        showMapNotice(`关卡「${lvl.title}」已删除`);
      } catch (err) {
        showMapNotice(`删除失败：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  // 关卡清单 / JSON 校验失败时给出可见提示，不静默回退
  if (levelsFallback && levelLoadError) {
    showMapNotice(`关卡加载异常：${levelLoadError}；已回退安全默认关卡`);
  }

  const applyRoute = (route: Route): void => {
    // 隐藏结算弹窗和菜单弹窗（切路由时清掉）
    resultOverlay.classList.add("hidden");
    resultOverlay.classList.remove("active");
    closeMenuModals();

    // 先统一收起训练场的 UI / 专属地面装饰；training 分支再重新打开
    trainingPanel.deactivate();
    renderer.setTrainingVisual(false);
    renderer.setPlacementZones(false);
    inventoryPanel.hide();
    document.body.classList.remove("training");
    document.body.classList.remove("placement");
    workshop.deactivate();
    // 生存模式离开路由即停止推进；镜头与 HUD 一律复位
    if (route !== "survival") survival.stop();
    // 关卡覆盖值只属于本局：离开战斗路由立即清空，不残留到数值面板和其他关
    if (route !== "play") clearLevelOverrides();
    survivalUi.hideAll();
    renderer.setCamera(null);
    document.body.classList.remove("survival");
    heldKeys.clear();
    // 数值调参页只在 #/tuning 显示，其余路由一律收起
    tuningOverlay.classList.remove("active");
    tuningOverlay.classList.add("hidden");
    // 离开选关页时关闭关卡编辑器弹层，避免覆盖其它页面
    if (route !== "levels" && levelEditor?.isOpen) levelEditor.close();

    switch (route) {
      case "menu":
        showOverlay("menu");
        topbar.classList.add("hidden");
        bottom.classList.add("hidden");
        sound.pause(); // 主菜单静音
        break;
      case "levels": {
        showOverlay("levels");
        topbar.classList.add("hidden");
        bottom.classList.add("hidden");
        refreshLevelsPage();
        // 直达 #/levels/edit：只有开发者模式能进编辑器，玩家模式挡回列表并提示
        if (isLevelEditPath()) {
          if (!isDevModeEnabled()) {
            showMapNotice("关卡编辑器仅对开发者模式开放");
            router.go("levels");
            break;
          }
          const id = router.getQuery("id");
          const target = id ? findLevel(id) : undefined;
          if (target && !isReadOnlyLevel(target.id)) openLevelEditor("edit", target.id);
          else if (target) openLevelEditor("copy", target.id);
          else openLevelEditor("new");
        }
        sound.pause(); // 选关页静音
        break;
      }
      case "play": {
        showOverlay(null);
        topbar.classList.remove("hidden");
        bottom.classList.remove("hidden");
        // #/play?level=<id> 指定关卡；未知 / 未解锁回退列表并提示
        const requestedId = router.getQuery("level");
        if (requestedId) {
          const idx = LEVELS.findIndex((l) => l.id === requestedId);
          const lvl = idx >= 0 ? LEVELS[idx] : undefined;
          if (!lvl) {
            showMapNotice(`关卡「${requestedId}」不存在，已返回选关`);
            router.go("levels");
            break;
          }
          if (!isLevelUnlocked(idx, lvl.id)) {
            showMapNotice(`关卡「${lvl.title}」尚未解锁：先通关上一关`);
            router.go("levels");
            break;
          }
          currentLevel = lvl;
        } else if (!currentLevel) {
          currentLevel = findLevel("level-1") ?? LEVELS[0] ?? null;
        }
        if (currentLevel) {
          game.start(currentLevel.id, currentLevel.settings);
        }
        reportMapFallback(game.mapFallback, game.requestedMapId, game.map.name);
        renderer.setMap(game.map);
        renderer.setPlacementZones(game.phase === "prepare");
        inventoryPanel.show();
        // play 路由：库存面板固定在右侧一栏，画布按剩余宽度缩放
        document.body.classList.add("placement");
        refreshButtons();
        sound.resumeAudio(); // 进入战斗场景恢复声音（AudioContext resume 在这里发生）
        break;
      }
      case "training":
        showOverlay(null);
        topbar.classList.add("hidden");
        bottom.classList.add("hidden");
        // 每次进入都是全新沙盒：不继承上一次的单位、统计和改动
        training.reset();
        reportMapFallback(training.mapFallback, training.requestedMapId, training.world.map.name);
        renderer.setMap(training.world.map);
        trainingPanel.activate();
        renderer.setTrainingVisual(true);
        document.body.classList.add("training");
        sound.resumeAudio();
        break;
      case "workshop":
        showOverlay(null);
        topbar.classList.add("hidden");
        bottom.classList.add("hidden");
        // 界面层拦截：玩家模式下不允许直达 #/workshop（不是安全边界，见 README）
        if (!isDevModeEnabled()) {
          showMapNotice("地图工坊需要先在设置里开启开发者模式");
          router.go("menu");
          break;
        }
        workshop.activate();
        sound.pause();
        break;
      case "tuning": {
        showOverlay(null);
        topbar.classList.add("hidden");
        bottom.classList.add("hidden");
        // 界面层拦截：数值调参只对开发者模式开放（与工坊同口径，不是安全边界）
        if (!isDevModeEnabled()) {
          showMapNotice("数值调参仅对开发者模式开放");
          router.go("menu");
          break;
        }
        buildTuningPanel();
        tuningOverlay.classList.remove("hidden");
        requestAnimationFrame(() => tuningOverlay.classList.add("active"));
        void refreshStorageStatus();
        sound.pause();
        break;
      }
      case "survival": {
        showOverlay(null);
        topbar.classList.add("hidden");
        bottom.classList.add("hidden");
        document.body.classList.add("survival");
        // 进入先选图：默认展示「空旷地」，实际开局由玩家选择
        renderer.setMap(getMap(SURVIVAL.defaultMapId));
        const mapOptions = MAP_LIST.map((m) => ({
          id: m.id,
          name: m.name || m.id,
          readOnly: isReadOnlyMap(m.id),
        }));
        survivalUi.showSelect(mapOptions, SURVIVAL.defaultMapId);
        sound.pause();
        break;
      }
    }
  };

  router.subscribe((next, old) => {
    console.info(`[router] ${old} → ${next}`);
    applyRoute(next);
  });
  applyRoute(router.init()); // 应用初始路由

  // ============================================================
  // PixiJS 主循环 —— ticker 永远跑（渲染帧不停），game.tick() 只在 play 时推进
  // ============================================================

  let acc = 0;
  const checkResultPhase = (): void => {
    if (game.phase !== "victory" && game.phase !== "defeat") return;
    if (resultOverlay.classList.contains("active")) return; // 已经弹过了

    // 胜利 → 记录进度（按当前关卡清单顺序解锁下一关）
    if (game.phase === "victory" && game.levelId) {
      recordBeaten(game.levelId, LEVELS.map((l) => l.id));
      progress = loadProgress();
    }

    resultCard.classList.remove("victory", "defeat");
    resultCard.classList.add(game.phase);
    resultTitle.textContent = game.phase === "victory" ? "胜利" : "失败";
    const lvl = currentLevel;
    if (game.phase === "victory") {
      resultSubtitle.textContent = lvl?.victoryText ?? "你守住了这一波尸潮！";
    } else {
      resultSubtitle.textContent = "房间失守了，再试一次？";
    }
    resultOverlay.classList.remove("hidden");
    // 下一帧加 active 触发过渡
    requestAnimationFrame(() => resultOverlay.classList.add("active"));
  };

  renderer.app.ticker.add((ticker) => {
    const real = Math.min(ticker.deltaMS / 1000, 0.2);
    const route = router.get();

    if (route === "play") {
      // play 路由推进战斗逻辑；准备阶段也 tick，用于库存恢复与已放人类的待机
      const running =
        !game.paused &&
        (game.phase === "prepare" || game.phase === "wave" || game.phase === "intermission");
      if (running) {
        acc += real * game.speed;
        let steps = 0;
        while (acc >= STEP && steps < 15) {
          game.tick(STEP);
          acc -= STEP;
          steps++;
        }
        if (acc > 0.75) acc = 0;
      } else {
        acc = 0;
      }
      // 准备阶段显示出生区标记，点开始后自动隐藏
      renderer.setPlacementZones(game.phase === "prepare");
      inventoryPanel.update(real);
      // 检测胜利/失败
      checkResultPhase();
      renderer.render(game.world, real);
      hud.update(real);
      return;
    }

    if (route === "training") {
      // 训练场自己管理暂停 / 单步 / 慢放，固定 1/60 步长
      training.advance(real);
      trainingPanel.refresh(real);
      renderer.render(training.world, real, {
        selection: training.selectionRing(),
        floating: training.floaters,
      });
      return;
    }

    if (route === "survival") {
      survival.setInput(
        (heldKeys.has("KeyD") || heldKeys.has("ArrowRight") ? 1 : 0) -
          (heldKeys.has("KeyA") || heldKeys.has("ArrowLeft") ? 1 : 0),
        (heldKeys.has("KeyS") || heldKeys.has("ArrowDown") ? 1 : 0) -
          (heldKeys.has("KeyW") || heldKeys.has("ArrowUp") ? 1 : 0),
      );
      if (survival.state === "playing") {
        acc += real;
        let steps = 0;
        while (acc >= STEP && steps < 15 && survival.state === "playing") {
          survival.tick(STEP);
          acc -= STEP;
          steps++;
        }
        if (acc > 0.75 || survival.state !== "playing") acc = 0;
      } else {
        acc = 0;
      }
      const player = survival.player;
      if (player && survival.state !== "idle") {
        renderer.setCamera(player.x, player.y, SURVIVAL.cameraZoom);
      } else {
        renderer.setCamera(null);
      }
      // 换弹期间在头顶挂一个跟随玩家的短提示，换弹结束自动消失（life = 剩余时间）
      const reload = survival.reload;
      renderer.render(survival.world, real, {
        orbs: survival.orbsForRender(),
        floating:
          reload && player
            ? [
                {
                  x: player.x,
                  y: player.y - 22,
                  text: "换弹中",
                  color: 0xc084fc,
                  age: 0,
                  life: reload.remaining,
                  vy: 0,
                  scale: 0.75,
                },
              ]
            : undefined,
      });
      survivalUi.sync();
      return;
    }

    // menu / levels：完全冻结逻辑
    acc = 0;
    renderer.render(game.world, real, { hideBossBar: true });
  });

  // ============================================================
  // 顶栏按钮事件（play 路由才可见）
  // ============================================================

  pauseBtn.onclick = () => {
    game.paused = !game.paused;
    refreshButtons();
  };

  modeBtn.onclick = () => {
    game.mode = game.mode === "defend" ? "attack" : "defend";
    refreshButtons();
  };

  const SPEEDS = [1, 2, 4, 8];
  speedBtn.onclick = () => {
    const i = SPEEDS.indexOf(game.speed);
    game.speed = SPEEDS[(i + 1) % SPEEDS.length];
    refreshButtons();
  };

  restartBtn.onclick = () => {
    if (currentLevel) {
      game.start(currentLevel.id, currentLevel.settings);
    } else {
      game.start();
    }
    acc = 0;
    refreshButtons();
    refreshPanelValues();
  };

  backMenuBtn.onclick = () => router.go("menu");

  // ====== 存档系统按钮 ======
  const pickDirBtn = document.getElementById("btnPickDir") as HTMLButtonElement;
  const clearDirBtn = document.getElementById("btnClearDir") as HTMLButtonElement;
  const resetBtn = document.getElementById("btnResetDefaults") as HTMLButtonElement;
  const exportBtn = document.getElementById("btnExportSettings") as HTMLButtonElement;
  const importBtn = document.getElementById("btnImportSettings") as HTMLButtonElement;

  pickDirBtn.onclick = async () => { await selectSaveDir(); await refreshStorageStatus(); };
  clearDirBtn.onclick = async () => { await clearSaveDir(); await refreshStorageStatus(); };
  resetBtn.onclick = async () => {
    if (!confirm("确定恢复所有参数为出厂默认值？")) return;
    await resetToDefaults();
    refreshPanelValues();
    await refreshStorageStatus();
  };
  exportBtn.onclick = async () => { await exportToFile(); await refreshStorageStatus(); };
  importBtn.onclick = async () => {
    const ok = await importFromFile();
    if (ok) {
      refreshPanelValues();
      await refreshStorageStatus();
    }
  };

  // ====== 主菜单按钮 ======
  const placementBtn = document.getElementById("btnPlacement") as HTMLButtonElement;
  const survivalBtn = document.getElementById("btnSurvival") as HTMLButtonElement;
  const trainingBtn = document.getElementById("btnTraining") as HTMLButtonElement;
  const workshopBtn = document.getElementById("btnWorkshop") as HTMLButtonElement;
  const tuningBtn = document.getElementById("btnTuning") as HTMLButtonElement;
  const menuSettingsBtn = document.getElementById("btnMenuSettings") as HTMLButtonElement;
  const menuMuteBtn = document.getElementById("btnMenuMute") as HTMLButtonElement;
  const devModeStatusEl = document.getElementById("devModeStatus") as HTMLElement;
  const devModeAuthRow = document.getElementById("devModeAuthRow") as HTMLElement;
  const devModePasswordInput = document.getElementById("devModePassword") as HTMLInputElement;
  const devModeEnableBtn = document.getElementById("btnDevModeEnable") as HTMLButtonElement;
  const devModeDisableBtn = document.getElementById("btnDevModeDisable") as HTMLButtonElement;
  const devModeFeedbackEl = document.getElementById("devModeFeedback") as HTMLElement;
  const updateMuteIcon = () => {
    menuMuteBtn.textContent = sound.isMuted() ? "🔇" : "🔊";
  };
  menuMuteBtn.onclick = () => {
    sound.toggleMute();
    updateMuteIcon();
  };

  // 放置抵抗：先进入选关列表，由玩家选择已解锁关卡
  placementBtn.onclick = () => {
    sound.resume();
    sound.play(SFX.UI_CLICK);
    router.go("levels");
  };
  // 尸潮求生：单角色生存 Roguelike，先选地图再开局
  survivalBtn.onclick = () => {
    sound.resume();
    sound.play(SFX.UI_CLICK);
    router.go("survival");
  };
  trainingBtn.onclick = () => { sound.resume(); sound.play(SFX.UI_CLICK); router.go("training"); };
  updateMuteIcon();

  // ====== 主菜单设置：音量与对局内设置面板共用 getSetting / setSetting ======
  const syncMenuVolumes = (): void => {
    const master = getSetting("audio.master");
    const sfx = getSetting("audio.sfx");
    menuVolMaster.value = String(master);
    menuVolSfx.value = String(sfx);
    menuVolMasterVal.textContent = `${Math.round(master * 100)}%`;
    menuVolSfxVal.textContent = `${Math.round(sfx * 100)}%`;
  };
  const bindMenuVolume = (
    input: HTMLInputElement,
    valEl: HTMLElement,
    path: "audio.master" | "audio.sfx",
  ): void => {
    input.addEventListener("input", () => {
      const v = Number(input.value);
      setSetting(path, v);
      valEl.textContent = `${Math.round(v * 100)}%`;
      void saveSettings();
      if (path === "audio.master") sound.setMaster(v);
      else sound.setSfx(v);
    });
  };
  bindMenuVolume(menuVolMaster, menuVolMasterVal, "audio.master");
  bindMenuVolume(menuVolSfx, menuVolSfxVal, "audio.sfx");

  menuSettingsBtn.onclick = () => {
    sound.resume();
    sound.play(SFX.UI_CLICK);
    syncMenuVolumes();
    openModal(menuSettingsOverlay);
  };
  document.getElementById("btnMenuSettingsClose")!.onclick = () => {
    sound.play(SFX.UI_CLICK);
    closeModal(menuSettingsOverlay);
  };


  // ====== 开发者模式：密码开启 / 退出；入口只在开发者模式下出现 ======
  const syncDevModeUI = (message = "", ok = false): void => {
    const on = isDevModeEnabled();
    workshopBtn.classList.toggle("hidden", !on);
    tuningBtn.classList.toggle("hidden", !on);
    devModeStatusEl.textContent = on
      ? "已开启：主菜单显示「地图工坊」与「数值调参」入口，可直接访问 #/workshop、#/tuning。"
      : "未开启。开启后主菜单会显示「地图工坊」与「数值调参」入口。";
    devModeAuthRow.classList.toggle("hidden", on);
    devModeDisableBtn.classList.toggle("hidden", !on);
    devModeFeedbackEl.textContent = message;
    devModeFeedbackEl.classList.toggle("ok", ok);
    // 关掉开发者模式时若还停在工坊页 / 数值调参页 / 关卡编辑器，立刻退出
    if (!on && router.get() === "workshop") router.go("menu");
    if (!on && router.get() === "tuning") router.go("menu");
    if (!on && levelEditor?.isOpen) levelEditor.close();
    // 开发者模式切换会改变选关列表的可玩范围与操作按钮
    if (router.get() === "levels") refreshLevelsPage();
    // 尸潮求生的选图页同样只对开发者显示「去地图工坊」
    if (router.get() === "survival") survivalUi.refreshDevMode();
  };

  const tryEnableDevMode = (): void => {
    if (!checkDevPassword(devModePasswordInput.value)) {
      devModeFeedbackEl.textContent = "密码不正确";
      devModeFeedbackEl.classList.remove("ok");
      return;
    }
    setDevModeEnabled(true);
    devModePasswordInput.value = "";
    sound.resume();
    sound.play(SFX.UI_CLICK);
    syncDevModeUI("开发者模式已开启", true);
  };

  devModeEnableBtn.onclick = tryEnableDevMode;
  devModePasswordInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      tryEnableDevMode();
    }
  });
  devModeDisableBtn.onclick = () => {
    setDevModeEnabled(false);
    sound.play(SFX.UI_CLICK);
    syncDevModeUI("已退出开发者模式，主菜单入口与 #/workshop、#/tuning 均已关闭", true);
  };
  workshopBtn.onclick = () => {
    sound.resume();
    sound.play(SFX.UI_CLICK);
    router.go("workshop");
  };
  tuningBtn.onclick = () => {
    sound.resume();
    sound.play(SFX.UI_CLICK);
    router.go("tuning");
  };
  document.getElementById("btnTuningBack")!.onclick = () => {
    sound.play(SFX.UI_CLICK);
    router.go("menu");
  };
  syncDevModeUI();

  // ====== 清空存档：先点按钮，再二次确认 ======
  const clearProgressBtn = document.getElementById("btnClearProgress") as HTMLButtonElement;
  clearProgressBtn.onclick = () => {
    sound.play(SFX.UI_CLICK);
    openModal(clearSaveOverlay);
  };
  document.getElementById("btnClearCancel")!.onclick = () => closeModal(clearSaveOverlay);
  document.getElementById("btnClearConfirm")!.onclick = () => {
    clearProgress(); // 含尸潮求生的最佳存活 / 最高等级
    progress = loadProgress(); // 内存里的进度同步重置，下一次开局从第一关起
    closeModal(clearSaveOverlay);
    sound.play(SFX.UI_CLICK);
    clearProgressBtn.textContent = "✓ 已清空";
    setTimeout(() => {
      clearProgressBtn.textContent = "🗑 清空存档";
    }, 1600);
  };

  // ====== 选关页返回按钮 ======
  const backFromLevelsBtn = document.getElementById("btnBackFromLevels") as HTMLButtonElement;
  backFromLevelsBtn.onclick = () => { router.go("menu"); };

  // ====== 结算弹窗按钮 ======
  const resultReplayBtn = document.getElementById("btnResultReplay") as HTMLButtonElement;
  const resultLevelsBtn = document.getElementById("btnResultLevels") as HTMLButtonElement;
  const resultMenuBtn = document.getElementById("btnResultMenu") as HTMLButtonElement;
  resultReplayBtn.onclick = () => {
    resultOverlay.classList.add("hidden");
    resultOverlay.classList.remove("active");
    if (currentLevel) {
      game.start(currentLevel.id, currentLevel.settings);
    }
    refreshButtons();
  };
  resultLevelsBtn.onclick = () => {
    resultOverlay.classList.add("hidden");
    resultOverlay.classList.remove("active");
    router.go("levels");
  };
  resultMenuBtn.onclick = () => {
    resultOverlay.classList.add("hidden");
    resultOverlay.classList.remove("active");
    router.go("menu");
  };

  // ====== 键盘快捷键 ======
  window.addEventListener("keydown", (e) => {
    // play 路由下才处理战斗快捷键
    if (router.get() === "play") {
      if (e.code === "Space") {
        e.preventDefault();
        pauseBtn.click();
      } else if (/^[1-9]$/.test(e.key)) {
        // 数字键选择人类种类（与库存卡片右上角一致）
        const index = Number(e.key) - 1;
        const slot = game.inventory[index];
        if (slot) game.selectWeapon(slot.id);
      } else if (e.key === "r" || e.key === "R") {
        restartBtn.click();
      }
    } else if (router.get() === "training") {
      // 训练场快捷键：空格暂停 / . 单步 / 1 正常 / 0 慢放
      if (e.code === "Space") {
        e.preventDefault();
        training.paused = !training.paused;
        trainingPanel.refresh(1);
      } else if (e.key === "." || e.key === "n" || e.key === "N") {
        training.requestStep();
        trainingPanel.refresh(1);
      } else if (e.key === "1") {
        training.speed = 1;
        training.paused = false;
        trainingPanel.refresh(1);
      } else if (e.key === "0") {
        training.speed = 0.25;
        training.paused = false;
        trainingPanel.refresh(1);
      }
    } else if (router.get() === "survival") {
      // ESC / 空格都开关暂停菜单；暂停时逻辑真的不走（tick 只看 playing）
      if (e.code === "Escape") {
        e.preventDefault();
        survival.togglePause();
        return;
      }
      const moveKeys = [
        "KeyW", "KeyA", "KeyS", "KeyD",
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
      ];
      if (moveKeys.includes(e.code)) {
        e.preventDefault();
        heldKeys.add(e.code);
        // 连点方向键可缩短飞扑者附身时间（长按的重复事件不计，必须真“连点”）
        if (!e.repeat) survival.tapEscape();
        return;
      }
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        survival.togglePause();
      } else if (e.key === "r" || e.key === "R") {
        if (survival.state !== "idle") startSurvival(survival.map.id);
      } else if (survival.state === "choosing" && /^[1-3]$/.test(e.key)) {
        const up = survival.choices[Number(e.key) - 1];
        if (up) survival.chooseUpgrade(up.id);
      }
    }
  });
  window.addEventListener("keyup", (e) => {
    heldKeys.delete(e.code);
    // 阻止空格在 keyup 阶段激活残留焦点的按钮（暂停后会误开新局）
    if (router.get() === "survival" && (e.code === "Space" || e.key === " ")) e.preventDefault();
  });

  // ============================================================
  // 初始化收尾
  // ============================================================

  refreshButtons();
  await refreshStorageStatus();

  // 初始化完成：解除 critical CSS 的首屏隐藏（index.html 里还有 3 秒兜底）
  document.documentElement.classList.add("ui-ready");

  if (import.meta.env.DEV) {
    (window as unknown as { __game: Game; __router: typeof router }).__game = game;
    (window as unknown as { __game: Game; __router: typeof router }).__router = router;
    (window as unknown as { __training: TrainingSession }).__training = training;
    (window as unknown as { __survival: SurvivalSession }).__survival = survival;
  }
}

void boot();
