import { BALANCE } from '../config/balance';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { HazardKind, MoveCommand } from '../core/types';
import type { SaveManager } from '../save/SaveManager';
import type { World } from '../world/World';
import { DifficultyManager } from './DifficultyManager';
import { PowerUpManager } from './PowerUpManager';
import { ScoreManager } from './ScoreManager';
import { SpawnManager } from './SpawnManager';

/**
 * One run of the game (the PLAYING simulation). Composes world, spawner, difficulty,
 * score and power-up systems. Contains no rendering, input-device or DOM code, so it
 * can be simulated headlessly (see tests/fairness.test.ts).
 */
export class GameSession {
  readonly difficulty = new DifficultyManager();
  readonly score: ScoreManager;
  readonly powerUp: PowerUpManager;
  readonly spawner: SpawnManager;
  time = 0;
  alive = false;
  deathCause: HazardKind | null = null;

  constructor(
    readonly world: World,
    private readonly bus: EventBus<GameEvents>,
    save: Pick<SaveManager, 'highScore'>,
  ) {
    this.score = new ScoreManager(bus, () => save.highScore);
    this.powerUp = new PowerUpManager(bus);
    this.spawner = new SpawnManager(world, this.difficulty, world.rng, bus);
  }

  start(): void {
    const w = this.world;
    w.clear();
    w.time = 0;
    w.player.reset(0, w.arena.startZ);
    this.time = 0;
    this.alive = true;
    this.deathCause = null;
    this.difficulty.reset();
    this.score.reset();
    this.powerUp.reset();
    this.spawner.reset();
    w.flow = BALANCE.flow[0];
    this.bus.emit('run:start', {});
  }

  /** Advances the run by one simulation step. */
  step(dt: number, cmd: MoveCommand): void {
    const w = this.world;
    if (!this.alive) {
      this.stepAftermath(dt);
      return;
    }
    this.time += dt;
    this.difficulty.update(this.time);
    w.flow = this.difficulty.at(BALANCE.flow);
    w.alienCtx.lungeChance = this.difficulty.at(BALANCE.aliens.lungeChance);
    w.player.move(dt, cmd, w.arena);
    this.spawner.update(dt);
    w.update(dt);

    const p = w.player.pos;
    const rep = w.checkCollisions();
    for (const coin of rep.coins) {
      this.score.addCoin(coin.kind, coin.pos.x, 0.4, coin.pos.z);
      w.releaseCoin(coin);
    }
    for (const m of rep.powerUps) {
      this.powerUp.activate(m.big, m.pos.x, 0.3, m.pos.z);
      w.releasePowerUp(m);
    }
    if (rep.hazard) {
      this.die(rep.hazard);
      return;
    }
    this.score.update(dt);
    this.powerUp.update(dt, (amount) => this.score.addBonus(amount, p.x, 0.8, p.z));
    w.player.powered = this.powerUp.active;
  }

  /** After death the world keeps drifting (background life) without spawning. */
  stepAftermath(dt: number): void {
    this.world.update(dt);
  }

  private die(cause: HazardKind): void {
    const w = this.world;
    this.alive = false;
    this.deathCause = cause;
    w.player.alive = false;
    w.player.powered = false;
    w.player.object.visible = false;
    this.powerUp.reset();
    const p = w.player.pos;
    this.bus.emit('player:hit', { cause, x: p.x, y: 0, z: p.z });
  }
}
