/**
 * AudioManager —— 纯 Web Audio API 的音效管理器。
 *
 * 核心设计：
 *   - 单例（通过 default 导出），任何模块 import 即可 play()
 *   - 所有音频用 AudioContext.decodeAudioData 预加载成 AudioBuffer，
 *     播放时 createBufferSource 一次性输出（比 <audio> 标签延迟低、并发稳）
 *   - 全局限频（SFX_THROTTLE）：同一音效在最短间隔内最多响一次，
 *     避免"机枪 50 人同时开火 → 50 次/帧"这种爆炸
 *   - 找不到音频文件时静默降级（play() 直接 return false），不报错
 *   - 浏览器 autoplay policy：AudioContext 创建后先暂停，用户第一次交互（点按钮）时 resume()
 *
 * 用法：
 *   import { sound, SFX } from "./audio/manager";
 *   sound.play(SFX.MG_SHOT);
 *   sound.setMaster(0.8);    // 0~1
 *   sound.setSfx(0.6);       // 0~1
 *   sound.mute(); / sound.unmute();
 *   sound.pause(); / sound.resume();   // 游戏暂停时静音，恢复时继续
 */
import { SFX_MAP, SFX_THROTTLE, type SfxKey } from "./events";
export { SFX } from "./events";
export type { SfxKey } from "./events";

class AudioManager {
  /** 全局 AudioContext，浏览器第一次用户交互后才真正开始输出 */
  private ctx: AudioContext | null = null;
  /** 预加载的 AudioBuffer 缓存，key = SfxKey */
  private buffers = new Map<SfxKey, AudioBuffer | null>();
  /** 每个音效上次触发时间（performance.now ms），限频用 */
  private lastPlayAt = new Map<SfxKey, number>();

  /** 全局音量（影响所有音效） */
  masterVol = 1.0;
  /** 音效音量（只影响音效，不影响 BGM —— 现在还没 BGM 所以跟 master 叠乘） */
  sfxVol = 1.0;
  /** 主音量是否静音（主菜单 toggle 用） */
  private muted = false;
  /** 游戏是否暂停（主菜单/选关页/暂停按钮都会调 pause()） */
  private paused = false;

  /** 是否初始化过（避免重复 resume AudioContext） */
  private initialized = false;
  /** 正在加载的 Promise，外部可以 await 等全部加载完 */
  loading: Promise<void> = Promise.resolve();

  // ============================================================
  // 初始化 / 预加载
  // ============================================================

  /**
   * 启动时调用一次。创建 AudioContext + 预加载所有音效文件。
   * 注意：AudioContext 创建时可能因为 autoplay policy 仍是 suspended，
   * 第一次用户交互时要显式 resume()。
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    const ACtor: typeof AudioContext =
      (window as unknown as { AudioContext: typeof AudioContext }).AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!ACtor) {
      console.warn("[audio] Web Audio API 不可用，静音模式");
      return;
    }
    this.ctx = new ACtor();

    // 预加载所有声明过的音效
    this.loading = this.preloadAll();
  }

  /** 尝试 resume AudioContext。用户首次交互时必须调一次，否则声音出不来 */
  resume(): void {
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => { /* 用户拒绝或浏览器禁止，静默 */ });
    }
  }

  /** 暂停所有正在播放的声音（路由切 menu/levels 或战斗暂停时调） */
  pause(): void {
    this.paused = true;
    if (this.ctx && this.ctx.state === "running") {
      this.ctx.suspend().catch(() => { /* 静默 */ });
    }
  }

  /** 恢复播放 */
  resumeAudio(): void {
    this.paused = false;
    this.resume(); // 内部会处理 suspended → running
  }

  /** 静音 toggle（主菜单按钮用） */
  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMaster(v: number): void {
    this.masterVol = clamp01(v);
  }

  setSfx(v: number): void {
    this.sfxVol = clamp01(v);
  }

  // ============================================================
  // 预加载
  // ============================================================

  private async preloadAll(): Promise<void> {
    if (!this.ctx) return;
    const keys = Object.keys(SFX_MAP) as SfxKey[];
    await Promise.all(keys.map((k) => this.preloadOne(k)));
    console.info(`[audio] 预加载完成 ${this.buffers.size} 个音效`);
  }

  private async preloadOne(key: SfxKey): Promise<void> {
    if (!this.ctx) return;
    const url = SFX_MAP[key];
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const arr = await resp.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(arr.slice(0));
      this.buffers.set(key, buf);
    } catch {
      // 文件不存在 / 解码失败 → 存 null，play() 时静默跳过
      this.buffers.set(key, null);
      console.debug(`[audio] 音效缺失：${url}（先占位，以后把文件放进 public/audio/ 即可生效）`);
    }
  }

  // ============================================================
  // 播放
  // ============================================================

  /**
   * 播放一个音效。返回 true 表示实际触发了，false 表示被限频 / 暂停 / 文件缺失跳过了。
   * 音量可选覆盖——比如远处僵尸咆哮可以调轻一点（暂未用，但留着以后加空间音效）
   */
  play(key: SfxKey, volume: number = 1.0): boolean {
    if (!this.ctx) return false;
    if (this.muted || this.paused) return false;

    const now = performance.now();
    const throttleMs = SFX_THROTTLE[key] ?? 0;
    const lastAt = this.lastPlayAt.get(key) ?? 0;
    if (throttleMs > 0 && now - lastAt < throttleMs) return false;
    this.lastPlayAt.set(key, now);

    const buf = this.buffers.get(key);
    if (!buf) return false; // 占位文件还没放进 public/audio/

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const gain = this.ctx.createGain();
    gain.gain.value = clamp01(volume) * this.masterVol * this.sfxVol;
    src.connect(gain).connect(this.ctx.destination);
    src.start(0);
    return true;
  }
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export const sound = new AudioManager();
