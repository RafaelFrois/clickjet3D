import * as THREE from 'three';
import type { Models } from '../../render/Models';

/** Low-poly tumbling asteroid rock. Touching it = death. */
export class Rock {
  readonly object: THREE.Mesh;
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  radius = 1;
  scale = 1;
  age = 0;
  private readonly spinAxis = new THREE.Vector3(0, 1, 0);
  private spinSpeed = 1;
  private readonly q = new THREE.Quaternion();

  constructor(private readonly models: Models) {
    this.object = new THREE.Mesh(models.rocks[0], models.mat.rock);
    this.object.visible = false;
  }

  spawn(x: number, z: number, vx: number, vz: number, scale: number, variant: number): void {
    this.object.geometry = this.models.rocks[variant % this.models.rocks.length];
    this.pos.set(x, 0, z);
    this.vel.set(vx, 0, vz);
    this.scale = scale;
    this.radius = 0.82 * scale;
    this.age = 0;
    this.spinAxis.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.spinSpeed = (0.4 + Math.random() * 1.1) * (Math.random() < 0.5 ? -1 : 1);
    this.object.quaternion.setFromAxisAngle(this.spinAxis, Math.random() * 6.28);
    this.object.visible = true;
    this.object.scale.setScalar(0.01);
  }

  update(dt: number): void {
    this.age += dt;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.q.setFromAxisAngle(this.spinAxis, this.spinSpeed * dt);
    this.object.quaternion.premultiply(this.q);
    this.object.scale.setScalar(this.scale * Math.min(1, this.age * 3));
    this.object.position.set(this.pos.x, 0, this.pos.z);
  }

  hide(): void {
    this.object.visible = false;
  }
}
