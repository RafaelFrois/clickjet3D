import { BALANCE } from '../config/balance';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { CoinKind } from '../core/types';

/**
 * Score, coin combo and high-score detection for the current run.
 * Yellow coin +5, rainbow coin +10, multiplied by a light combo (x1..x3) when coins
 * are collected in quick succession.
 */
export class ScoreManager {
  score = 0;
  multiplier = 1;
  coinsCollected = 0;
  private streak = 0;
  private comboTimer = 0;
  private beatenAnnounced = false;

  constructor(
    private readonly bus: EventBus<GameEvents>,
    private readonly previousHighScore: () => number,
  ) {}

  reset(): void {
    this.score = 0;
    this.multiplier = 1;
    this.streak = 0;
    this.comboTimer = 0;
    this.coinsCollected = 0;
    this.beatenAnnounced = false;
    this.bus.emit('score:change', { score: 0, delta: 0 });
    this.bus.emit('combo:change', { multiplier: 1 });
  }

  static coinValue(kind: CoinKind): number {
    return kind === 'rainbow' ? BALANCE.score.rainbow : BALANCE.score.yellow;
  }

  addCoin(kind: CoinKind, x: number, y: number, z: number): number {
    const cfg = BALANCE.score;
    this.coinsCollected++;
    this.streak++;
    this.comboTimer = cfg.comboWindow;
    const mult = Math.min(cfg.comboMax, 1 + Math.floor((this.streak - 1) / cfg.comboPickupsPerLevel));
    if (mult !== this.multiplier) {
      this.multiplier = mult;
      this.bus.emit('combo:change', { multiplier: mult });
    }
    const base = ScoreManager.coinValue(kind);
    const value = base * this.multiplier;
    this.bus.emit('coin:collect', { kind, value, base, multiplier: this.multiplier, x, y, z });
    this.add(value);
    return value;
  }

  addBonus(amount: number, x: number, y: number, z: number): void {
    this.bus.emit('powerup:tick', { amount, x, y, z });
    this.add(amount);
  }

  update(dt: number): void {
    if (this.streak === 0) return;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) {
      this.streak = 0;
      if (this.multiplier !== 1) {
        this.multiplier = 1;
        this.bus.emit('combo:change', { multiplier: 1 });
      }
    }
  }

  private add(delta: number): void {
    this.score += delta;
    this.bus.emit('score:change', { score: this.score, delta });
    const previous = this.previousHighScore();
    if (!this.beatenAnnounced && previous > 0 && this.score > previous) {
      this.beatenAnnounced = true;
      this.bus.emit('highscore:beaten', { score: this.score, previous });
    }
  }
}
