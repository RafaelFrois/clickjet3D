import * as THREE from 'three';
import type { MeteorSize } from '../../config/balance';
import { hslToHex } from '../../core/math';
import type { Models } from '../../render/Models';
import type { ParticleEmitter } from '../../render/ParticleSystem';
import { PALETTE } from '../../render/palette';
import { makeGlowSprite } from '../../render/shared';

const EMBER_COLORS = [PALETTE.flameCore, PALETTE.flameMid, PALETTE.flameOuter] as const;

/**
 * Flaming meteor (hazard) or colored meteor (power-up). Flies in a straight line with
 * a fire tail pointing away from its motion; the core tumbles independently.
 */
export class Meteor {
  readonly object = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  radius = 0.5;
  size: MeteorSize = 'M';
  big = false;
  age = 0;
  /** Set once a "whoosh" sound has been played for this meteor. */
  whooshed = false;
  private readonly core: THREE.Mesh;
  private readonly tail: THREE.Mesh;
  private readonly glow: THREE.Sprite;
  private readonly spin = new THREE.Vector3();
  private emitAcc = 0;

  constructor(
    private readonly models: Models,
    readonly powerUp: boolean,
  ) {
    this.core = new THREE.Mesh(powerUp ? models.crystal : models.meteorCore[0], powerUp ? models.mat.crystal : models.mat.meteorCore);
    this.tail = new THREE.Mesh(models.tail, powerUp ? models.mat.rainbowTail : models.mat.fireTail);
    this.glow = makeGlowSprite(powerUp ? 0xffffff : PALETTE.flameMid, 2, powerUp ? 0.9 : 0.75);
    this.object.add(this.tail, this.core, this.glow);
    this.object.visible = false;
  }

  spawn(x: number, z: number, vx: number, vz: number, radius: number, size: MeteorSize, big = false): void {
    this.pos.set(x, 0, z);
    this.vel.set(vx, 0, vz);
    this.radius = radius;
    this.size = size;
    this.big = big;
    this.age = 0;
    this.whooshed = false;
    if (!this.powerUp) this.core.geometry = this.models.meteorCore[Math.floor(Math.random() * this.models.meteorCore.length)];
    this.core.scale.setScalar(radius);
    this.spin.set(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2);
    this.object.rotation.set(0, Math.atan2(-vx, -vz), 0);
    this.object.visible = true;
  }

  setGlowEnabled(on: boolean): void {
    this.glow.visible = on;
  }

  update(dt: number, time: number, particles: ParticleEmitter): void {
    this.age += dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.object.position.set(this.pos.x, this.powerUp ? 0.3 : 0, this.pos.z);
    this.core.rotation.x += this.spin.x * dt;
    this.core.rotation.y += this.spin.y * dt;
    this.core.rotation.z += this.spin.z * dt;
    const r = this.radius;
    const flick = 1 + Math.sin(time * 37 + this.pos.x) * 0.08;
    this.tail.scale.set(r * 1.2, r * 1.2, r * (this.powerUp ? 3.4 : 4.4) * flick);
    this.glow.scale.setScalar(r * (this.powerUp ? 5 : 4.2) * (0.95 + Math.sin(time * 13) * 0.05));
    if (this.powerUp) (this.glow.material as THREE.SpriteMaterial).color.setHex(hslToHex(time * 0.8, 1, 0.7));

    // Embers / sparkles trailing behind
    this.emitAcc += (this.powerUp ? 26 : 34) * particles.density * dt;
    const speed = Math.hypot(this.vel.x, this.vel.z) || 1;
    const bx = -this.vel.x / speed;
    const bz = -this.vel.z / speed;
    while (this.emitAcc >= 1) {
      this.emitAcc -= 1;
      const color = this.powerUp ? hslToHex(Math.random(), 1, 0.65) : EMBER_COLORS[(Math.random() * 3) | 0];
      particles.emit(
        this.pos.x + bx * r * 0.8 + (Math.random() - 0.5) * r,
        this.object.position.y + (Math.random() - 0.5) * r,
        this.pos.z + bz * r * 0.8 + (Math.random() - 0.5) * r,
        bx * 2 + (Math.random() - 0.5) * 1.5,
        (Math.random() - 0.5) * 1.2,
        bz * 2 + (Math.random() - 0.5) * 1.5,
        0.35 + Math.random() * 0.35,
        r * 0.75,
        0.02,
        color,
        0.85,
        1,
      );
    }
  }

  hide(): void {
    this.object.visible = false;
  }
}
