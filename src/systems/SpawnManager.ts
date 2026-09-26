import { BALANCE, type MeteorSize } from '../config/balance';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import { clamp, dist2, lerp } from '../core/math';
import type { Rng } from '../core/Rng';
import type { CoinKind, RareEventId } from '../core/types';
import type { World } from '../world/World';
import type { DifficultyManager, MeteorDirection } from './DifficultyManager';

export interface HazardSpawnRecord {
  kind: 'meteor' | 'rock' | 'alien' | 'chaser' | 'powerup';
  time: number;
  x: number;
  z: number;
  radius: number;
  playerX: number;
  playerZ: number;
}

interface ActiveEvent {
  id: RareEventId;
  timer: number;
  duration: number;
  /** Meteor shower: base direction and next shot timer. */
  dirX: number;
  dirZ: number;
  next: number;
  lastLaneX: number;
}

const EVENT_LABELS: Record<RareEventId, string> = {
  meteorShower: 'METEOR SHOWER!',
  coinRain: 'COIN RAIN!',
  alienSwarm: 'ALIEN SWARM!',
  megaBonus: 'MEGA BONUS!',
  rainbowTrail: 'RAINBOW TRAIL!',
};

/**
 * Central spawner for coins, meteors, rocks, aliens, the chaser, power-ups and rare
 * events. Every spawn goes through fairness rules:
 *  - hazards never appear on/near the player (safe radius) and always enter from off-screen;
 *  - meteors are telegraphed (warning lane) before entering; bursts keep free lanes;
 *  - rocks never close a horizontal band (a minimum corridor is always left);
 *  - global density cap so the screen never becomes an impossible wall;
 *  - power-ups always cross the reachable area slowly.
 */
export class SpawnManager {
  /** Filled only when recording is enabled (tests / QA). */
  readonly records: HazardSpawnRecord[] = [];
  recording = false;
  activeEvent: ActiveEvent | null = null;
  chaserPhase: 'waiting' | 'warning' | 'active' = 'waiting';

  private time = 0;
  private coinTimer = 0.2;
  private meteorTimer = 0;
  private rockTimer = 0;
  private alienTimer = 0;
  private powerUpTimer = 0;
  private eventTimer = 0;
  private chaserTimer = 0;
  private readonly chaserSpawn = { x: 0, z: 0 };
  private lastEvent: RareEventId | null = null;
  private alienPause = 0;

  constructor(
    private readonly world: World,
    private readonly difficulty: DifficultyManager,
    private readonly rng: Rng,
    private readonly bus: EventBus<GameEvents>,
  ) {}

  reset(): void {
    this.time = 0;
    this.coinTimer = 0.2;
    this.meteorTimer = BALANCE.meteors.firstAt;
    this.rockTimer = BALANCE.rocks.firstAt;
    this.alienTimer = BALANCE.aliens.firstAt;
    this.powerUpTimer = this.rng.range(...BALANCE.powerUp.firstDelay);
    this.eventTimer = BALANCE.events.firstAt + this.rng.range(0, 8);
    this.chaserTimer = BALANCE.chaser.firstAt;
    this.chaserPhase = 'waiting';
    this.activeEvent = null;
    this.lastEvent = null;
    this.alienPause = 0;
    this.records.length = 0;
  }

  update(dt: number): void {
    this.time += dt;
    const d = this.difficulty;
    this.alienPause -= dt;

    this.coinTimer -= dt;
    if (this.coinTimer <= 0) {
      this.coinTimer = d.at(BALANCE.coins.interval) * this.rng.range(0.8, 1.2);
      this.spawnCoinWave();
    }

    this.updateEvent(dt);
    const showering = this.activeEvent?.id === 'meteorShower';

    this.meteorTimer -= dt;
    if (this.meteorTimer <= 0 && !showering) {
      this.meteorTimer = d.at(BALANCE.meteors.interval) * this.rng.range(0.75, 1.25);
      this.spawnMeteorBurst();
    }

    this.rockTimer -= dt;
    if (this.rockTimer <= 0) {
      this.rockTimer = d.at(BALANCE.rocks.interval) * this.rng.range(0.7, 1.3) * (showering ? 2 : 1);
      this.spawnRock();
    }

    this.alienTimer -= dt;
    if (this.alienTimer <= 0) {
      this.alienTimer = d.at(BALANCE.aliens.interval) * this.rng.range(0.8, 1.2);
      if (this.alienPause <= 0 && !showering) this.spawnAlien();
    }

    this.powerUpTimer -= dt;
    if (this.powerUpTimer <= 0) {
      this.powerUpTimer = this.rng.range(...BALANCE.powerUp.interval);
      this.spawnPowerUp(false);
    }

    this.updateChaser(dt);

    this.eventTimer -= dt;
    if (this.eventTimer <= 0 && !this.activeEvent) {
      this.eventTimer = this.rng.range(...BALANCE.events.interval);
      this.startRareEvent();
    }
  }

  /* ------------------------------ Helpers -------------------------------- */

  private get player() {
    return this.world.player;
  }

  private record(kind: HazardSpawnRecord['kind'], x: number, z: number, radius: number): void {
    if (!this.recording) return;
    this.records.push({ kind, time: this.time, x, z, radius, playerX: this.player.pos.x, playerZ: this.player.pos.z });
  }

  /** Fairness: never spawn a hazard near the player. */
  isSafeFromPlayer(x: number, z: number, radius: number): boolean {
    const r = BALANCE.fairness.safeRadius + radius;
    return dist2(x, z, this.player.pos.x, this.player.pos.z) >= r * r;
  }

  /** Number of hazards currently weighing on the play area (global density cap). */
  private threat(): number {
    const w = this.world;
    return w.rocks.count * 1 + w.aliens.count * 1.2 + (w.meteors.count + w.warnings.count) * 0.5 + (w.chaser.active ? 1 : 0);
  }

  private maxThreat(): number {
    return lerp(4, 12, this.difficulty.level);
  }

  private randomArenaPoint(out: { x: number; z: number }, margin = 1.5): { x: number; z: number } {
    const a = this.world.arena;
    out.x = this.rng.range(-a.halfWidth + margin, a.halfWidth - margin);
    out.z = this.rng.range(a.zMin + margin, a.zMax - margin);
    return out;
  }

  /* ------------------------------- Coins --------------------------------- */

  private spawnCoin(kind: CoinKind, x: number, z: number, vx: number, vz: number): boolean {
    const w = this.world;
    const total = w.yellowCoins.count + w.rainbowCoins.count;
    if (total >= BALANCE.coins.maxActive) return false;
    // Don't bury coins inside rocks.
    for (const r of w.rocks.active) {
      const rr = r.radius + 0.45;
      if (dist2(x, z, r.pos.x, r.pos.z) < rr * rr) return false;
    }
    const c = w.coinPool(kind).acquire();
    if (!c) return false;
    c.spawn(x, z, vx, vz);
    return true;
  }

  private spawnCoinWave(): void {
    const d = this.difficulty;
    const a = this.world.arena;
    const flow = this.world.flow;
    const rainbowChance = d.at(BALANCE.coins.rainbowChance);

    // Risk vs reward: coins orbiting a rock that is still entering the arena.
    if (this.rng.chance(d.at(BALANCE.coins.riskChance)) && this.spawnRiskCoins(rainbowChance)) return;

    const z0 = a.spawnTop + 2;
    const pattern = this.rng.weighted({ single: 1.2, line: 1, row: 1, arc: 0.8, diamond: 0.5, zigzag: 0.7 });
    const pts: [number, number][] = [];
    const lim = a.halfWidth - 1.5;
    switch (pattern) {
      case 'single': {
        pts.push([this.rng.range(-lim, lim), z0]);
        break;
      }
      case 'line': {
        const x = this.rng.range(-lim, lim);
        for (let i = 0; i < 5; i++) pts.push([x, z0 - i * 1.3]);
        break;
      }
      case 'row': {
        const n = this.rng.int(4, 5);
        const x = this.rng.range(-lim + (n - 1) * 0.7, lim - (n - 1) * 0.7);
        for (let i = 0; i < n; i++) pts.push([x + (i - (n - 1) / 2) * 1.4, z0]);
        break;
      }
      case 'arc': {
        const x = this.rng.range(-lim + 2.5, lim - 2.5);
        for (let i = 0; i < 7; i++) {
          const t = (i / 6) * Math.PI;
          pts.push([x + Math.cos(t) * 2.6, z0 - Math.sin(t) * 2.2]);
        }
        break;
      }
      case 'diamond': {
        const x = this.rng.range(-lim + 2, lim - 2);
        for (let i = 0; i < 8; i++) {
          const t = (i / 8) * Math.PI * 2;
          pts.push([x + Math.cos(t) * 1.9, z0 - 2 + Math.sin(t) * 1.9]);
        }
        // Rainbow jewel in the middle of the diamond.
        this.spawnCoin('rainbow', x, z0 - 2, 0, flow);
        break;
      }
      case 'zigzag': {
        const x = this.rng.range(-lim + 1.5, lim - 1.5);
        for (let i = 0; i < 8; i++) pts.push([x + (i % 2 === 0 ? -1 : 1) * 1.1, z0 - i * 1.1]);
        break;
      }
    }
    const rainbowIndex = this.rng.chance(rainbowChance) ? this.rng.int(0, pts.length - 1) : -1;
    pts.forEach(([x, z], i) => this.spawnCoin(i === rainbowIndex ? 'rainbow' : 'yellow', clamp(x, -lim, lim), z, 0, flow));
  }

  private spawnRiskCoins(rainbowChance: number): boolean {
    const a = this.world.arena;
    const rock = this.world.rocks.active.find((r) => r.pos.z < a.zMin + 2 && r.pos.z > a.spawnTop - 2);
    if (!rock) return false;
    const n = 6;
    const ring = rock.radius + 1.25;
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2;
      this.spawnCoin('yellow', rock.pos.x + Math.cos(t) * ring, rock.pos.z + Math.sin(t) * ring, rock.vel.x, rock.vel.z);
    }
    if (this.rng.chance(0.4 + rainbowChance)) {
      this.spawnCoin('rainbow', rock.pos.x, rock.pos.z - ring - 0.9, rock.vel.x, rock.vel.z);
    }
    return true;
  }

  /* ------------------------------ Meteors -------------------------------- */

  /**
   * Computes an off-screen entry point and velocity for a meteor coming from the given
   * direction category, aimed at a mix between a random arena point and the player.
   */
  private meteorPath(
    dir: MeteorDirection,
    radius: number,
    speed: number,
    aim: number,
    out: { x: number; z: number; vx: number; vz: number },
  ): void {
    const a = this.world.arena;
    const rng = this.rng;
    const target = this.randomArenaPoint({ x: 0, z: 0 }, 2);
    target.x = lerp(target.x, this.player.pos.x, aim);
    target.z = lerp(target.z, this.player.pos.z, aim);
    const side = rng.sign();
    switch (dir) {
      case 'top':
        out.x = clamp(target.x + rng.range(-5, 5), -a.visibleFar, a.visibleFar);
        out.z = a.spawnTop - radius;
        break;
      case 'diag':
        out.x = side * (a.visibleFar + radius + 1.5);
        out.z = a.spawnTop + rng.range(0, 6);
        break;
      case 'side': {
        const z = rng.range(a.zMin + 1, a.zMax - 2);
        out.x = side * a.sideSpawnX(z, radius);
        out.z = z;
        break;
      }
      case 'bottom':
        out.x = rng.range(-a.halfWidth + 2, a.halfWidth - 2);
        out.z = a.spawnBottom + radius;
        break;
    }
    const dx = target.x - out.x;
    const dz = target.z - out.z;
    const len = Math.hypot(dx, dz) || 1;
    out.vx = (dx / len) * speed;
    out.vz = (dz / len) * speed;
  }

  /** True when a circle at (x, z) is inside the visible part of the arena. */
  private isOnScreen(x: number, z: number, r: number): boolean {
    const a = this.world.arena;
    return Math.abs(x) < a.visibleHalfWidthAt(z) + r && z > a.zMin - r && z < a.zMax + r;
  }

  private queueMeteor(size: MeteorSize, x: number, z: number, vx: number, vz: number, warn: number): boolean {
    const radius = BALANCE.meteors.sizes[size].radius;
    // Fairness: always enter from off-screen — step the start back along the path if needed.
    const sp = Math.hypot(vx, vz) || 1;
    for (let i = 0; i < 40 && this.isOnScreen(x, z, radius); i++) {
      x -= (vx / sp) * 1;
      z -= (vz / sp) * 1;
    }
    const w = this.world.warnings.acquire();
    if (!w) return false;
    w.spawn(x, z, vx, vz, radius, size, warn, 60);
    this.bus.emit('meteor:warning', { size, x, z });
    this.record('meteor', x, z, radius);
    return true;
  }

  spawnMeteorBurst(): void {
    if (this.threat() > this.maxThreat()) return;
    const d = this.difficulty;
    const cfg = BALANCE.meteors;
    const dir = this.rng.weighted(d.meteorDirectionWeights());
    const size = this.rng.weighted(d.meteorSizeWeights());
    const s = cfg.sizes[size];
    const speed = this.rng.range(...s.speed);
    const warn = d.at(cfg.warn) + (dir === 'bottom' ? 0.35 : dir === 'side' ? 0.15 : 0);
    const path = { x: 0, z: 0, vx: 0, vz: 0 };
    this.meteorPath(dir, s.radius, speed, d.at(cfg.aim), path);

    // Parallel lanes, spaced so there is always a corridor between them and beside them.
    const a = this.world.arena;
    const spacing = Math.max(cfg.laneSpacing, s.radius * 2 + 2.3);
    const maxLanes = Math.max(1, Math.floor((a.halfWidth * 2 - 4) / spacing));
    const lanes = Math.min(d.meteorBurst(), maxLanes, this.rng.int(1, d.meteorBurst()));
    const speedLen = Math.hypot(path.vx, path.vz) || 1;
    const px = -path.vz / speedLen; // perpendicular
    const pz = path.vx / speedLen;
    for (let i = 0; i < lanes; i++) {
      const off = (i - (lanes - 1) / 2) * spacing;
      // Stagger lanes slightly for rhythm.
      const stagger = i * 0.12;
      this.queueMeteor(size, path.x + px * off, path.z + pz * off, path.vx, path.vz, warn + stagger);
    }
  }

  /* ------------------------------- Rocks --------------------------------- */

  /** Largest free horizontal gap in the band around z if a rock of radius r were added at x. */
  largestGapWith(x: number, z: number, r: number): number {
    const a = this.world.arena;
    const band = BALANCE.rocks.bandHeight;
    const blocked: [number, number][] = [[x - r, x + r]];
    for (const rock of this.world.rocks.active) {
      if (Math.abs(rock.pos.z - z) < band + rock.radius + r) blocked.push([rock.pos.x - rock.radius, rock.pos.x + rock.radius]);
    }
    blocked.sort((p, q) => p[0] - q[0]);
    let best = 0;
    let cursor = -a.halfWidth;
    for (const [lo, hi] of blocked) {
      if (lo > cursor) best = Math.max(best, lo - cursor);
      cursor = Math.max(cursor, hi);
    }
    best = Math.max(best, a.halfWidth - cursor);
    return best;
  }

  spawnRock(): boolean {
    const d = this.difficulty;
    const cfg = BALANCE.rocks;
    const w = this.world;
    if (w.rocks.count >= Math.round(d.at(cfg.maxActive))) return false;
    if (this.threat() > this.maxThreat()) return false;
    const a = w.arena;
    const scale = this.rng.range(cfg.scale[0], lerp(cfg.scale[0] + 0.3, cfg.scale[1], d.level));
    const radius = 0.82 * scale;
    const fromSide = d.level > 0.3 && this.rng.chance(0.25);
    for (let attempt = 0; attempt < 6; attempt++) {
      let x: number;
      let z: number;
      let vx: number;
      let vz: number;
      if (fromSide) {
        z = this.rng.range(a.zMin, a.zMin + (a.zMax - a.zMin) * 0.5);
        const side = this.rng.sign();
        x = side * a.sideSpawnX(z, radius);
        vx = -side * this.rng.range(1.4, 2.6);
        vz = w.flow * this.rng.range(0.5, 0.9);
      } else {
        x = this.rng.range(-a.halfWidth + radius, a.halfWidth - radius);
        z = a.spawnTop - radius;
        vx = this.rng.range(-0.9, 0.9);
        vz = w.flow * this.rng.range(0.9, 1.2);
      }
      if (!this.isSafeFromPlayer(x, z, radius)) continue;
      if (!fromSide && this.largestGapWith(x, z, radius) < cfg.minGap) continue;
      const rock = w.rocks.acquire();
      if (!rock) return false;
      rock.spawn(x, z, vx, vz, scale, this.rng.int(0, 4));
      this.record('rock', x, z, radius);
      return true;
    }
    return false;
  }

  /* ------------------------------- Aliens -------------------------------- */

  spawnAlien(): boolean {
    const d = this.difficulty;
    const cfg = BALANCE.aliens;
    const w = this.world;
    if (w.aliens.count >= Math.round(d.at(cfg.maxActive))) return false;
    if (this.threat() > this.maxThreat()) return false;
    const a = w.arena;
    for (let attempt = 0; attempt < 5; attempt++) {
      const fromTop = this.rng.chance(0.6);
      let x: number;
      let z: number;
      if (fromTop) {
        x = this.rng.range(-a.halfWidth + 2, a.halfWidth - 2);
        z = a.spawnTop;
      } else {
        z = this.rng.range(a.zMin, a.zMin + (a.zMax - a.zMin) * 0.45);
        x = this.rng.sign() * a.sideSpawnX(z, 1);
      }
      const scale = this.rng.range(0.95, 1.15);
      if (!this.isSafeFromPlayer(x, z, cfg.headRadius * scale)) continue;
      const alien = w.aliens.acquire();
      if (!alien) return false;
      alien.spawn(x, z, d.at(cfg.speed) * this.rng.range(0.85, 1.15), this.rng.range(...cfg.lifetime), scale);
      this.record('alien', x, z, alien.radius);
      return true;
    }
    return false;
  }

  /* ------------------------------- Chaser -------------------------------- */

  private updateChaser(dt: number): void {
    const w = this.world;
    const d = this.difficulty;
    const cfg = BALANCE.chaser;
    w.chaseParams.speed = d.at(cfg.speed);
    w.chaseParams.accel = d.at(cfg.accel);
    w.chaseParams.lead = d.at(cfg.lead);
    w.chaseParams.surge = d.level > 0.6;

    if (this.chaserPhase === 'active') return;
    this.chaserTimer -= dt;
    if (this.chaserPhase === 'waiting' && this.chaserTimer <= 0) {
      this.pickChaserEntry();
      this.chaserPhase = 'warning';
      this.chaserTimer = cfg.warn;
      this.bus.emit('chaser:warning', { x: this.chaserSpawn.x, z: this.chaserSpawn.z });
    } else if (this.chaserPhase === 'warning' && this.chaserTimer <= 0) {
      // Re-validate: the player may have moved toward the entry during the warning.
      const p = this.player.pos;
      if (dist2(p.x, p.z, this.chaserSpawn.x, this.chaserSpawn.z) < cfg.minSpawnDistance ** 2) this.pickChaserEntry();
      w.chaser.spawn(this.chaserSpawn.x, this.chaserSpawn.z);
      this.chaserPhase = 'active';
      this.record('chaser', this.chaserSpawn.x, this.chaserSpawn.z, cfg.radius);
      this.bus.emit('chaser:spawn', { x: this.chaserSpawn.x, z: this.chaserSpawn.z });
    }
  }

  /** Chooses the off-screen entry point farthest from the player. */
  private pickChaserEntry(): void {
    const a = this.world.arena;
    const p = this.player.pos;
    const zSide = a.zMin + 1;
    const candidates: [number, number][] = [
      [-a.halfWidth * 0.6, a.spawnTop],
      [a.halfWidth * 0.6, a.spawnTop],
      [0, a.spawnTop],
      [-a.sideSpawnX(zSide, 1), zSide],
      [a.sideSpawnX(zSide, 1), zSide],
      [-a.sideSpawnX(a.zMax - 2, 1), a.zMax - 2],
      [a.sideSpawnX(a.zMax - 2, 1), a.zMax - 2],
    ];
    candidates.sort((c1, c2) => dist2(c2[0], c2[1], p.x, p.z) - dist2(c1[0], c1[1], p.x, p.z));
    const [x, z] = candidates[this.rng.int(0, 1)];
    this.chaserSpawn.x = x;
    this.chaserSpawn.z = z;
  }

  /* ------------------------------ Power-ups ------------------------------ */

  spawnPowerUp(big: boolean): boolean {
    const w = this.world;
    const a = w.arena;
    const m = w.powerUps.acquire();
    if (!m) return false;
    const cfg = BALANCE.powerUp;
    const radius = big ? cfg.bigRadius : cfg.radius;
    const speed = big ? 4.6 : this.rng.range(...cfg.speed);
    // Aim through the reachable area, away from the walls.
    const tx = this.rng.range(a.playerMinX * 0.6, a.playerMaxX * 0.6);
    const tz = this.rng.range(a.playerMinZ + 1, a.playerMaxZ - 1);
    let x: number;
    let z: number;
    if (this.rng.chance(0.6)) {
      x = this.rng.range(-a.halfWidth, a.halfWidth);
      z = a.spawnTop - radius;
    } else {
      z = this.rng.range(a.zMin, a.zMin + 4);
      x = this.rng.sign() * a.sideSpawnX(z, radius);
    }
    const dx = tx - x;
    const dz = tz - z;
    const len = Math.hypot(dx, dz) || 1;
    m.spawn(x, z, (dx / len) * speed, (dz / len) * speed, radius, 'M', big);
    this.record('powerup', x, z, radius);
    this.bus.emit('powerup:spawn', { big, x, z });
    return true;
  }

  /* ---------------------------- Rare events ------------------------------ */

  private startRareEvent(): void {
    const d = this.difficulty.level;
    const weights: Record<RareEventId, number> = {
      meteorShower: d > 0.3 ? 1 : 0,
      coinRain: 1,
      alienSwarm: d > 0.25 ? 0.9 : 0,
      megaBonus: 0.6,
      rainbowTrail: 0.8,
    };
    if (this.lastEvent) weights[this.lastEvent] = 0;
    const id = this.rng.weighted(weights);
    this.lastEvent = id;
    this.triggerEvent(id);
  }

  /** Starts a rare event right away (also used by QA/debug). */
  triggerEvent(id: RareEventId): void {
    const a = this.world.arena;
    const flow = this.world.flow;
    this.bus.emit('event:start', { id, label: EVENT_LABELS[id] });
    switch (id) {
      case 'meteorShower': {
        const side = this.rng.sign();
        const ang = side * this.rng.range(0.3, 0.6);
        this.activeEvent = { id, timer: 0, duration: 6, dirX: Math.sin(ang), dirZ: Math.cos(ang), next: 0.6, lastLaneX: 99 };
        break;
      }
      case 'coinRain': {
        const cols = 6;
        const rows = 4;
        const x0 = this.rng.range(-a.halfWidth + 5, a.halfWidth - 5);
        const rainbow = new Set([this.rng.int(0, cols * rows - 1), this.rng.int(0, cols * rows - 1)]);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const kind: CoinKind = rainbow.has(r * cols + c) ? 'rainbow' : 'yellow';
            this.spawnCoin(kind, x0 + (c - (cols - 1) / 2) * 1.5, a.spawnTop + 2 - r * 1.5, 0, flow);
          }
        }
        break;
      }
      case 'alienSwarm': {
        const n = 5;
        const x0 = this.rng.range(-a.halfWidth * 0.3, a.halfWidth * 0.3);
        for (let i = 0; i < n; i++) {
          const k = i - (n - 1) / 2;
          const alien = this.world.aliens.acquire();
          if (!alien) break;
          const x = x0 + k * 3.4;
          const z = a.spawnTop - Math.abs(k) * 1.6;
          alien.spawn(x, z, 0, 99, 1, { vx: 0, vz: 3.2, swayAmp: 1.1, swayFreq: 1.6 });
          this.record('alien', x, z, alien.radius);
        }
        this.alienPause = 9;
        break;
      }
      case 'megaBonus':
        this.spawnPowerUp(true);
        break;
      case 'rainbowTrail': {
        const x0 = this.rng.range(-a.halfWidth + 3, a.halfWidth - 3);
        for (let i = 0; i < 10; i++) this.spawnCoin('rainbow', x0 + Math.sin(i * 0.7) * 2.4, a.spawnTop + 2 - i * 1.25, 0, flow);
        break;
      }
    }
  }

  private updateEvent(dt: number): void {
    const ev = this.activeEvent;
    if (!ev) return;
    ev.timer += dt;
    if (ev.timer >= ev.duration) {
      this.activeEvent = null;
      this.meteorTimer = Math.max(this.meteorTimer, 1.5);
      return;
    }
    if (ev.id !== 'meteorShower') return;
    ev.next -= dt;
    if (ev.next > 0) return;
    ev.next = 0.42;
    const a = this.world.arena;
    const size: MeteorSize = this.rng.chance(0.7) ? 'S' : 'M';
    const s = BALANCE.meteors.sizes[size];
    const speed = this.rng.range(...s.speed) * 0.9;
    // Lanes spread across the arena, never two consecutive lanes close to each other.
    let laneX = 0;
    for (let i = 0; i < 6; i++) {
      laneX = this.rng.range(-a.halfWidth + 1, a.halfWidth - 1);
      if (Math.abs(laneX - ev.lastLaneX) > 3.5) break;
    }
    ev.lastLaneX = laneX;
    // Start far enough back along the shower direction to enter from off-screen.
    const pz = this.world.player.pos.z;
    const back = Math.max(26, (pz - a.spawnTop) / ev.dirZ + s.radius + 1);
    this.queueMeteor(size, laneX - ev.dirX * back, pz - ev.dirZ * back, ev.dirX * speed, ev.dirZ * speed, 0.95);
  }
}
