import * as THREE from 'three';
import { BALANCE } from '../../config/balance';
import { clamp, damp } from '../../core/math';
import type { Models } from '../../render/Models';
import type { ParticleEmitter } from '../../render/ParticleSystem';
import { PALETTE } from '../../render/palette';
import { makeGlowSprite } from '../../render/shared';
import { ALIEN_FACE_PITCH } from './GreenAlien';

export interface ChaseParams {
  speed: number;
  accel: number;
  lead: number;
  /** Late game: short, telegraphed surges of speed (still slower than the player). */
  surge: boolean;
}

/**
 * The purple chaser. Enters from off-screen and hunts the player with simple steering
 * (seek a predicted position with limited acceleration). Always slower than the player
 * and unable to turn instantly, so juking and outrunning it is always possible.
 */
export class PurpleAlien {
  readonly object = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly radius: number = BALANCE.chaser.radius;
  active = false;
  hunting = false;
  age = 0;
  surging = false;
  private readonly model: THREE.Mesh;
  private readonly glow: THREE.Sprite;
  private readonly swayUniforms: { uSwaySpeed: { value: number } };
  private surgeTimer = 6;
  private surgeLeft = 0;
  private wispAcc = 0;

  constructor(models: Models) {
    this.model = new THREE.Mesh(models.purpleAlien, models.mat.purpleAlien);
    this.model.add(new THREE.Mesh(models.purpleEyes, models.mat.purpleEyes));
    this.model.rotation.x = ALIEN_FACE_PITCH;
    this.glow = makeGlowSprite(PALETTE.alienPurple, 3, 0.6);
    this.object.add(this.glow, this.model);
    this.object.visible = false;
    this.swayUniforms = models.mat.purpleAlien.userData.sway;
  }

  spawn(x: number, z: number): void {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.age = 0;
    this.active = true;
    this.hunting = true;
    this.surging = false;
    this.surgeTimer = 7;
    this.surgeLeft = 0;
    this.object.visible = true;
  }

  despawn(): void {
    this.active = false;
    this.hunting = false;
    this.object.visible = false;
  }

  /** 0 when far away, 1 when touching — drives the tension audio and effects. */
  proximity(px: number, pz: number): number {
    if (!this.active) return 0;
    const d = Math.hypot(px - this.pos.x, pz - this.pos.z);
    return clamp(1 - (d - 1) / 11, 0, 1);
  }

  update(dt: number, time: number, px: number, pz: number, pvx: number, pvz: number, params: ChaseParams, particles: ParticleEmitter): void {
    if (!this.active) return;
    this.age += dt;

    if (this.hunting) {
      // Surge (late game): +15% speed for 1.2s every ~8s, telegraphed by the glow flaring.
      let speedMul = 1;
      if (params.surge) {
        this.surgeTimer -= dt;
        if (this.surgeLeft > 0) {
          this.surgeLeft -= dt;
          speedMul = 1.15;
        } else if (this.surgeTimer <= 0) {
          this.surgeLeft = 1.2;
          this.surgeTimer = 7 + Math.random() * 3;
        }
      }
      this.surging = this.surgeLeft > 0;
      const ramp = Math.min(1, 0.45 + (this.age / BALANCE.chaser.entryRamp) * 0.55);
      const tx = px + pvx * params.lead;
      const tz = pz + pvz * params.lead;
      const dx = tx - this.pos.x;
      const dz = tz - this.pos.z;
      const d = Math.hypot(dx, dz) || 1;
      const speed = params.speed * ramp * speedMul;
      let sx = (dx / d) * speed - this.vel.x;
      let sz = (dz / d) * speed - this.vel.z;
      const s = Math.hypot(sx, sz);
      const maxDv = params.accel * dt;
      if (s > maxDv) {
        sx *= maxDv / s;
        sz *= maxDv / s;
      }
      this.vel.x += sx;
      this.vel.z += sz;
    } else {
      this.vel.x = damp(this.vel.x, 0, 2, dt);
      this.vel.z = damp(this.vel.z, 0, 2, dt);
    }
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // Visuals
    const prox = this.proximity(px, pz);
    this.object.position.set(this.pos.x, 0.35 + Math.sin(time * 3.1) * 0.12, this.pos.z);
    const look = Math.atan2(px - this.pos.x, pz - this.pos.z);
    this.model.rotation.y = damp(this.model.rotation.y, clamp(look, -1.1, 1.1), 6, dt);
    this.model.rotation.z = clamp(-this.vel.x * 0.04, -0.3, 0.3);
    const grow = Math.min(1, this.age * 2.5);
    const pulse = 1 + Math.sin(time * (6 + prox * 10)) * 0.05;
    this.model.scale.set(grow * pulse, grow / pulse, grow);
    this.glow.scale.setScalar((2.6 + prox * 1.4 + (this.surging ? 1.2 : 0)) * pulse);
    (this.glow.material as THREE.SpriteMaterial).opacity = 0.45 + prox * 0.35 + (this.surging ? 0.25 : 0);
    this.swayUniforms.uSwaySpeed.value = 8 + prox * 9 + (this.surging ? 6 : 0);

    this.wispAcc += 14 * particles.density * dt;
    while (this.wispAcc >= 1) {
      this.wispAcc -= 1;
      particles.emit(
        this.pos.x + (Math.random() - 0.5) * 0.8,
        this.object.position.y - 0.3 + (Math.random() - 0.5) * 0.4,
        this.pos.z + (Math.random() - 0.5) * 0.5,
        -this.vel.x * 0.25 + (Math.random() - 0.5) * 0.6,
        -0.2,
        -this.vel.z * 0.25 + (Math.random() - 0.5) * 0.6,
        0.7,
        0.35,
        0.05,
        Math.random() < 0.5 ? PALETTE.alienPurple : PALETTE.alienPurpleEye,
        0.6,
        1,
      );
    }
  }
}
