import { BALANCE } from '../config/balance';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';

/**
 * Colored-meteor power-up: grants points every second for a while (+10/s, or +20/s
 * for the rare mega bonus). Picking another one while active restarts the timer.
 */
export class PowerUpManager {
  active = false;
  big = false;
  rate = 0;
  duration = 0;
  remaining = 0;
  private elapsed = 0;
  private ticksAwarded = 0;

  constructor(private readonly bus: EventBus<GameEvents>) {}

  reset(): void {
    const wasActive = this.active;
    this.active = false;
    this.big = false;
    this.remaining = 0;
    this.rate = 0;
    if (wasActive) this.bus.emit('powerup:end', {});
  }

  activate(big: boolean, x: number, y: number, z: number): void {
    const cfg = BALANCE.powerUp;
    const duration = big ? cfg.bigDuration : cfg.duration;
    const rate = big ? cfg.bigRate : cfg.rate;
    this.big = this.active ? this.big || big : big;
    this.rate = this.active ? Math.max(this.rate, rate) : rate;
    this.duration = Math.max(duration, this.active ? this.remaining : 0);
    this.remaining = this.duration;
    this.elapsed = 0;
    this.ticksAwarded = 0;
    this.active = true;
    this.bus.emit('powerup:start', { duration: this.duration, rate: this.rate, big: this.big, x, y, z });
  }

  /** Advances the timer; calls onTick(points) once per elapsed second. */
  update(dt: number, onTick: (amount: number) => void): void {
    if (!this.active) return;
    this.elapsed += dt;
    this.remaining = Math.max(0, this.duration - this.elapsed);
    const maxTicks = Math.round(this.duration);
    const due = Math.min(maxTicks, Math.floor(this.elapsed + 1e-4));
    while (this.ticksAwarded < due) {
      this.ticksAwarded++;
      onTick(this.rate);
    }
    if (this.remaining <= 1e-6) {
      this.active = false;
      this.big = false;
      this.bus.emit('powerup:end', {});
    }
  }
}
