import type { QualitySetting, TouchMode } from '../core/types';

export interface Settings {
  muted: boolean;
  musicVolume: number;
  sfxVolume: number;
  quality: QualitySetting;
  screenShake: boolean;
  touchMode: TouchMode;
  showFps: boolean;
}

export interface SaveData {
  version: 1;
  highScore: number;
  bestTime: number;
  gamesPlayed: number;
  settings: Settings;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SAVE_KEY = 'clickjet3d:save:v1';

function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function defaultSave(): SaveData {
  return {
    version: 1,
    highScore: 0,
    bestTime: 0,
    gamesPlayed: 0,
    settings: {
      muted: false,
      musicVolume: 0.7,
      sfxVolume: 0.8,
      quality: 'auto',
      screenShake: !prefersReducedMotion(),
      touchMode: 'drag',
      showFps: false,
    },
  };
}

function safeLocalStorage(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__clickjet3d_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null; // private mode / disabled storage: keep playing without persistence
  }
}

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback;

/** Validates untrusted JSON, falling back to defaults field by field. */
export function sanitize(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<SaveData> & { settings?: Partial<Settings> };
  const s = (r.settings ?? {}) as Partial<Settings>;
  return {
    version: 1,
    highScore: Math.floor(num(r.highScore, 0, 0, 1e9)),
    bestTime: num(r.bestTime, 0, 0, 1e7),
    gamesPlayed: Math.floor(num(r.gamesPlayed, 0, 0, 1e9)),
    settings: {
      muted: bool(s.muted, d.settings.muted),
      musicVolume: num(s.musicVolume, d.settings.musicVolume, 0, 1),
      sfxVolume: num(s.sfxVolume, d.settings.sfxVolume, 0, 1),
      quality: oneOf(s.quality, ['auto', 'low', 'medium', 'high'] as const, d.settings.quality),
      screenShake: bool(s.screenShake, d.settings.screenShake),
      touchMode: oneOf(s.touchMode, ['drag', 'follow'] as const, d.settings.touchMode),
      showFps: bool(s.showFps, d.settings.showFps),
    },
  };
}

export interface RunResult {
  newHighScore: boolean;
  previousHighScore: number;
  newBestTime: boolean;
}

/** Local persistence (high score, best time, settings). No server needed. */
export class SaveManager {
  data: SaveData;
  private readonly storage: StorageLike | null;
  private listeners: ((s: Settings) => void)[] = [];

  constructor(storage: StorageLike | null | undefined = undefined) {
    this.storage = storage === undefined ? safeLocalStorage() : storage;
    this.data = this.load();
  }

  get settings(): Settings {
    return this.data.settings;
  }

  get highScore(): number {
    return this.data.highScore;
  }

  load(): SaveData {
    if (!this.storage) return defaultSave();
    try {
      const raw = this.storage.getItem(SAVE_KEY);
      return raw ? sanitize(JSON.parse(raw)) : defaultSave();
    } catch {
      return defaultSave();
    }
  }

  persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      /* quota / disabled storage — ignore */
    }
  }

  updateSettings(patch: Partial<Settings>): void {
    this.data.settings = sanitize({ ...this.data, settings: { ...this.data.settings, ...patch } }).settings;
    this.persist();
    for (const fn of this.listeners) fn(this.data.settings);
  }

  onSettingsChange(fn: (s: Settings) => void): void {
    this.listeners.push(fn);
  }

  submitRun(score: number, time: number): RunResult {
    const previousHighScore = this.data.highScore;
    const newHighScore = score > previousHighScore;
    const newBestTime = time > this.data.bestTime;
    if (newHighScore) this.data.highScore = Math.floor(score);
    if (newBestTime) this.data.bestTime = time;
    this.data.gamesPlayed++;
    this.persist();
    return { newHighScore, previousHighScore, newBestTime };
  }
}
