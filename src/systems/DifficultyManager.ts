import { BALANCE, type MeteorSize, type Range } from '../config/balance';
import { lerp, smoothstep } from '../core/math';

export type Stage = 'start' | 'mid' | 'final';
export type MeteorDirection = 'top' | 'diag' | 'side' | 'bottom';

/**
 * Maps survival time to a smooth difficulty level (0..1) and derives every
 * spawn/behaviour parameter from it. Difficulty grows through frequency, quantity,
 * trajectories and behaviour — not only speed.
 */
export class DifficultyManager {
  time = 0;
  level = 0;

  reset(): void {
    this.time = 0;
    this.level = 0;
  }

  update(time: number): void {
    this.time = time;
    this.level = 1 - Math.exp(-time / BALANCE.difficultyTau);
  }

  get stage(): Stage {
    if (this.time < BALANCE.stages.midAt) return 'start';
    if (this.time < BALANCE.stages.finalAt) return 'mid';
    return 'final';
  }

  /** Interpolates a [start, end] range by the current level. */
  at(range: Range): number {
    return lerp(range[0], range[1], this.level);
  }

  meteorDirectionWeights(): Record<MeteorDirection, number> {
    const d = this.level;
    return {
      top: 1,
      diag: smoothstep(0.08, 0.35, d) * 0.8,
      side: smoothstep(0.28, 0.6, d) * 0.55,
      bottom: smoothstep(0.5, 0.8, d) * 0.22,
    };
  }

  meteorSizeWeights(): Record<MeteorSize, number> {
    const a = BALANCE.meteors.sizeWeightsStart;
    const b = BALANCE.meteors.sizeWeightsEnd;
    const d = this.level;
    return { S: lerp(a.S, b.S, d), M: lerp(a.M, b.M, d), L: lerp(a.L, b.L, d) };
  }

  /** Max meteors fired together in one burst (always leaves free lanes). */
  meteorBurst(): number {
    return Math.max(1, Math.round(this.at(BALANCE.meteors.burstMax)));
  }
}
