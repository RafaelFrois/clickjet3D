import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { generateSong, SYNTH_TRACKS } from '../src/audio/music';
import { BALANCE } from '../src/config/balance';
import type { MoveCommand } from '../src/core/types';
import { computeLayout } from '../src/render/CameraController';
import { Arena } from '../src/world/Arena';
import { Player } from '../src/world/entities/Player';
import { botCommand } from './bot';
import { makeSession, sharedModels } from './helpers';

const DT = 1 / 60;

describe('PlayerController (arcade movement)', () => {
  const arena = new Arena();
  arena.set(computeLayout(16 / 9, 0.8));

  it('reaches full speed almost instantly and diagonals are not faster', () => {
    const p = new Player(sharedModels());
    p.reset(0, 0);
    const cmd: MoveCommand = { kind: 'axis', x: 1, z: -1 };
    for (let i = 0; i < 15; i++) p.move(DT, cmd, arena);
    const speed = Math.hypot(p.vel.x, p.vel.z);
    expect(speed).toBeGreaterThan(BALANCE.player.maxSpeed * 0.95);
    expect(speed).toBeLessThanOrEqual(BALANCE.player.maxSpeed + 1e-6);
  });

  it('flies to a clicked point and stops there (ClickJet)', () => {
    const p = new Player(sharedModels());
    p.reset(0, 0);
    const cmd: MoveCommand = { kind: 'target', x: 4, z: -3 };
    for (let i = 0; i < 180; i++) p.move(DT, cmd, arena);
    expect(p.pos.x).toBeCloseTo(4, 1);
    expect(p.pos.z).toBeCloseTo(-3, 1);
    expect(Math.hypot(p.vel.x, p.vel.z)).toBeLessThan(0.3);
  });

  it('relative touch drag is capped for fairness and bounds are respected', () => {
    const p = new Player(sharedModels());
    p.reset(0, 0);
    p.move(DT, { kind: 'delta', x: 100, z: 0 }, arena);
    expect(p.pos.x).toBeCloseTo(BALANCE.player.maxSpeed * BALANCE.player.touchSpeedMul * DT, 5);
    for (let i = 0; i < 400; i++) p.move(DT, { kind: 'axis', x: 1, z: 1 }, arena);
    expect(p.pos.x).toBeCloseTo(arena.playerMaxX);
    expect(p.pos.z).toBeCloseTo(arena.playerMaxZ);
  });
});

describe('Camera layout adapts to every aspect ratio', () => {
  const ratios: [string, number][] = [
    ['16:9', 16 / 9],
    ['16:10', 16 / 10],
    ['18:9', 18 / 9],
    ['19.5:9 landscape', 19.5 / 9],
    ['19.5:9 portrait', 9 / 19.5],
    ['21:9', 21 / 9],
    ['32:9 ultrawide', 32 / 9],
    ['4:3 tablet', 4 / 3],
    ['3:4 tablet portrait', 3 / 4],
  ];
  for (const [name, aspect] of ratios) {
    it(`${name}: whole arena visible below the HUD, spawns off-screen`, () => {
      const hudNdc = 0.8;
      const L = computeLayout(aspect, hudNdc);
      const cam = new THREE.PerspectiveCamera(L.fov, aspect, 0.1, 2000);
      const pitch = (56 * Math.PI) / 180;
      cam.position.set(0, Math.sin(pitch) * L.distance, L.targetZ + Math.cos(pitch) * L.distance);
      cam.lookAt(0, 0, L.targetZ);
      cam.updateMatrixWorld(true);
      const ndc = (x: number, z: number) => new THREE.Vector3(x, 0, z).project(cam);
      for (const [x, z] of [
        [-L.halfWidth, L.zMax],
        [L.halfWidth, L.zMax],
        [-L.halfWidth, -10],
        [L.halfWidth, -10],
      ]) {
        const v = ndc(x, z);
        expect(Math.abs(v.x)).toBeLessThanOrEqual(0.96);
        expect(v.y).toBeGreaterThanOrEqual(-0.95);
        expect(v.y).toBeLessThanOrEqual(hudNdc + 0.01);
      }
      expect(ndc(0, L.zMax).y).toBeLessThanOrEqual(-0.77); // rocket area at the bottom
      expect(L.spawnTop).toBeLessThan(L.zMin - 2.9);
      expect(ndc(0, L.spawnBottom).y).toBeLessThan(-1);
      expect(L.halfWidth).toBeGreaterThanOrEqual(5.5);
    });
  }
});

describe('Soundtrack', () => {
  it('has several distinct songs with valid notes', () => {
    expect(SYNTH_TRACKS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(SYNTH_TRACKS.map((t) => t.name)).size).toBe(SYNTH_TRACKS.length);
    for (const def of SYNTH_TRACKS) {
      const song = generateSong(def);
      expect(song.byStep.length).toBe(256);
      const notes = song.byStep.flat().filter((e) => e.voice === 'lead' || e.voice === 'bass' || e.voice === 'arp');
      expect(notes.length).toBeGreaterThan(100);
      for (const n of notes) {
        expect(n.midi).toBeGreaterThanOrEqual(28);
        expect(n.midi).toBeLessThanOrEqual(110);
      }
    }
  });
});

/* ------------------------------------------------------------------------- */
/*  Fairness: headless simulations of full runs                               */
/* ------------------------------------------------------------------------- */

describe('Fairness simulation', () => {
  it('never spawns hazards on top of the player; meteors enter from off-screen', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const { world, session } = makeSession(seed);
      world.invulnerable = true;
      session.spawner.recording = true;
      session.start();
      const cmd: MoveCommand = { kind: 'none', x: 0, z: 0 };
      for (let t = 0; t < 150; t += DT) session.step(DT, botCommand(world, cmd));
      const a = world.arena;
      const recs = session.spawner.records;
      expect(recs.length).toBeGreaterThan(40);
      for (const r of recs) {
        const d = Math.hypot(r.x - r.playerX, r.z - r.playerZ);
        if (r.kind === 'rock' || r.kind === 'alien') expect(d).toBeGreaterThanOrEqual(BALANCE.fairness.safeRadius + r.radius - 1e-6);
        if (r.kind === 'chaser') expect(d).toBeGreaterThanOrEqual(BALANCE.chaser.minSpawnDistance - 1e-6);
        if (r.kind === 'meteor') {
          const offScreen = Math.abs(r.x) > a.visibleHalfWidthAt(r.z) || r.z < a.zMin || r.z > a.zMax;
          expect(offScreen).toBe(true);
        }
      }
      // Rare events happen, but rarely.
      expect(recs.some((r) => r.kind === 'powerup')).toBe(true);
    }
  });

  it('a stationary player is never hit during the opening seconds', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { session } = makeSession(seed);
      session.start();
      const idle: MoveCommand = { kind: 'none', x: 0, z: 0 };
      for (let t = 0; t < 5; t += DT) session.step(DT, idle);
      expect(session.alive).toBe(true);
    }
  });

  it('a simple dodging bot survives a long time (no impossible situations early on)', () => {
    const survival: number[] = [];
    const causes: string[] = [];
    for (let seed = 1; seed <= 16; seed++) {
      const { world, session } = makeSession(seed);
      session.start();
      const cmd: MoveCommand = { kind: 'none', x: 0, z: 0 };
      while (session.alive && session.time < 90) session.step(DT, botCommand(world, cmd));
      survival.push(session.time);
      causes.push(`${session.time.toFixed(0)}:${session.deathCause ?? 'alive'}`);
    }
    survival.sort((a, b) => a - b);
    const median = survival[Math.floor(survival.length / 2)];
    console.log('bot survival (s):', causes.join(' '));
    // The bot is deliberately naive (potential field); humans do far better. This guards
    // against regressions that would create early impossible situations.
    expect(survival[0]).toBeGreaterThan(8);
    expect(median).toBeGreaterThan(15);
  });

  it('the chaser can always be escaped at maximum difficulty (circling at full speed)', () => {
    for (const radius of [4, 4.5, 5]) {
      const { world } = makeSession(1);
      world.chaseParams = {
        speed: BALANCE.chaser.speed[1],
        accel: BALANCE.chaser.accel[1],
        lead: BALANCE.chaser.lead[1],
        surge: true,
      };
      const cx = 0;
      const cz = -1.5;
      world.player.reset(cx + radius, cz);
      world.chaser.spawn(-12, -12);
      const cmd: MoveCommand = { kind: 'axis', x: 0, z: 0 };
      let minDist = Infinity;
      for (let t = 0; t < 60; t += DT) {
        const p = world.player.pos;
        const dx = p.x - cx;
        const dz = p.z - cz;
        const r = Math.hypot(dx, dz) || 1;
        // tangent + radial correction to hold the circle
        cmd.x = -dz / r + ((radius - r) * dx) / r / 2;
        cmd.z = dx / r + ((radius - r) * dz) / r / 2;
        world.player.move(DT, cmd, world.arena);
        world.update(DT);
        minDist = Math.min(minDist, Math.hypot(p.x - world.chaser.pos.x, p.z - world.chaser.pos.z));
        expect(world.checkCollisions().hazard).toBeNull();
      }
      expect(minDist).toBeGreaterThan(BALANCE.chaser.radius + BALANCE.player.colliderRadius + 0.3);
    }
  });

  it('power-ups always cross the reachable area', () => {
    const { world, session } = makeSession(11);
    session.start();
    const a = world.arena;
    for (let i = 0; i < 40; i++) {
      session.spawner.spawnPowerUp(i % 5 === 0);
      const m = world.powerUps.active[world.powerUps.active.length - 1];
      let inside = 0;
      for (let t = 0; t < 12; t += 0.05) {
        const x = m.pos.x + m.vel.x * t;
        const z = m.pos.z + m.vel.z * t;
        if (x > a.playerMinX && x < a.playerMaxX && z > a.playerMinZ && z < a.playerMaxZ) inside += 0.05;
      }
      expect(inside).toBeGreaterThan(1.5); // at least 1.5 s inside the reachable area
      world.releasePowerUp(m);
    }
  });

  it('rocks never close a horizontal band completely', () => {
    const { world, session } = makeSession(5);
    session.start();
    session.difficulty.update(400);
    const a = world.arena;
    // Build a near-wall of rocks at the top spawn line.
    const z = a.spawnTop - 1;
    for (let x = -a.halfWidth + 1; x < a.halfWidth - 4; x += 2) {
      const r = world.rocks.acquire()!;
      r.spawn(x, z, 0, 0, 1.2, 0);
    }
    for (let i = 0; i < 50; i++) session.spawner.spawnRock();
    for (const r of world.rocks.active) {
      if (Math.abs(r.pos.z - z) < BALANCE.rocks.bandHeight) continue;
    }
    expect(session.spawner.largestGapWith(9999, z, 0)).toBeGreaterThanOrEqual(BALANCE.rocks.minGap - 1e-6);
  });
});
