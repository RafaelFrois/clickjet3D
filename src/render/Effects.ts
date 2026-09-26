import * as THREE from 'three';
import { hslToHex } from '../core/math';
import { Pool } from '../core/Pool';
import type { Models } from './Models';
import type { ParticleSystem } from './ParticleSystem';
import { PALETTE } from './palette';
import { makeGlowSprite } from './shared';

interface Debris {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  size: number;
}

/**
 * One-shot visual feedback: rocket explosion (flash + fragments + fire), coin
 * collection sparkles, power-up bursts and a shockwave ring. All pooled.
 */
export class Effects {
  readonly group = new THREE.Group();
  private readonly debris: Pool<Debris>;
  private readonly flashes: Pool<Flash>;
  private readonly ring: THREE.Mesh;
  private ringLife = 0;

  constructor(
    models: Models,
    private readonly particles: ParticleSystem,
  ) {
    let di = 0;
    this.debris = new Pool<Debris>(
      () => {
        const mesh = new THREE.Mesh(models.debris[di++ % models.debris.length], models.mat.debris);
        mesh.visible = false;
        this.group.add(mesh);
        return { mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, maxLife: 1 };
      },
      14,
      20,
    );
    this.flashes = new Pool<Flash>(
      () => {
        const sprite = makeGlowSprite(0xffffff, 1, 1);
        sprite.visible = false;
        this.group.add(sprite);
        return { sprite, life: 0, maxLife: 0.3, size: 4 };
      },
      4,
      8,
    );
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
    );
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  flash(x: number, y: number, z: number, color: number, size: number, life = 0.3): void {
    const f = this.flashes.acquire();
    if (!f) return;
    f.sprite.position.set(x, y, z);
    (f.sprite.material as THREE.SpriteMaterial).color.setHex(color);
    f.life = f.maxLife = life;
    f.size = size;
    f.sprite.visible = true;
  }

  explode(x: number, y: number, z: number): void {
    this.flash(x, y + 0.2, z, 0xfff0c0, 7, 0.35);
    this.flash(x, y, z, PALETTE.flameOuter, 4.5, 0.6);
    const p = this.particles;
    p.burst(x, y, z, 70, 11, 0.9, 0.7, [PALETTE.flameCore, PALETTE.flameMid, PALETTE.flameOuter, 0xffffff], 0.9);
    p.burst(x, y, z, 24, 5, 1.3, 0.9, [PALETTE.flameOuter, 0xff3a10], 0.4);
    for (let i = 0; i < 12; i++) {
      const d = this.debris.acquire();
      if (!d) break;
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 6;
      d.mesh.position.set(x, y, z);
      d.vel.set(Math.cos(a) * s, (Math.random() - 0.2) * 5, Math.sin(a) * s);
      d.spin.set(Math.random() * 12 - 6, Math.random() * 12 - 6, Math.random() * 12 - 6);
      d.life = d.maxLife = 1.2 + Math.random() * 0.8;
      d.mesh.scale.setScalar(0.7 + Math.random() * 0.9);
      d.mesh.visible = true;
    }
    this.ring.position.set(x, 0.05, z);
    this.ring.visible = true;
    this.ringLife = 0.5;
  }

  coinBurst(rainbow: boolean, x: number, y: number, z: number): void {
    if (rainbow) {
      const colors = [0, 1, 2, 3, 4, 5].map((i) => hslToHex(i / 6, 1, 0.62));
      this.particles.burst(x, y, z, 22, 5, 0.6, 0.35, colors, 0.8);
      this.flash(x, y, z, 0xffffff, 2.6, 0.25);
    } else {
      this.particles.burst(x, y, z, 12, 4, 0.45, 0.3, [PALETTE.coinGold, PALETTE.coinLight, 0xffffff], 0.8);
      this.flash(x, y, z, PALETTE.coinGold, 1.6, 0.18);
    }
  }

  powerUpBurst(x: number, y: number, z: number): void {
    const colors = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => hslToHex(i / 8, 1, 0.62));
    this.particles.burst(x, y, z, 50, 9, 0.9, 0.5, colors, 0.8);
    this.flash(x, y, z, 0xffffff, 5, 0.35);
  }

  clear(): void {
    this.debris.releaseAll((d) => (d.mesh.visible = false));
    this.flashes.releaseAll((f) => (f.sprite.visible = false));
    this.ring.visible = false;
  }

  update(dt: number): void {
    const debris = this.debris.active;
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.life -= dt;
      if (d.life <= 0) {
        d.mesh.visible = false;
        this.debris.release(d);
        continue;
      }
      d.vel.multiplyScalar(Math.exp(-1.6 * dt));
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      const t = d.life / d.maxLife;
      if (t < 0.3) d.mesh.scale.multiplyScalar(Math.exp(-6 * dt));
    }
    const flashes = this.flashes.active;
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i];
      f.life -= dt;
      if (f.life <= 0) {
        f.sprite.visible = false;
        this.flashes.release(f);
        continue;
      }
      const t = 1 - f.life / f.maxLife;
      f.sprite.scale.setScalar(f.size * (0.4 + t * 0.9));
      (f.sprite.material as THREE.SpriteMaterial).opacity = 1 - t;
    }
    if (this.ring.visible) {
      this.ringLife -= dt;
      const t = 1 - this.ringLife / 0.5;
      this.ring.scale.setScalar(0.5 + t * 6);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 * (1 - t));
      if (this.ringLife <= 0) this.ring.visible = false;
    }
  }
}
