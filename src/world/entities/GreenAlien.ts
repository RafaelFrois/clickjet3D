import * as THREE from 'three';
import { BALANCE } from '../../config/balance';
import { clamp, damp } from '../../core/math';
import type { Rng } from '../../core/Rng';
import type { Models } from '../../render/Models';
import { makeGlowSprite } from '../../render/shared';
import type { Arena } from '../Arena';

export type GreenAlienState = 'wander' | 'telegraph' | 'lunge' | 'exit' | 'formation';

export interface AlienContext {
  time: number;
  flow: number;
  arena: Arena;
  rng: Rng;
  playerX: number;
  playerZ: number;
  playerAlive: boolean;
  lungeChance: number;
  onLunge: (x: number, z: number) => void;
}

export interface FormationOptions {
  vx: number;
  vz: number;
  swayAmp: number;
  swayFreq: number;
}

/** Tilt applied to alien models so their faces read toward the tilted camera (like the sprites). */
export const ALIEN_FACE_PITCH = -0.62;

/**
 * Green octopus alien: floats, wobbles and wanders around the arena. From mid game it
 * may telegraph (shake + red glow) and then lunge in a straight line — always dodgeable.
 */
export class GreenAlien {
  readonly object = new THREE.Group();
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  radius: number = BALANCE.aliens.headRadius;
  state: GreenAlienState = 'wander';
  age = 0;
  private readonly model: THREE.Mesh;
  private readonly warnGlow: THREE.Sprite;
  private scale = 1;
  private speed = 2;
  private lifetime = 14;
  private stateTimer = 0;
  private retarget = 0;
  private targetX = 0;
  private targetZ = 0;
  private lungeX = 0;
  private lungeZ = 0;
  private lungeCooldown = 0;
  private phase = 0;
  private baseX = 0;
  private formation: FormationOptions | null = null;

  constructor(models: Models) {
    this.model = new THREE.Mesh(models.greenAlien, models.mat.greenAlien);
    this.model.rotation.x = ALIEN_FACE_PITCH;
    this.warnGlow = makeGlowSprite(0xff2222, 3.2, 0);
    this.warnGlow.visible = false;
    this.object.add(this.warnGlow, this.model);
    this.object.visible = false;
  }

  spawn(x: number, z: number, speed: number, lifetime: number, scale: number, formation: FormationOptions | null = null): void {
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.baseX = x;
    this.speed = speed;
    this.lifetime = lifetime;
    this.scale = scale;
    this.radius = BALANCE.aliens.headRadius * scale;
    this.age = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.formation = formation;
    this.state = formation ? 'formation' : 'wander';
    this.stateTimer = 0;
    this.retarget = 0;
    this.lungeCooldown = 2.5;
    this.warnGlow.visible = false;
    if (formation) this.vel.set(formation.vx, 0, formation.vz);
    this.object.visible = true;
  }

  update(dt: number, ctx: AlienContext): void {
    this.age += dt;
    this.stateTimer += dt;
    this.lungeCooldown -= dt;
    const cfg = BALANCE.aliens;
    const a = ctx.arena;

    switch (this.state) {
      case 'formation': {
        const f = this.formation as FormationOptions;
        this.baseX += f.vx * dt;
        this.pos.z += f.vz * dt;
        this.pos.x = this.baseX + Math.sin(this.age * f.swayFreq + this.phase * 0.2) * f.swayAmp;
        this.vel.set(f.vx, 0, f.vz);
        break;
      }
      case 'wander': {
        this.retarget -= dt;
        const dx = this.targetX - this.pos.x;
        const dz = this.targetZ - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (this.retarget <= 0 || d < 0.8) this.pickTarget(ctx);
        const outside = Math.abs(this.pos.x) > a.halfWidth || this.pos.z < a.zMin;
        const k = d > 0.001 ? (this.speed * (outside ? 2.2 : 1)) / d : 0;
        this.vel.x = damp(this.vel.x, dx * k, 2.2, dt);
        this.vel.z = damp(this.vel.z, dz * k + ctx.flow * 0.2, 2.2, dt);
        if (this.age > this.lifetime) this.setState('exit');
        break;
      }
      case 'telegraph': {
        this.vel.x = damp(this.vel.x, 0, 8, dt);
        this.vel.z = damp(this.vel.z, 0, 8, dt);
        if (this.stateTimer >= cfg.lungeTelegraph) {
          this.setState('lunge');
          this.vel.set(this.lungeX * cfg.lungeSpeed, 0, this.lungeZ * cfg.lungeSpeed);
        }
        break;
      }
      case 'lunge': {
        if (this.stateTimer > 0.9) {
          this.lungeCooldown = 3.2;
          this.setState('wander');
          this.retarget = 0;
        }
        break;
      }
      case 'exit': {
        const side = this.pos.x >= 0 ? 1 : -1;
        this.vel.x = damp(this.vel.x, side * 1.6, 1.5, dt);
        this.vel.z = damp(this.vel.z, ctx.flow * 1.5 + 1, 1.5, dt);
        break;
      }
    }

    if (this.state !== 'formation') {
      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      if (this.state === 'wander' || this.state === 'telegraph') {
        // Keep wandering aliens inside the arena.
        this.pos.x = clamp(this.pos.x, -a.halfWidth - 2, a.halfWidth + 2);
      }
    }
    this.animate(ctx.time);
  }

  private pickTarget(ctx: AlienContext): void {
    const a = ctx.arena;
    const r = ctx.rng;
    this.retarget = r.range(1.8, 3.4);
    const px = ctx.playerX;
    const pz = ctx.playerZ;
    const dp = Math.hypot(px - this.pos.x, pz - this.pos.z);
    if (ctx.playerAlive && this.lungeCooldown <= 0 && dp > 2.5 && dp < 8.5 && this.pos.z > a.zMin && r.chance(ctx.lungeChance)) {
      this.lungeX = (px - this.pos.x) / dp;
      this.lungeZ = (pz - this.pos.z) / dp;
      this.setState('telegraph');
      ctx.onLunge(this.pos.x, this.pos.z);
      return;
    }
    this.targetX = r.range(-a.halfWidth + 1.5, a.halfWidth - 1.5);
    this.targetZ = r.range(a.zMin + 1, a.zMax - 3);
  }

  private setState(s: GreenAlienState): void {
    this.state = s;
    this.stateTimer = 0;
  }

  private animate(time: number): void {
    const t = time + this.phase;
    let ox = 0;
    const telegraph = this.state === 'telegraph';
    if (telegraph) ox = Math.sin(time * 70) * 0.08;
    this.object.position.set(this.pos.x + ox, 0.3 + Math.sin(t * 2.1) * 0.15, this.pos.z);
    this.model.rotation.y = Math.sin(t * 1.3) * 0.28 + clamp(this.vel.x * 0.06, -0.4, 0.4);
    this.model.rotation.z = clamp(-this.vel.x * 0.05, -0.3, 0.3);
    const squash = 1 + Math.sin(t * 4) * 0.04;
    const stretch = this.state === 'lunge' ? 1.12 : 1;
    const grow = Math.min(1, this.age * 3);
    this.model.scale.set(this.scale * grow / squash, this.scale * grow * squash * stretch, this.scale * grow);
    this.warnGlow.visible = telegraph || this.state === 'lunge';
    if (this.warnGlow.visible) {
      (this.warnGlow.material as THREE.SpriteMaterial).opacity = telegraph ? 0.45 + 0.4 * Math.sin(time * 30) : 0.5;
    }
  }

  hide(): void {
    this.object.visible = false;
  }
}
