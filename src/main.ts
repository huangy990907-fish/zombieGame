/**
 * 入口 —— 启动游戏、驱动主循环、绑定操作。
 *
 * 三屏 SPA（hash 路由）：
 *   #/ 或 #/menu     → 主菜单（PixiJS 画面做静态背景 + 半透明遮罩）
 *   #/levels         → 选关页（横向节点式地图）
 *   #/play           → 战斗场景（原有顶栏 + PixiJS + HUD）
 *
 * 主循环是固定步长 + 累加器模式：
 *   渲染帧率可能波动，但逻辑永远以 1/60 秒为一步；
 *   速度倍率就是"这一帧多走几步"，2x 就是每帧走 2 步逻辑。
 *
 * menu/levels 路由下 ticker 继续跑（保证 Pixi 渲染帧稳定），
 * 但 game.tick() 不被调用——战斗逻辑停止，画面冻结成静态背景。
 */
import "./style.css";
import { getSetting, setSetting, SLIDER_GROUPS } from "./config";
import { sound, SFX } from "./audio/manager";
import {
  FSA_SUPPORTED,
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
import { Hud } from "./ui/hud";
import { Renderer } from "./render/renderer";
import { LEVELS, findLevel, type LevelDef } from "./levels";
import { router, type Route } from "./router";

const STEP = 1 / 60;

async function boot(): Promise<void> {
  const host = document.getElementById("screen");
  if (!host) throw new Error("missing #screen");

  // ====== 先加载存档，再构造 Game（SETTINGS 被 loadSettings 改过，Game 启动按新值读） ======
  const loadedFrom = await loadSettings();

  // ====== 初始化 AudioManager（预加载音效文件，音量从 SETTINGS 读） ======
  sound.init();
  sound.setMaster(getSetting("audio.master"));
  sound.setSfx(getSetting("audio.sfx"));

  const game = new Game();
  const renderer = new Renderer();
  await renderer.init(host);
  const hud = new Hud(game);

  // DOM 引用
  const topbar = document.getElementById("topbar") as HTMLElement;
  const bottom = document.getElementById("bottom") as HTMLElement;
  const pauseBtn = document.getElementById("btnPause") as HTMLButtonElement;
  const speedBtn = document.getElementById("btnSpeed") as HTMLButtonElement;
  const restartBtn = document.getElementById("btnRestart") as HTMLButtonElement;
  const modeBtn = document.getElementById("btnMode") as HTMLButtonElement;
  const backMenuBtn = document.getElementById("btnBackMenu") as HTMLButtonElement;
  const settingsBtn = document.getElementById("btnSettings") as HTMLButtonElement;
  const settingsCloseBtn = document.getElementById("btnSettingsClose") as HTMLButtonElement;
  const settingsPanel = document.getElementById("settingsPanel") as HTMLElement;
  const settingsBody = document.getElementById("settingsBody") as HTMLElement;
  const storageStatusEl = document.getElementById("storageStatus") as HTMLElement;

  const menuOverlay = document.getElementById("menuOverlay") as HTMLElement;
  const levelsOverlay = document.getElementById("levelsOverlay") as HTMLElement;
  const levelsNodesEl = document.getElementById("levelsNodes") as HTMLElement;
  const levelsDetailEl = document.getElementById("levelsDetail") as HTMLElement;
  const levelsProgressEl = document.getElementById("levelsProgress") as HTMLElement;

  const resultOverlay = document.getElementById("resultOverlay") as HTMLElement;
  const resultCard = document.getElementById("resultCard") as HTMLElement;
  const resultTitle = document.getElementById("resultTitle") as HTMLElement;
  const resultSubtitle = document.getElementById("resultSubtitle") as HTMLElement;

  // 面板标题映射：key = 分组名（和 SLIDERS.group 一致）
  const GROUP_TITLES: Record<string, string> = {
    wave: "波次 / 规模",
    human: "人类配置",
    zombie: "僵尸配置",
    opening: "门窗配置",
    audio: "音频",
  };

  /** 当前选中关卡（选关页点中节点或结算弹窗的"重玩"都会更新这个值） */
  let currentLevel: LevelDef | null = null;

  /** 当前从 localStorage 载入的进度 */
  let progress = loadProgress();

  // ============================================================
  // 设置面板（原有逻辑保持不变）
  // ============================================================

  const buildSettingsPanel = (): void => {
    let html = "";
    for (const [grp, sliders] of Object.entries(SLIDER_GROUPS)) {
      html += `<h3>${GROUP_TITLES[grp] ?? grp}</h3>`;
      for (const s of sliders) {
        html += `<div class="settings-row" data-path="${s.path}">
          <label>${s.label}</label>
          <input type="range"
                 data-path="${s.path}"
                 data-step="${s.step}"
                 min="${s.min}"
                 max="${s.max}"
                 step="${s.step}" />
          <span class="val" data-val="${s.path}"></span>
        </div>`;
      }
    }
    settingsBody.innerHTML = html;

    const inputs = settingsBody.querySelectorAll<HTMLInputElement>('input[type="range"]');
    for (const input of inputs) {
      const path = input.dataset.path!;
      const row = input.parentElement!;
      const valSpan = row.querySelector<HTMLSpanElement>(".val")!;
      input.addEventListener("input", () => {
        const v = Number(input.value);
        setSetting(path, v);
        valSpan.textContent = formatVal(v, Number(input.dataset.step!));
        void saveSettings();
        // 音量滑块变化时即时同步到 AudioManager（不用等重开）
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
    settingsBody.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((input) => {
      const v = getSetting(input.dataset.path!);
      input.value = String(v);
      const row = input.parentElement!;
      const valSpan = row.querySelector<HTMLSpanElement>(".val")!;
      valSpan.textContent = formatVal(v, Number(input.dataset.step!));
    });
  };

  const toggleSettings = (force?: boolean): void => {
    const next = force ?? !settingsPanel.classList.contains("open");
    if (next) refreshPanelValues();
    settingsPanel.classList.toggle("open", next);
  };

  const refreshButtons = (): void => {
    pauseBtn.textContent = game.paused ? "继续" : "暂停";
    speedBtn.textContent = `${game.speed}x`;
    modeBtn.textContent = game.mode === "defend" ? "防守" : "进攻";
  };

  // ============================================================
  // 选关页：渲染节点 + 选中 + 开始
  // ============================================================

  const refreshLevelsPage = (selectId?: string): void => {
    progress = loadProgress();
    const total = LEVELS.length;
    const beatenCount = LEVELS.filter((l) => progress.beaten.includes(l.id)).length;
    levelsProgressEl.textContent = `已通关 ${beatenCount} / ${total}`;

    // 动态生成节点 HTML
    let nodesHtml = "";
    let selectedId = selectId ?? currentLevel?.id ?? LEVELS[0]?.id;
    for (const lvl of LEVELS) {
      const unlocked = progress.unlocked.includes(lvl.id);
      const beaten = progress.beaten.includes(lvl.id);
      const selected = lvl.id === selectedId;
      const cls = beaten ? "beaten" : unlocked ? "unlocked" : "locked";
      const nodeLabel = beaten ? '<span class="check">✓</span>' : `<span class="node-num">${lvl.id.replace("level-", "")}</span>`;
      nodesHtml += `<button class="level-node ${cls} ${selected ? "selected" : ""}"
                            data-id="${lvl.id}"
                            style="left:${lvl.nodeX}%; top:${lvl.nodeY}%;"
                            ${unlocked ? "" : "disabled"}
                            title="${lvl.title}">
        ${nodeLabel}
      </button>`;
    }
    levelsNodesEl.innerHTML = nodesHtml;

    // 绑定点击事件
    const nodes = levelsNodesEl.querySelectorAll<HTMLElement>(".level-node");
    nodes.forEach((node) => {
      node.addEventListener("click", () => {
        const id = node.dataset.id!;
        const lvl = findLevel(id);
        if (!lvl) return;
        currentLevel = lvl;
        refreshLevelsPage(id);
      });
    });

    // 详情面板
    const selected = currentLevel;
    if (selected) {
      const diffStars = "★".repeat(selected.difficulty) + "☆".repeat(5 - selected.difficulty);
      const unlocked = progress.unlocked.includes(selected.id);
      levelsDetailEl.innerHTML = `
        <div class="detail-left">
          <div class="detail-title">${selected.title}</div>
          <div class="detail-diff">难度 ${diffStars}</div>
          <div class="detail-desc">${selected.description}</div>
        </div>
        <button class="start-btn" id="btnLevelStart" ${unlocked ? "" : "disabled"}>
          ${unlocked ? "▶ 开始战斗" : "🔒 未解锁"}
        </button>
      `;
      const startBtn = document.getElementById("btnLevelStart") as HTMLButtonElement | null;
      startBtn?.addEventListener("click", () => {
        if (currentLevel && progress.unlocked.includes(currentLevel.id)) {
          router.go("play");
        }
      });
    } else {
      levelsDetailEl.innerHTML = `<div class="detail-left"><div class="detail-desc">请选择一个关卡</div></div>`;
    }
  };

  // ============================================================
  // 路由切换 —— 显示哪个 overlay、显示顶栏/底部、是否驱动 game.tick
  // ============================================================

  const showOverlay = (overlay: "menu" | "levels" | null): void => {
    menuOverlay.classList.toggle("active", overlay === "menu");
    levelsOverlay.classList.toggle("active", overlay === "levels");
    // 结算弹窗独立，由 victory/defeat 触发，不受路由控制
  };

  const applyRoute = (route: Route): void => {
    // 隐藏结算弹窗（切路由时清掉）
    resultOverlay.classList.add("hidden");
    resultOverlay.classList.remove("active");

    switch (route) {
      case "menu":
        showOverlay("menu");
        topbar.classList.add("hidden");
        bottom.classList.add("hidden");
        settingsPanel.classList.remove("open");
        sound.pause(); // 主菜单静音
        break;
      case "levels":
        showOverlay("levels");
        topbar.classList.add("hidden");
        bottom.classList.add("hidden");
        settingsPanel.classList.remove("open");
        refreshLevelsPage();
        sound.pause(); // 选关页静音
        break;
      case "play":
        showOverlay(null);
        topbar.classList.remove("hidden");
        bottom.classList.remove("hidden");
        // 显式启动当前关卡（currentLevel 在选关页点节点时已设好）
        if (!currentLevel) {
          currentLevel = findLevel("level-1") ?? null;
        }
        if (currentLevel) {
          game.start(currentLevel.id, currentLevel.settings);
        }
        refreshButtons();
        refreshPanelValues();
        sound.resumeAudio(); // 进入战斗场景恢复声音（AudioContext resume 在这里发生）
        break;
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

    // 胜利 → 记录进度
    if (game.phase === "victory" && game.levelId) {
      recordBeaten(game.levelId);
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
      // 只有 play 路由推进战斗逻辑
      const running = !game.paused && (game.phase === "wave" || game.phase === "intermission");
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
      // 检测胜利/失败
      checkResultPhase();
    } else {
      // menu / levels：完全冻结逻辑
      acc = 0;
    }

    renderer.render(game, real);
    hud.update(real);
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

  settingsBtn.onclick = () => toggleSettings();
  settingsCloseBtn.onclick = () => toggleSettings(false);

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
  const newGameBtn = document.getElementById("btnNewGame") as HTMLButtonElement;
  const loadGameBtn = document.getElementById("btnLoadGame") as HTMLButtonElement;
  const menuMuteBtn = document.getElementById("btnMenuMute") as HTMLButtonElement;
  const updateMuteIcon = () => {
    menuMuteBtn.textContent = sound.isMuted() ? "🔇" : "🔊";
  };
  menuMuteBtn.onclick = () => {
    sound.toggleMute();
    updateMuteIcon();
  };
  newGameBtn.onclick = () => { sound.resume(); sound.play(SFX.UI_CLICK); router.go("levels"); };
  loadGameBtn.onclick = () => { sound.resume(); sound.play(SFX.UI_CLICK); router.go("levels"); };
  updateMuteIcon();

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
      } else if (e.key === "1") {
        game.speed = 1;
        refreshButtons();
      } else if (e.key === "2") {
        game.speed = 2;
        refreshButtons();
      } else if (e.key === "3") {
        game.speed = 4;
        refreshButtons();
      } else if (e.key === "r" || e.key === "R") {
        restartBtn.click();
      }
    }
  });

  // ============================================================
  // 初始化收尾
  // ============================================================

  refreshButtons();
  buildSettingsPanel();
  await refreshStorageStatus();

  if (import.meta.env.DEV) {
    (window as unknown as { __game: Game; __router: typeof router }).__game = game;
    (window as unknown as { __game: Game; __router: typeof router }).__router = router;
  }
}

void boot();
