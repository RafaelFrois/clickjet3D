import * as THREE from 'three';
import { BALANCE } from '../../config/balance';
import { hslToHex } from '../../core/math';
import type { CoinKind } from '../../core/types';
import type { Models } from '../../render/Models';
import type { ParticleEmitter } from '../../render/ParticleSystem';
import { makeGlowSprite } from '../../render/shared';

/** Spinning low-poly coin. Yellow = +5 (normal), rainbow = +10 (special, glowing). */
export class Coin {
  readonly object = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly radius: number = BALANCE.coins.radius;
  age = 0;
  private readonly mesh: THREE.Mesh;
  private readonly glow: THREE.Sprite | null;
  private phase = Math.random() * Math.PI * 2;
  private sparkleAcc = 0;

  constructor(
    readonly kind: CoinKind,
    models: Models,
  ) {
    const rainbow = kind === 'rainbow';
    this.mesh = new THREE.Mesh(rainbow ? models.coinRainbow : models.coinYellow, rainbow ? models.mat.coinRainbow : models.mat.coinYellow);
    this.object.add(this.mesh);
    this.glow = makeGlowSprite(rainbow ? 0xffffff : 0xffc933, rainbow ? 2.1 : 1.3, rainbow ? 0.7 : 0.35);
    this.object.add(this.glow);
    this.object.visible = false;
  }

  spawn(x: number, z: number, vx: number, vz: number): void {
    this.pos.set(x, 0, z);
    this.vel.set(vx, 0, vz);
    this.age = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.object.visible = true;
    this.object.scale.setScalar(0.01);
  }

  setGlowEnabled(on: boolean): void {
    if (this.glow) this.glow.visible = on;
  }

  update(dt: number, time: number, particles: ParticleEmitter): void {
    this.age += dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const s = Math.min(1, this.age * 4);
    this.object.scale.setScalar(s);
    this.object.position.set(this.pos.x, 0.35 + Math.sin(time * 2.4 + this.phase) * 0.1, this.pos.z);
    if (this.kind === 'rainbow') {
      this.mesh.rotation.y = time * 4.2 + this.phase;
      this.mesh.rotation.z = time * 2.0;
      if (this.glow) {
        (this.glow.material as THREE.SpriteMaterial).color.setHex(hslToHex(time * 0.5 + this.phase, 1, 0.7));
        this.glow.scale.setScalar(2 + Math.sin(time * 6 + this.phase) * 0.25);
      }
      this.sparkleAcc += 5 * particles.density * dt;
      while (this.sparkleAcc >= 1) {
        this.sparkleAcc -= 1;
        particles.emit(
          this.pos.x + (Math.random() - 0.5) * 0.9,
          this.object.position.y + (Math.random() - 0.5) * 0.9,
          this.pos.z + (Math.random() - 0.5) * 0.5,
          0,
          0.6,
          0,
          0.5,
          0.22,
          0,
          hslToHex(Math.random(), 1, 0.7),
        );
      }
    } else {
      this.mesh.rotation.y = time * 3 + this.phase;
    }
  }

  hide(): void {
    this.object.visible = false;
  }
}
