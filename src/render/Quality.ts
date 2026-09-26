import type { QualityLevel, QualitySetting } from '../core/types';

export interface QualityPreset {
  pixelRatio: number;
  particles: number;
  /** Multiplier for continuous particle emitters and background density. */
  density: number;
  /** Additive glow sprites on coins / meteors. */
  glow: boolean;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { pixelRatio: 1, particles: 350, density: 0.45, glow: false },
  medium: { pixelRatio: 1.5, particles: 900, density: 1, glow: true },
  high: { pixelRatio: 2, particles: 1800, density: 1.4, glow: true },
};

const ORDER: QualityLevel[] = ['low', 'medium', 'high'];

export function isLikelyMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return coarse || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

/**
 * LOW / MEDIUM / HIGH presets plus AUTO mode: starts from a device guess and steps
 * down when the measured frame rate stays under target (never sacrificing gameplay).
 */
export class QualityManager {
  level: QualityLevel;
  onChange: (level: QualityLevel) => void = () => {};
  private setting: QualitySetting;
  private windowTime = 0;
  private windowFrames = 0;
  private cooldown = 3;
  private upgrades = 0;
  private goodWindows = 0;
  private autoCeiling: QualityLevel;
  fps = 60;

  constructor(setting: QualitySetting, mobile = isLikelyMobile()) {
    this.setting = setting;
    this.autoCeiling = mobile ? 'medium' : 'high';
    this.level = setting === 'auto' ? this.autoCeiling : setting;
  }

  get preset(): QualityPreset {
    return QUALITY_PRESETS[this.level];
  }

  get current(): QualitySetting {
    return this.setting;
  }

  set(setting: QualitySetting): void {
    this.setting = setting;
    const next = setting === 'auto' ? this.autoCeiling : setting;
    this.cooldown = 3;
    this.upgrades = 0;
    if (next !== this.level) {
      this.level = next;
      this.onChange(next);
    }
  }

  /** Feed real frame deltas (seconds). `measuring` = gameplay is running. */
  sample(dt: number, measuring: boolean): void {
    if (dt <= 0 || dt > 0.25) return; // ignore tab switches / hitches
    this.windowTime += dt;
    this.windowFrames++;
    if (this.windowTime < 2) return;
    this.fps = this.windowFrames / this.windowTime;
    this.windowTime = 0;
    this.windowFrames = 0;
    if (this.setting !== 'auto' || !measuring) return;
    this.cooldown -= 2;
    if (this.cooldown > 0) return;
    const idx = ORDER.indexOf(this.level);
    if (this.fps < 46 && idx > 0) {
      this.level = ORDER[idx - 1];
      this.cooldown = 4;
      this.goodWindows = 0;
      this.onChange(this.level);
    } else if (this.fps > 58) {
      this.goodWindows++;
      const ceilIdx = ORDER.indexOf(this.autoCeiling);
      if (this.goodWindows >= 4 && idx < ceilIdx && this.upgrades < 1) {
        this.upgrades++;
        this.level = ORDER[idx + 1];
        this.cooldown = 6;
        this.goodWindows = 0;
        this.onChange(this.level);
      }
    } else {
      this.goodWindows = 0;
    }
  }
}
