import * as THREE from 'three';

/** Emission interface used by gameplay entities (a no-op version is used in tests). */
export interface ParticleEmitter {
  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    sizeEnd: number,
    color: number,
    alpha?: number,
    drag?: number,
  ): void;
  /** Radial burst helper. */
  burst(x: number, y: number, z: number, count: number, speed: number, life: number, size: number, colors: readonly number[], spreadY?: number): void;
  /** Budget multiplier for continuous emitters (quality setting). */
  readonly density: number;
}

export class NullParticles implements ParticleEmitter {
  readonly density = 1;
  emit(): void {}
  burst(): void {}
}

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.001, -mv.z);
  vColor = aColor;
  vAlpha = aAlpha;
}`;

const FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.1, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
  #include <colorspace_fragment>
}`;

const colorCache = new Map<number, THREE.Color>();
function cachedColor(hex: number): THREE.Color {
  let c = colorCache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    colorCache.set(hex, c);
  }
  return c;
}

/**
 * Single pooled, additive point-sprite particle system: one draw call for every
 * thruster flame, coin sparkle, meteor ember and explosion. Dead particles are
 * compacted with swap-remove, so nothing is allocated during gameplay.
 */
export class ParticleSystem implements ParticleEmitter {
  readonly points: THREE.Points;
  density = 1;
  private budget: number;
  private count = 0;
  private readonly capacity: number;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;

  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly drag: Float32Array;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.budget = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.size1 = new Float32Array(capacity);
    this.alpha0 = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  get alive(): number {
    return this.count;
  }

  /** Quality: caps simultaneous particles and scales continuous emitters. */
  setBudget(budget: number, density: number): void {
    this.budget = Math.min(this.capacity, Math.max(64, Math.floor(budget)));
    this.density = density;
    if (this.count > this.budget) this.count = this.budget;
  }

  /** Pixel scale so particle sizes are in world units. */
  setViewport(heightPx: number, fovDeg: number): void {
    this.material.uniforms.uScale.value = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    sizeEnd: number,
    color: number,
    alpha = 1,
    drag = 0,
  ): void {
    if (this.count >= this.budget) return;
    const i = this.count++;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    const c = cachedColor(color);
    this.col[i3] = c.r;
    this.col[i3 + 1] = c.g;
    this.col[i3 + 2] = c.b;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size0[i] = size;
    this.size1[i] = sizeEnd;
    this.size[i] = size;
    this.alpha0[i] = alpha;
    this.alpha[i] = alpha;
    this.drag[i] = drag;
  }

  burst(x: number, y: number, z: number, count: number, speed: number, life: number, size: number, colors: readonly number[], spreadY = 0.5): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      const vy = (Math.random() - 0.3) * speed * spreadY;
      this.emit(
        x,
        y,
        z,
        Math.cos(a) * s,
        vy,
        Math.sin(a) * s,
        life * (0.6 + Math.random() * 0.6),
        size * (0.7 + Math.random() * 0.6),
        0,
        colors[i % colors.length],
        1,
        2.5,
      );
    }
  }

  clear(): void {
    this.count = 0;
    this.geometry.setDrawRange(0, 0);
  }

  update(dt: number): void {
    const { pos, vel, col, size, alpha, life, maxLife, size0, size1, alpha0, drag } = this;
    let n = this.count;
    for (let i = 0; i < n; i++) {
      life[i] -= dt;
      if (life[i] <= 0) {
        // swap-remove with the last live particle
        n--;
        if (i !== n) {
          const i3 = i * 3;
          const n3 = n * 3;
          for (let k = 0; k < 3; k++) {
            pos[i3 + k] = pos[n3 + k];
            vel[i3 + k] = vel[n3 + k];
            col[i3 + k] = col[n3 + k];
          }
          life[i] = life[n];
          maxLife[i] = maxLife[n];
          size0[i] = size0[n];
          size1[i] = size1[n];
          alpha0[i] = alpha0[n];
          drag[i] = drag[n];
        }
        i--;
        continue;
      }
      const i3 = i * 3;
      const k = drag[i] > 0 ? Math.exp(-drag[i] * dt) : 1;
      vel[i3] *= k;
      vel[i3 + 1] *= k;
      vel[i3 + 2] *= k;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      const t = 1 - life[i] / maxLife[i];
      size[i] = size0[i] + (size1[i] - size0[i]) * t;
      alpha[i] = alpha0[i] * (1 - t * t);
    }
    this.count = n;
    this.geometry.setDrawRange(0, n);
    if (n > 0) {
      for (const name of ['position', 'aColor', 'aSize', 'aAlpha']) {
        const attr = this.geometry.getAttribute(name) as THREE.BufferAttribute;
        attr.clearUpdateRanges();
        attr.addUpdateRange(0, n * attr.itemSize);
        attr.needsUpdate = true;
      }
    }
  }
}
