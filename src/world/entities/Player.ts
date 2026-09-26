import * as THREE from 'three';
import { BALANCE } from '../../config/balance';
import { clamp, damp, hslToHex } from '../../core/math';
import type { MoveCommand } from '../../core/types';
import type { Models } from '../../render/Models';
import { makeAuraMaterial } from '../../render/Models';
import type { ParticleEmitter } from '../../render/ParticleSystem';
import { PALETTE } from '../../render/palette';
import { makeGlowSprite } from '../../render/shared';
import type { Arena } from '../Arena';

export interface PlayerColliders {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  r: number;
}

const MODEL_SCALE = 0.95;
const NOZZLE_Z = 0.72 * MODEL_SCALE;

/**
 * PlayerController + rocket visuals. Movement is arcade: velocity snaps toward the
 * desired velocity with a fast exponential response (precise, no fighting inertia).
 */
export class Player {
  readonly object = new THREE.Group();
  readonly pos = new THREE.Vector3(0, 0, BALANCE.player.startZ);
  readonly vel = new THREE.Vector3();
  alive = true;
  powered = false;
  /** 0..1 visual thrust (flame size, trail rate). */
  thrust = 0.4;

  private readonly body = new THREE.Group();
  private readonly flame: THREE.Mesh;
  private readonly flameCore: THREE.Mesh;
  private readonly flameGlow: THREE.Sprite;
  private readonly aura: THREE.Mesh;
  private readonly auraMat: THREE.ShaderMaterial;
  private readonly auraGlow: THREE.Sprite;
  private yaw = 0;
  private bank = 0;
  private pitch = 0;
  private emitAcc = 0;
  private rainbowAcc = 0;
  private hue = 0;
  private readonly auraColor = new THREE.Color();

  constructor(models: Models) {
    const hull = new THREE.Mesh(models.rocket, models.mat.rocket);
    const cockpit = new THREE.Mesh(models.rocketCockpit, models.mat.cockpit);
    this.flame = new THREE.Mesh(models.flame, models.mat.flame);
    this.flameCore = new THREE.Mesh(models.flameCore, models.mat.flame);
    this.flame.position.z = NOZZLE_Z / MODEL_SCALE;
    this.flameCore.position.z = NOZZLE_Z / MODEL_SCALE;
    this.flameGlow = makeGlowSprite(PALETTE.flameMid, 1.1, 0.85);
    this.flameGlow.position.set(0, 0, NOZZLE_Z / MODEL_SCALE + 0.15);

    this.body.add(hull, cockpit, this.flame, this.flameCore, this.flameGlow);
    this.body.scale.setScalar(MODEL_SCALE);
    this.object.add(this.body);

    this.auraMat = makeAuraMaterial(0xffffff);
    this.aura = new THREE.Mesh(models.aura, this.auraMat);
    this.aura.scale.setScalar(1.15);
    this.aura.visible = false;
    this.auraGlow = makeGlowSprite(0xffffff, 3.4, 0.55);
    this.auraGlow.visible = false;
    this.object.add(this.aura, this.auraGlow);
  }

  reset(x: number, z: number): void {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.alive = true;
    this.powered = false;
    this.thrust = 0.4;
    this.yaw = this.bank = this.pitch = 0;
    this.object.visible = true;
    this.syncTransform(0);
  }

  /** Applies a device-agnostic move command for one simulation step. */
  move(dt: number, cmd: MoveCommand, arena: Arena): void {
    const cfg = BALANCE.player;
    const max = cfg.maxSpeed;
    if (cmd.kind === 'delta') {
      // Relative drag: follow the finger 1:1, capped for fairness.
      const cap = max * cfg.touchSpeedMul * dt;
      let dx = cmd.x;
      let dz = cmd.z;
      const len = Math.hypot(dx, dz);
      if (len > cap) {
        dx *= cap / len;
        dz *= cap / len;
      }
      this.pos.x += dx;
      this.pos.z += dz;
      if (dt > 0) {
        this.vel.x = damp(this.vel.x, dx / dt, 20, dt);
        this.vel.z = damp(this.vel.z, dz / dt, 20, dt);
      }
    } else {
      let tx = 0;
      let tz = 0;
      if (cmd.kind === 'axis') {
        const len = Math.hypot(cmd.x, cmd.z);
        const k = len > 1 ? 1 / len : 1;
        tx = cmd.x * k * max;
        tz = cmd.z * k * max;
      } else if (cmd.kind === 'target') {
        const dx = cmd.x - this.pos.x;
        const dz = cmd.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.04) {
          const speed = Math.min(max, d * cfg.arriveGain);
          tx = (dx / d) * speed;
          tz = (dz / d) * speed;
        }
      }
      const a = 1 - Math.exp(-cfg.response * dt);
      this.vel.x += (tx - this.vel.x) * a;
      this.vel.z += (tz - this.vel.z) * a;
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
    }

    // Arena bounds: stop at the edge (no bouncing, no damage).
    if (this.pos.x < arena.playerMinX) {
      this.pos.x = arena.playerMinX;
      if (this.vel.x < 0) this.vel.x = 0;
    } else if (this.pos.x > arena.playerMaxX) {
      this.pos.x = arena.playerMaxX;
      if (this.vel.x > 0) this.vel.x = 0;
    }
    if (this.pos.z < arena.playerMinZ) {
      this.pos.z = arena.playerMinZ;
      if (this.vel.z < 0) this.vel.z = 0;
    } else if (this.pos.z > arena.playerMaxZ) {
      this.pos.z = arena.playerMaxZ;
      if (this.vel.z > 0) this.vel.z = 0;
    }
  }

  /** Nose and tail collision circles, rotated with the rocket's heading. */
  getColliders(out: PlayerColliders): PlayerColliders {
    const off = BALANCE.player.colliderOffset;
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    out.ax = this.pos.x + fx * off;
    out.az = this.pos.z + fz * off;
    out.bx = this.pos.x - fx * off;
    out.bz = this.pos.z - fz * off;
    out.r = BALANCE.player.colliderRadius;
    return out;
  }

  /** Visual orientation, thruster, aura and trail (called once per rendered frame). */
  updateVisuals(dt: number, time: number, particles: ParticleEmitter): void {
    if (!this.object.visible) return;
    const max = BALANCE.player.maxSpeed;
    const speed01 = clamp(Math.hypot(this.vel.x, this.vel.z) / max, 0, 1);
    const lateral = clamp(this.vel.x / max, -1, 1);
    const forward = clamp(-this.vel.z / max, -1, 1);

    this.yaw = damp(this.yaw, -lateral * 0.5, 10, dt);
    this.bank = damp(this.bank, -lateral * 0.65, 9, dt);
    this.pitch = damp(this.pitch, -forward * 0.22, 8, dt);

    const thrustTarget = 0.35 + 0.3 * speed01 + 0.4 * Math.max(0, forward) - 0.2 * Math.max(0, -forward);
    this.thrust = damp(this.thrust, clamp(thrustTarget, 0.15, 1), 10, dt);
    this.syncTransform(time);
    this.animateFlame(time, particles, dt);
    this.animateAura(dt, time, particles);
  }

  /** Menu showcase: gentle float and slow turn. */
  updateMenu(dt: number, time: number, particles: ParticleEmitter): void {
    this.object.visible = true;
    this.yaw = damp(this.yaw, Math.sin(time * 0.35) * 0.55, 2, dt);
    this.bank = damp(this.bank, Math.sin(time * 0.7) * 0.18, 2, dt);
    this.pitch = damp(this.pitch, Math.sin(time * 0.5) * 0.08, 2, dt);
    this.thrust = damp(this.thrust, 0.45 + Math.sin(time * 1.7) * 0.1, 4, dt);
    this.syncTransform(time, 0.16);
    this.animateFlame(time, particles, dt);
    this.animateAura(dt, time, particles);
  }

  private syncTransform(time: number, bob = 0.06): void {
    this.object.position.set(this.pos.x, Math.sin(time * 2.2) * bob, this.pos.z);
    this.body.rotation.set(this.pitch, this.yaw, this.bank, 'YXZ');
  }

  private animateFlame(time: number, particles: ParticleEmitter, dt: number): void {
    const flick = 0.85 + Math.sin(time * 47) * 0.08 + Math.sin(time * 23.3) * 0.07;
    const len = (0.3 + this.thrust * 1.25) * flick;
    const w = 0.85 + this.thrust * 0.35;
    this.flame.scale.set(w, w, len);
    this.flameCore.scale.set(w, w, len * 0.62);
    this.flameGlow.scale.setScalar(0.8 + this.thrust * 0.8);
    (this.flameGlow.material as THREE.SpriteMaterial).opacity = 0.5 + this.thrust * 0.45;

    // Trail particles, emitted from the nozzle in world space.
    const rate = (18 + this.thrust * 55) * particles.density;
    this.emitAcc += rate * dt;
    if (this.emitAcc < 1) return;
    const sx = Math.sin(this.yaw);
    const cz = Math.cos(this.yaw);
    const nx = this.object.position.x + sx * (NOZZLE_Z + 0.15);
    const ny = this.object.position.y;
    const nz = this.object.position.z + cz * (NOZZLE_Z + 0.15);
    const back = 3 + this.thrust * 5;
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1;
      const c = Math.random() < 0.35 ? PALETTE.flameCore : Math.random() < 0.6 ? PALETTE.flameMid : PALETTE.flameOuter;
      particles.emit(
        nx + (Math.random() - 0.5) * 0.12,
        ny + (Math.random() - 0.5) * 0.12,
        nz,
        sx * back + (Math.random() - 0.5) * 1.2 + this.vel.x * 0.2,
        (Math.random() - 0.5) * 1.0,
        cz * back + (Math.random() - 0.5) * 1.2 + this.vel.z * 0.2,
        0.22 + Math.random() * 0.18,
        0.3 + this.thrust * 0.25,
        0.02,
        c,
        0.9,
        1.5,
      );
    }
  }

  private animateAura(dt: number, time: number, particles: ParticleEmitter): void {
    this.aura.visible = this.powered;
    this.auraGlow.visible = this.powered;
    if (!this.powered) return;
    this.hue = (this.hue + dt * 0.6) % 1;
    this.auraColor.setHex(hslToHex(this.hue, 1, 0.6));
    this.auraMat.uniforms.uColor.value.copy(this.auraColor);
    const pulse = 1.1 + Math.sin(time * 9) * 0.07;
    this.aura.scale.setScalar(pulse);
    (this.auraGlow.material as THREE.SpriteMaterial).color.copy(this.auraColor);

    // Rainbow trail
    this.rainbowAcc += 40 * particles.density * dt;
    const sx = Math.sin(this.yaw);
    const cz = Math.cos(this.yaw);
    while (this.rainbowAcc >= 1) {
      this.rainbowAcc -= 1;
      const h = (this.hue + Math.random() * 0.3) % 1;
      particles.emit(
        this.pos.x + sx * 0.6 + (Math.random() - 0.5) * 0.9,
        (Math.random() - 0.3) * 0.5,
        this.pos.z + cz * 0.6 + (Math.random() - 0.5) * 0.4,
        sx * 3 + (Math.random() - 0.5),
        Math.random() * 0.5,
        cz * 3 + (Math.random() - 0.5),
        0.6 + Math.random() * 0.4,
        0.32,
        0.05,
        hslToHex(h, 1, 0.62),
        0.9,
        1.2,
      );
    }
  }
}
