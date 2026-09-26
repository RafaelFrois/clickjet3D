import * as THREE from 'three';
import { BALANCE } from '../config/balance';
import { circlesOverlap } from '../core/math';
import { Pool } from '../core/Pool';
import type { Rng } from '../core/Rng';
import type { CoinKind, HazardKind } from '../core/types';
import type { Models } from '../render/Models';
import type { ParticleEmitter } from '../render/ParticleSystem';
import { Arena } from './Arena';
import { Coin } from './entities/Coin';
import { GreenAlien, type AlienContext } from './entities/GreenAlien';
import { Meteor } from './entities/Meteor';
import { Player, type PlayerColliders } from './entities/Player';
import { PurpleAlien, type ChaseParams } from './entities/PurpleAlien';
import { Rock } from './entities/Rock';
import { Warning } from './entities/Warning';

export interface CollisionReport {
  coins: Coin[];
  powerUps: Meteor[];
  hazard: HazardKind | null;
}

/** Something the UI should point at when it's off-screen (edge indicators). */
export interface IndicatorTarget {
  kind: 'meteor' | 'chaser' | 'powerup';
  x: number;
  z: number;
  urgency: number;
}

/**
 * Owns every gameplay entity (pooled), moves them, recycles what leaves the arena and
 * reports collisions. It knows nothing about input devices, UI, audio or rendering.
 */
export class World {
  readonly root = new THREE.Group();
  readonly arena = new Arena();
  readonly player: Player;
  readonly yellowCoins: Pool<Coin>;
  readonly rainbowCoins: Pool<Coin>;
  readonly meteors: Pool<Meteor>;
  readonly powerUps: Pool<Meteor>;
  readonly rocks: Pool<Rock>;
  readonly aliens: Pool<GreenAlien>;
  readonly warnings: Pool<Warning>;
  readonly chaser: PurpleAlien;
  flow: number = BALANCE.flow[0];
  time = 0;
  /** Debug/QA: ignore hazard collisions. */
  invulnerable = false;
  chaseParams: ChaseParams = { speed: 5, accel: 8, lead: 0, surge: false };
  onMeteorLaunch: ((m: Meteor) => void) | null = null;

  private readonly report: CollisionReport = { coins: [], powerUps: [], hazard: null };
  private readonly colliders: PlayerColliders = { ax: 0, az: 0, bx: 0, bz: 0, r: 0 };
  private glowEnabled = true;
  readonly alienCtx: AlienContext;

  constructor(
    readonly models: Models,
    public particles: ParticleEmitter,
    readonly rng: Rng,
  ) {
    this.player = new Player(models);
    this.root.add(this.player.object);

    const attach = <T extends { object: THREE.Object3D }>(factory: () => T) => () => {
      const item = factory();
      this.root.add(item.object);
      return item;
    };
    this.yellowCoins = new Pool(attach(() => new Coin('yellow', models)), 30, 60);
    this.rainbowCoins = new Pool(attach(() => new Coin('rainbow', models)), 10, 24);
    this.meteors = new Pool(attach(() => new Meteor(models, false)), 12, 28);
    this.powerUps = new Pool(attach(() => new Meteor(models, true)), 2, 4);
    this.rocks = new Pool(attach(() => new Rock(models)), 8, 14);
    this.aliens = new Pool(attach(() => new GreenAlien(models)), 6, 10);
    this.warnings = new Pool(attach(() => new Warning(models.warningStrip)), 8, 20);
    this.chaser = new PurpleAlien(models);
    this.root.add(this.chaser.object);

    this.alienCtx = {
      time: 0,
      flow: this.flow,
      arena: this.arena,
      rng,
      playerX: 0,
      playerZ: 0,
      playerAlive: true,
      lungeChance: 0,
      onLunge: () => {},
    };
  }

  /** Removes every entity (menu / restart). */
  clear(): void {
    const hide = (e: { hide(): void }) => e.hide();
    this.yellowCoins.releaseAll(hide);
    this.rainbowCoins.releaseAll(hide);
    this.meteors.releaseAll(hide);
    this.powerUps.releaseAll(hide);
    this.rocks.releaseAll(hide);
    this.aliens.releaseAll(hide);
    this.warnings.releaseAll(hide);
    this.chaser.despawn();
  }

  coinPool(kind: CoinKind): Pool<Coin> {
    return kind === 'rainbow' ? this.rainbowCoins : this.yellowCoins;
  }

  setGlowEnabled(on: boolean): void {
    if (on === this.glowEnabled) return;
    this.glowEnabled = on;
    for (const pool of [this.yellowCoins, this.rainbowCoins]) {
      for (const c of pool.active) c.setGlowEnabled(on);
    }
    for (const pool of [this.meteors, this.powerUps]) {
      for (const m of pool.active) m.setGlowEnabled(on);
    }
  }

  /** Moves every entity (not the player) and recycles those that left the arena. */
  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    const p = this.particles;
    const arena = this.arena;

    for (const pool of [this.yellowCoins, this.rainbowCoins]) {
      const list = pool.active;
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        c.update(dt, t, p);
        c.setGlowEnabled(this.glowEnabled);
        if (arena.isOutside(c.pos.x, c.pos.z, c.radius)) {
          c.hide();
          pool.release(c);
        }
      }
    }

    for (const pool of [this.meteors, this.powerUps]) {
      const list = pool.active;
      for (let i = list.length - 1; i >= 0; i--) {
        const m = list[i];
        m.update(dt, t, p);
        m.setGlowEnabled(this.glowEnabled);
        if (m.age > 1 && arena.isOutside(m.pos.x, m.pos.z, m.radius)) {
          m.hide();
          pool.release(m);
        }
      }
    }

    const rocks = this.rocks.active;
    for (let i = rocks.length - 1; i >= 0; i--) {
      const r = rocks[i];
      r.update(dt);
      if (r.age > 1 && arena.isOutside(r.pos.x, r.pos.z, r.radius)) {
        r.hide();
        this.rocks.release(r);
      }
    }

    const ctx = this.alienCtx;
    ctx.time = t;
    ctx.flow = this.flow;
    ctx.playerX = this.player.pos.x;
    ctx.playerZ = this.player.pos.z;
    ctx.playerAlive = this.player.alive;
    const aliens = this.aliens.active;
    for (let i = aliens.length - 1; i >= 0; i--) {
      const a = aliens[i];
      a.update(dt, ctx);
      if (a.age > 2 && arena.isOutside(a.pos.x, a.pos.z, a.radius)) {
        a.hide();
        this.aliens.release(a);
      }
    }

    const pl = this.player;
    this.chaser.hunting = this.chaser.active && pl.alive;
    this.chaser.update(dt, t, pl.pos.x, pl.pos.z, pl.vel.x, pl.vel.z, this.chaseParams, p);

    const warnings = this.warnings.active;
    for (let i = warnings.length - 1; i >= 0; i--) {
      const w = warnings[i];
      if (w.update(dt)) {
        this.launchMeteor(w);
        w.hide();
        this.warnings.release(w);
      }
    }
  }

  private launchMeteor(w: Warning): void {
    const m = this.meteors.acquire();
    if (!m) return;
    m.spawn(w.start.x, w.start.z, w.vel.x, w.vel.z, w.radius, w.size);
    m.setGlowEnabled(this.glowEnabled);
    this.onMeteorLaunch?.(m);
  }

  /** Player vs everything. Coins/power-ups touched are returned (caller scores and releases them). */
  checkCollisions(): CollisionReport {
    const rep = this.report;
    rep.coins.length = 0;
    rep.powerUps.length = 0;
    rep.hazard = null;
    const pl = this.player;
    if (!pl.alive) return rep;
    const c = pl.getColliders(this.colliders);
    const px = pl.pos.x;
    const pz = pl.pos.z;
    const pickup = BALANCE.player.pickupRadius;

    for (const pool of [this.yellowCoins, this.rainbowCoins]) {
      for (const coin of pool.active) {
        if (coin.age > 0.05 && circlesOverlap(px, pz, pickup, coin.pos.x, coin.pos.z, coin.radius)) rep.coins.push(coin);
      }
    }
    for (const m of this.powerUps.active) {
      if (circlesOverlap(px, pz, pickup, m.pos.x, m.pos.z, m.radius)) rep.powerUps.push(m);
    }
    if (this.invulnerable) return rep;

    const hit = (x: number, z: number, r: number): boolean =>
      circlesOverlap(c.ax, c.az, c.r, x, z, r) || circlesOverlap(c.bx, c.bz, c.r, x, z, r);

    for (const m of this.meteors.active) {
      if (hit(m.pos.x, m.pos.z, m.radius * 0.9)) {
        rep.hazard = 'meteor';
        return rep;
      }
    }
    for (const r of this.rocks.active) {
      if (r.age > 0.25 && hit(r.pos.x, r.pos.z, r.radius)) {
        rep.hazard = 'rock';
        return rep;
      }
    }
    for (const a of this.aliens.active) {
      if (a.age > 0.3 && hit(a.pos.x, a.pos.z, a.radius)) {
        rep.hazard = 'alien';
        return rep;
      }
    }
    const ch = this.chaser;
    if (ch.active && ch.age > 0.4 && hit(ch.pos.x, ch.pos.z, ch.radius)) rep.hazard = 'chaser';
    return rep;
  }

  releaseCoin(coin: Coin): void {
    coin.hide();
    this.coinPool(coin.kind).release(coin);
  }

  releasePowerUp(m: Meteor): void {
    m.hide();
    this.powerUps.release(m);
  }

  /** Targets for off-screen edge indicators (warnings, chaser, power-ups). */
  collectIndicators(out: IndicatorTarget[]): IndicatorTarget[] {
    out.length = 0;
    for (const w of this.warnings.active) out.push({ kind: 'meteor', x: w.start.x, z: w.start.z, urgency: w.timer / w.duration });
    if (this.chaser.active) out.push({ kind: 'chaser', x: this.chaser.pos.x, z: this.chaser.pos.z, urgency: 1 });
    for (const m of this.powerUps.active) out.push({ kind: 'powerup', x: m.pos.x, z: m.pos.z, urgency: 1 });
    return out;
  }
}
