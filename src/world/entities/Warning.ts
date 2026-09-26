import * as THREE from 'three';
import type { MeteorSize } from '../../config/balance';
import { sharedUniforms } from '../../render/shared';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uLen;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  // vUv.y: 0 at the entry point, 1 at the far end of the lane.
  float along = vUv.y * uLen;
  // Marching chevron-like dashes along the lane edges only (no filled road).
  float dash = step(0.45, fract(along / 1.6 - uTime * 3.0));
  float edge = smoothstep(0.41, 0.49, abs(vUv.x - 0.5));
  float center = 1.0 - smoothstep(0.0, 0.06, abs(vUv.x - 0.5));
  // Strong near the entry point, fading out along the path (keeps the view clean).
  float fade = 1.0 - smoothstep(0.08, 0.55, vUv.y);
  float a = uAlpha * fade * (0.05 + 0.55 * edge * dash + 0.3 * center * dash);
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}`;

/**
 * Telegraph for an incoming meteor: a dashed danger lane drawn on the gameplay plane
 * along the exact path (and width) the meteor will take. The meteor only enters after
 * the warning finishes, so the player always gets time to react.
 */
export class Warning {
  readonly object: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  timer = 0;
  duration = 1;
  // Pending meteor
  size: MeteorSize = 'M';
  radius = 0.5;
  readonly start = new THREE.Vector3();
  readonly vel = new THREE.Vector3();

  constructor(geometry: THREE.BufferGeometry) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: sharedUniforms.uTime,
        uAlpha: { value: 0 },
        uLen: { value: 30 },
        uColor: { value: new THREE.Color(0xff2a2a) },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.object = new THREE.Mesh(geometry, this.material);
    this.object.visible = false;
    this.object.renderOrder = -1;
  }

  spawn(x: number, z: number, vx: number, vz: number, radius: number, size: MeteorSize, duration: number, length: number): void {
    this.start.set(x, 0, z);
    this.vel.set(vx, 0, vz);
    this.radius = radius;
    this.size = size;
    this.duration = duration;
    this.timer = 0;
    this.material.uniforms.uLen.value = length;
    this.object.position.set(x, 0.02, z);
    this.object.rotation.set(0, Math.atan2(-vx, -vz), 0);
    this.object.scale.set(radius * 2.1, 1, length);
    this.object.visible = true;
  }

  /** Returns true when the warning is over and the meteor should launch. */
  update(dt: number): boolean {
    this.timer += dt;
    const t = this.timer / this.duration;
    const blink = 0.75 + 0.25 * Math.sin(this.timer * 22);
    this.material.uniforms.uAlpha.value = Math.min(1, t * 4) * blink * (t > 0.85 ? 1 - (t - 0.85) / 0.15 : 1);
    return this.timer >= this.duration;
  }

  hide(): void {
    this.object.visible = false;
  }
}
