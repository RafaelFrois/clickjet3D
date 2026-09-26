import type { QualitySetting, TouchMode, UIAction } from '../core/types';
import type { Settings } from '../save/SaveManager';
import { hydrateIcons, icon } from './icons';

export type ScreenId = 'boot' | 'menu' | 'hud' | 'pause' | 'gameover' | 'settings';

export interface UICallbacks {
  play(): void;
  resume(): void;
  pause(): void;
  restart(): void;
  menu(): void;
  toggleMute(): void;
  nextTrack(): void;
  openSettings(): void;
  closeSettings(): void;
  setMusicVolume(v: number): void;
  setSfxVolume(v: number): void;
  setQuality(q: QualitySetting): void;
  setShake(on: boolean): void;
  setTouchMode(m: TouchMode): void;
  setShowFps(on: boolean): void;
  uiSound(kind: 'move' | 'click'): void;
}

export type FloatStyle = 'yellow' | 'rainbow' | 'bonus' | 'combo';
export type IndicatorKind = 'meteor' | 'chaser' | 'powerup';

interface FloatItem {
  el: HTMLDivElement;
  span: HTMLSpanElement;
  x: number;
  y: number;
  z: number;
  life: number;
  active: boolean;
}

interface IndicatorItem {
  el: HTMLDivElement;
  arrow: HTMLDivElement;
  kind: IndicatorKind | null;
}

export interface Projector {
  (x: number, y: number, z: number, out: { x: number; y: number }): boolean;
}

const QUALITY_CYCLE: QualitySetting[] = ['auto', 'low', 'medium', 'high'];
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

/**
 * DOM-based retro UI layered on top of the 3D canvas: menu, HUD, pause, game over,
 * settings, floating score texts, off-screen indicators and banners. Also handles
 * keyboard/gamepad focus navigation. Knows nothing about gameplay internals.
 */
export class UIManager {
  current: ScreenId = 'boot';
  private readonly screens: Record<ScreenId, HTMLElement>;
  private readonly fx = $('fx');
  private readonly floats: FloatItem[] = [];
  private readonly indicators: IndicatorItem[] = [];
  private focusIndex = 0;
  private lastScore = -1;
  private lastTime = '';
  private lastPuTime = '';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private hintTimer: ReturnType<typeof setTimeout> | null = null;
  private settingsReturn: ScreenId = 'menu';
  private readonly tmp = { x: 0, y: 0 };
  private readonly el = {
    menuHigh: $('menu-highscore'),
    score: $('hud-score'),
    combo: $('hud-combo'),
    hi: $('hud-hi'),
    time: $('hud-time'),
    powerup: $('hud-powerup'),
    puRate: $('pu-rate'),
    puTime: $('pu-time'),
    banner: $('banner'),
    hint: $('play-hint'),
    goScore: $('go-score'),
    goTime: $('go-time'),
    goHigh: $('go-high'),
    goNew: $('go-new'),
    confetti: $('confetti'),
    toast: $('track-toast'),
    debug: $('debug'),
    setMusic: $<HTMLInputElement>('set-music'),
    setSfx: $<HTMLInputElement>('set-sfx'),
    setMute: $('set-mute'),
    setQuality: $('set-quality'),
    setShake: $('set-shake'),
    setTouch: $('set-touch'),
    setFps: $('set-fps'),
  };

  constructor(private readonly cb: UICallbacks) {
    this.screens = {
      boot: $('boot'),
      menu: $('screen-menu'),
      hud: $('screen-hud'),
      pause: $('screen-pause'),
      gameover: $('screen-gameover'),
      settings: $('screen-settings'),
    };
    hydrateIcons(document);
    this.bindButtons();
    this.buildFxPools();
    document.body.addEventListener('pointerdown', () => document.body.classList.remove('kbd-nav'));
  }

  /* ------------------------------- Screens ------------------------------- */

  show(id: ScreenId): void {
    for (const [key, el] of Object.entries(this.screens)) el.classList.toggle('active', key === id);
    this.current = id;
    this.focusIndex = 0;
    this.refreshFocus();
    if (id !== 'hud') this.hideIndicators();
  }

  openSettings(settings: Settings): void {
    this.settingsReturn = this.current === 'settings' ? this.settingsReturn : this.current;
    this.syncSettings(settings);
    this.show('settings');
  }

  closeSettings(): void {
    this.show(this.settingsReturn);
  }

  syncSettings(s: Settings): void {
    this.el.setMusic.value = String(Math.round(s.musicVolume * 100));
    this.el.setSfx.value = String(Math.round(s.sfxVolume * 100));
    this.el.setMute.textContent = s.muted ? 'OFF' : 'ON';
    this.el.setQuality.textContent = s.quality.toUpperCase();
    this.el.setShake.textContent = s.screenShake ? 'ON' : 'OFF';
    this.el.setTouch.textContent = s.touchMode.toUpperCase();
    this.el.setFps.textContent = s.showFps ? 'ON' : 'OFF';
    this.setMuteIcon(s.muted);
  }

  setMuteIcon(muted: boolean): void {
    for (const id of ['btn-mute', 'btn-hud-mute']) {
      const span = document.querySelector<HTMLElement>(`#${id} [data-icon]`);
      if (span) {
        span.dataset.icon = muted ? 'soundOff' : 'soundOn';
        span.innerHTML = icon(span.dataset.icon);
      }
    }
    this.el.setMute.textContent = muted ? 'OFF' : 'ON';
  }

  private bindButtons(): void {
    const click = (id: string, fn: () => void) =>
      $(id).addEventListener('click', (e) => {
        e.stopPropagation();
        this.cb.uiSound('click');
        fn();
      });
    click('btn-play', () => this.cb.play());
    click('btn-mute', () => this.cb.toggleMute());
    click('btn-hud-mute', () => this.cb.toggleMute());
    click('btn-settings', () => this.cb.openSettings());
    click('btn-music', () => this.cb.nextTrack());
    click('btn-pause', () => this.cb.pause());
    click('btn-resume', () => this.cb.resume());
    click('btn-pause-restart', () => this.cb.restart());
    click('btn-pause-settings', () => this.cb.openSettings());
    click('btn-pause-menu', () => this.cb.menu());
    click('btn-restart', () => this.cb.restart());
    click('btn-go-menu', () => this.cb.menu());
    click('btn-settings-back', () => this.cb.closeSettings());
    click('set-mute', () => this.cb.toggleMute());
    click('set-quality', () => {
      const cur = this.el.setQuality.textContent?.toLowerCase() as QualitySetting;
      const next = QUALITY_CYCLE[(QUALITY_CYCLE.indexOf(cur) + 1) % QUALITY_CYCLE.length];
      this.el.setQuality.textContent = next.toUpperCase();
      this.cb.setQuality(next);
    });
    click('set-shake', () => {
      const on = this.el.setShake.textContent !== 'ON';
      this.el.setShake.textContent = on ? 'ON' : 'OFF';
      this.cb.setShake(on);
    });
    click('set-touch', () => {
      const next: TouchMode = this.el.setTouch.textContent === 'DRAG' ? 'follow' : 'drag';
      this.el.setTouch.textContent = next.toUpperCase();
      this.cb.setTouchMode(next);
    });
    click('set-fps', () => {
      const on = this.el.setFps.textContent !== 'ON';
      this.el.setFps.textContent = on ? 'ON' : 'OFF';
      this.cb.setShowFps(on);
    });
    this.el.setMusic.addEventListener('input', () => this.cb.setMusicVolume(+this.el.setMusic.value / 100));
    this.el.setSfx.addEventListener('input', () => this.cb.setSfxVolume(+this.el.setSfx.value / 100));

    // Mouse hover moves the keyboard/gamepad focus too (single focus model).
    for (const screen of Object.values(this.screens)) {
      screen.querySelectorAll<HTMLElement>('[data-nav]').forEach((el) => {
        el.addEventListener('pointerenter', () => {
          const list = this.navItems();
          const i = list.indexOf(el);
          if (i >= 0 && i !== this.focusIndex) {
            this.focusIndex = i;
            this.refreshFocus();
          }
        });
      });
    }
  }

  /* ------------------------- Keyboard / gamepad nav ------------------------ */

  private navItems(): HTMLElement[] {
    return [...this.screens[this.current].querySelectorAll<HTMLElement>('[data-nav]')].filter((el) => el.offsetParent !== null);
  }

  private refreshFocus(): void {
    const items = this.navItems();
    document.querySelectorAll('.focused').forEach((el) => el.classList.remove('focused'));
    if (!document.body.classList.contains('kbd-nav') || items.length === 0) return;
    this.focusIndex = ((this.focusIndex % items.length) + items.length) % items.length;
    items[this.focusIndex].classList.add('focused');
  }

  /** Handles menu navigation. Returns true when the action was consumed. */
  navigate(action: UIAction): boolean {
    const items = this.navItems();
    if (items.length === 0) return false;
    const wasNav = document.body.classList.contains('kbd-nav');
    document.body.classList.add('kbd-nav');
    const focused = items[this.focusIndex % items.length];
    if (action === 'up' || action === 'down') {
      if (!wasNav) this.focusIndex = 0;
      else this.focusIndex += action === 'down' ? 1 : -1;
      this.refreshFocus();
      this.cb.uiSound('move');
      return true;
    }
    if (action === 'left' || action === 'right') {
      if (focused instanceof HTMLInputElement && focused.type === 'range') {
        const step = action === 'right' ? 5 : -5;
        focused.value = String(Math.max(0, Math.min(100, +focused.value + step)));
        focused.dispatchEvent(new Event('input'));
        this.cb.uiSound('move');
        return true;
      }
      if (!wasNav) this.focusIndex = 0;
      else this.focusIndex += action === 'right' ? 1 : -1;
      this.refreshFocus();
      this.cb.uiSound('move');
      return true;
    }
    if (action === 'confirm') {
      if (!wasNav) {
        this.refreshFocus();
        return false;
      }
      if (focused && !(focused instanceof HTMLInputElement)) {
        focused.click();
        return true;
      }
    }
    return false;
  }

  /* --------------------------------- HUD ---------------------------------- */

  setHighScore(v: number): void {
    this.el.menuHigh.textContent = String(v);
    this.el.hi.textContent = String(v);
  }

  setScore(v: number): void {
    if (v === this.lastScore) return;
    const bump = v > this.lastScore && this.lastScore >= 0;
    this.lastScore = v;
    this.el.score.textContent = String(v);
    if (bump) {
      this.el.score.classList.remove('score-bump');
      void this.el.score.offsetWidth;
      this.el.score.classList.add('score-bump');
    }
  }

  setTime(t: number): void {
    const s = t.toFixed(1);
    if (s === this.lastTime) return;
    this.lastTime = s;
    this.el.time.textContent = s;
  }

  setCombo(mult: number): void {
    const c = this.el.combo;
    c.textContent = mult > 1 ? `x${mult}` : '';
    c.classList.toggle('show', mult > 1);
    if (mult > 1) {
      c.classList.remove('pop');
      void c.offsetWidth;
      c.classList.add('pop');
    }
  }

  setPowerUp(active: boolean, rate = 0, remaining = 0): void {
    const p = this.el.powerup;
    p.classList.toggle('show', active);
    if (!active) {
      p.classList.remove('warn');
      return;
    }
    this.el.puRate.textContent = `+${rate}/s`;
    const s = remaining.toFixed(1);
    if (s !== this.lastPuTime) {
      this.lastPuTime = s;
      this.el.puTime.textContent = s;
    }
    p.classList.toggle('warn', remaining <= 1.5);
  }

  resetHud(highScore: number): void {
    this.lastScore = -1;
    this.lastTime = '';
    this.setScore(0);
    this.setTime(0);
    this.setCombo(1);
    this.setPowerUp(false);
    this.setHighScore(highScore);
    this.el.banner.className = 'banner';
  }

  banner(text: string, style: '' | 'purple' | 'rainbow' = ''): void {
    const b = this.el.banner;
    b.textContent = text;
    b.className = 'banner';
    void b.offsetWidth;
    b.className = `banner show ${style}`;
  }

  hint(text: string, ms = 4000): void {
    const h = this.el.hint;
    h.innerHTML = text;
    h.classList.add('show');
    if (this.hintTimer) clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => h.classList.remove('show'), ms);
  }

  clearHint(): void {
    this.el.hint.classList.remove('show');
  }

  trackToast(name: string): void {
    const t = this.el.toast;
    t.textContent = `♪ ${name}`;
    t.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
  }

  debug(text: string | null): void {
    this.el.debug.classList.toggle('show', text !== null);
    if (text !== null) this.el.debug.textContent = text;
  }

  /* ------------------------------- Game over ------------------------------ */

  showGameOver(score: number, time: number, highScore: number, isNew: boolean): void {
    this.el.goScore.textContent = String(score);
    this.el.goTime.textContent = time.toFixed(1);
    this.el.goHigh.textContent = String(highScore);
    this.el.goNew.classList.toggle('show', isNew);
    this.el.confetti.innerHTML = '';
    this.show('gameover');
    if (isNew) this.confetti();
  }

  private confetti(): void {
    const colors = ['#ffe600', '#46de46', '#3bd6ff', '#b06bff', '#ff4d4d', '#ffffff', '#1a1af0'];
    const frag = document.createDocumentFragment();
    for (let i = 0; i < 70; i++) {
      const c = document.createElement('i');
      c.style.left = `${Math.random() * 100}%`;
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = `${1.8 + Math.random() * 2.2}s`;
      c.style.animationDelay = `${Math.random() * 0.8}s`;
      c.style.setProperty('--dx', `${(Math.random() - 0.5) * 160}px`);
      frag.appendChild(c);
    }
    this.el.confetti.appendChild(frag);
  }

  /* ------------------------------ FX overlay ------------------------------ */

  private buildFxPools(): void {
    for (let i = 0; i < 24; i++) {
      const el = document.createElement('div');
      el.className = 'float-text';
      el.style.display = 'none';
      const span = document.createElement('span');
      el.appendChild(span);
      this.fx.appendChild(el);
      this.floats.push({ el, span, x: 0, y: 0, z: 0, life: 0, active: false });
    }
    for (let i = 0; i < 10; i++) {
      const el = document.createElement('div');
      el.className = 'indicator';
      const arrow = document.createElement('div');
      arrow.className = 'ind-arrow';
      const ic = document.createElement('div');
      ic.className = 'ind-icon';
      el.append(arrow, ic);
      this.fx.appendChild(el);
      this.indicators.push({ el, arrow, kind: null });
    }
  }

  /** Floating "+5" / "+10" style text anchored to a world position. */
  floatText(html: string, x: number, y: number, z: number, style: FloatStyle): void {
    let item = this.floats.find((f) => !f.active);
    if (!item) item = this.floats.reduce((a, b) => (a.life < b.life ? a : b));
    item.active = true;
    item.life = 0.95;
    item.x = x;
    item.y = y;
    item.z = z;
    item.el.className = `float-text ${style}`;
    item.span.innerHTML = html;
    item.el.style.display = 'block';
    // restart CSS animation
    item.span.style.animation = 'none';
    void item.span.offsetWidth;
    item.span.style.animation = '';
  }

  clearFloats(): void {
    for (const f of this.floats) {
      f.active = false;
      f.el.style.display = 'none';
    }
  }

  updateFloats(dt: number, project: Projector): void {
    for (const f of this.floats) {
      if (!f.active) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.active = false;
        f.el.style.display = 'none';
        continue;
      }
      if (project(f.x, f.y, f.z, this.tmp)) f.el.style.transform = `translate3d(${this.tmp.x.toFixed(1)}px, ${this.tmp.y.toFixed(1)}px, 0)`;
    }
  }

  /**
   * Off-screen indicators: arrows pinned to the screen edge pointing at incoming
   * meteors (warning), the chaser and power-ups.
   */
  updateIndicators(targets: { kind: IndicatorKind; x: number; z: number }[], project: Projector, width: number, height: number, topInset: number): void {
    const pad = Math.max(26, Math.min(width, height) * 0.05);
    const minX = pad;
    const maxX = width - pad;
    const minY = topInset + pad;
    const maxY = height - pad;
    let used = 0;
    for (const t of targets) {
      if (used >= this.indicators.length) break;
      const onScreen = project(t.x, 0, t.z, this.tmp);
      let { x, y } = this.tmp;
      if (!onScreen) {
        x = width - x;
        y = height * 2;
      }
      const inside = onScreen && x > minX && x < maxX && y > minY && y < maxY;
      if (inside) continue;
      const cx = width / 2;
      const cy = (minY + maxY) / 2;
      const dx = x - cx;
      const dy = y - cy;
      const sx = dx !== 0 ? (dx > 0 ? maxX - cx : minX - cx) / dx : Infinity;
      const sy = dy !== 0 ? (dy > 0 ? maxY - cy : minY - cy) / dy : Infinity;
      const s = Math.min(sx, sy, 1);
      const px = cx + dx * s;
      const py = cy + dy * s;
      const ind = this.indicators[used++];
      if (ind.kind !== t.kind) {
        ind.kind = t.kind;
        ind.el.className = `indicator show ${t.kind}`;
        (ind.el.lastChild as HTMLElement).innerHTML = icon(t.kind === 'meteor' ? 'warn' : t.kind === 'chaser' ? 'eye' : 'star');
      } else if (!ind.el.classList.contains('show')) {
        ind.el.classList.add('show');
      }
      ind.el.style.transform = `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0)`;
      ind.arrow.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
    }
    for (let i = used; i < this.indicators.length; i++) {
      const ind = this.indicators[i];
      if (ind.el.classList.contains('show')) ind.el.classList.remove('show');
    }
  }

  hideIndicators(): void {
    for (const ind of this.indicators) ind.el.classList.remove('show');
  }

  private safeProbe: HTMLDivElement | null = null;

  private safeTopPx(): number {
    if (!this.safeProbe) {
      this.safeProbe = document.createElement('div');
      this.safeProbe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top)';
      document.body.appendChild(this.safeProbe);
    }
    return Math.max(10, parseFloat(getComputedStyle(this.safeProbe).paddingTop) || 0);
  }

  /** Height in px covered by the HUD at the top (camera keeps the arena below it). */
  hudHeight(): number {
    const vmin = Math.min(window.innerWidth, window.innerHeight);
    const pill = Math.min(56, Math.max(34, vmin * 0.066));
    const safeTop = this.safeTopPx();
    const rows = window.innerWidth / window.innerHeight < 0.8 ? 2 : 1;
    return safeTop + pill * rows + (rows - 1) * 8 + 24;
  }
}
