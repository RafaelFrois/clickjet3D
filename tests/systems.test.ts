import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/config/balance';
import { EventBus } from '../src/core/EventBus';
import type { GameEvents } from '../src/core/events';
import { SaveManager, sanitize, SAVE_KEY, type StorageLike } from '../src/save/SaveManager';
import { DifficultyManager } from '../src/systems/DifficultyManager';
import { PowerUpManager } from '../src/systems/PowerUpManager';
import { ScoreManager } from '../src/systems/ScoreManager';

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

describe('ScoreManager', () => {
  it('yellow +5, rainbow +10', () => {
    const bus = new EventBus<GameEvents>();
    const s = new ScoreManager(bus, () => 0);
    s.addCoin('yellow', 0, 0, 0);
    s.update(2); // combo expires
    s.addCoin('rainbow', 0, 0, 0);
    expect(s.score).toBe(15);
  });

  it('combo multiplies coins collected quickly and resets after the window', () => {
    const bus = new EventBus<GameEvents>();
    const s = new ScoreManager(bus, () => 0);
    const per = BALANCE.score.comboPickupsPerLevel;
    const values: number[] = [];
    for (let i = 0; i < per * 3; i++) {
      values.push(s.addCoin('yellow', 0, 0, 0));
      s.update(0.1);
    }
    expect(values.slice(0, per)).toEqual(Array(per).fill(5));
    expect(values.slice(per, per * 2)).toEqual(Array(per).fill(10));
    expect(values.slice(per * 2)).toEqual(Array(per).fill(15));
    s.update(BALANCE.score.comboWindow + 0.1);
    expect(s.multiplier).toBe(1);
    expect(s.addCoin('yellow', 0, 0, 0)).toBe(5);
  });

  it('announces a new high score once, only when a record exists', () => {
    const bus = new EventBus<GameEvents>();
    let beaten = 0;
    bus.on('highscore:beaten', () => beaten++);
    const s = new ScoreManager(bus, () => 12);
    s.addCoin('rainbow', 0, 0, 0);
    expect(beaten).toBe(0);
    s.addCoin('yellow', 0, 0, 0);
    s.addCoin('yellow', 0, 0, 0);
    expect(beaten).toBe(1);
    const first = new ScoreManager(bus, () => 0);
    first.addCoin('yellow', 0, 0, 0);
    expect(beaten).toBe(1);
  });
});

describe('PowerUpManager', () => {
  it('grants +10 per second for 5 seconds', () => {
    const bus = new EventBus<GameEvents>();
    const pu = new PowerUpManager(bus);
    let total = 0;
    let ticks = 0;
    let ended = false;
    bus.on('powerup:end', () => (ended = true));
    pu.activate(false, 0, 0, 0);
    for (let t = 0; t < 7; t += 1 / 60) {
      pu.update(1 / 60, (a) => {
        total += a;
        ticks++;
      });
    }
    expect(ticks).toBe(5);
    expect(total).toBe(50);
    expect(ended).toBe(true);
    expect(pu.active).toBe(false);
  });

  it('picking another power-up restarts the timer; mega bonus is +20/s', () => {
    const bus = new EventBus<GameEvents>();
    const pu = new PowerUpManager(bus);
    pu.activate(false, 0, 0, 0);
    pu.update(3, () => {});
    pu.activate(true, 0, 0, 0);
    expect(pu.rate).toBe(20);
    expect(pu.remaining).toBeCloseTo(BALANCE.powerUp.bigDuration);
  });
});

describe('DifficultyManager', () => {
  it('grows smoothly and moves through the stages', () => {
    const d = new DifficultyManager();
    let prev = -1;
    for (let t = 0; t <= 300; t += 5) {
      d.update(t);
      expect(d.level).toBeGreaterThanOrEqual(prev);
      expect(d.level).toBeLessThan(1);
      prev = d.level;
    }
    d.update(5);
    expect(d.stage).toBe('start');
    d.update(40);
    expect(d.stage).toBe('mid');
    d.update(120);
    expect(d.stage).toBe('final');
  });

  it('varies more than speed: directions, sizes and bursts open up over time', () => {
    const d = new DifficultyManager();
    d.update(0);
    const early = d.meteorDirectionWeights();
    expect(early.side).toBe(0);
    expect(early.bottom).toBe(0);
    expect(d.meteorBurst()).toBe(1);
    d.update(200);
    const late = d.meteorDirectionWeights();
    expect(late.diag).toBeGreaterThan(0.5);
    expect(late.side).toBeGreaterThan(0.3);
    expect(late.bottom).toBeGreaterThan(0.1);
    expect(d.meteorBurst()).toBeGreaterThanOrEqual(2);
    expect(d.meteorSizeWeights().L).toBeGreaterThan(0.2);
  });

  it('the chaser is always slower than the player, even while surging', () => {
    const d = new DifficultyManager();
    d.update(10_000);
    expect(d.at(BALANCE.chaser.speed) * 1.15).toBeLessThan(BALANCE.player.maxSpeed);
  });
});

describe('SaveManager', () => {
  it('falls back to defaults on corrupted data', () => {
    const st = new MemoryStorage();
    st.setItem(SAVE_KEY, '{not json');
    const save = new SaveManager(st);
    expect(save.highScore).toBe(0);
    expect(sanitize({ highScore: -5, settings: { musicVolume: 7, quality: 'ultra' } }).settings.musicVolume).toBe(1);
    expect(sanitize({ settings: { quality: 'ultra' } }).settings.quality).toBe('auto');
    expect(sanitize({ highScore: -5 }).highScore).toBe(0);
  });

  it('persists high score, mute and settings', () => {
    const st = new MemoryStorage();
    const save = new SaveManager(st);
    expect(save.submitRun(110, 9.2).newHighScore).toBe(true);
    expect(save.submitRun(50, 3).newHighScore).toBe(false);
    save.updateSettings({ muted: true, musicVolume: 0.3, touchMode: 'follow' });
    const again = new SaveManager(st);
    expect(again.highScore).toBe(110);
    expect(again.data.bestTime).toBeCloseTo(9.2);
    expect(again.data.gamesPlayed).toBe(2);
    expect(again.settings.muted).toBe(true);
    expect(again.settings.musicVolume).toBeCloseTo(0.3);
    expect(again.settings.touchMode).toBe('follow');
  });

  it('keeps working without storage (private mode)', () => {
    const save = new SaveManager(null);
    save.submitRun(10, 1);
    expect(save.highScore).toBe(10);
  });
});
