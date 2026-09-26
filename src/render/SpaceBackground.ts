import * as THREE from 'three';
import { Rng } from '../core/Rng';
import type { Models } from './Models';
import { PALETTE } from './palette';
import { sharedUniforms } from './shared';

const STAR_VERT = /* glsl */ `
attribute float aSize;
attribute float aPhase;
uniform float uOffset;
uniform float uRange;
uniform float uZStart;
uniform float uScale;
uniform float uTime;
varying float vAlpha;
void main() {
  vec3 p = position;
  // Endless streaming: wrap along Z (the flight direction) in the shader — zero CPU cost.
  p.z = uZStart + mod(p.z - uZStart + uOffset, uRange);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = max(1.0, aSize * uScale / -mv.z);
  float edge = smoothstep(0.0, 0.08, (p.z - uZStart) / uRange) * (1.0 - smoothstep(0.9, 1.0, (p.z - uZStart) / uRange));
  vAlpha = edge * (0.7 + 0.3 * sin(uTime * 2.0 + aPhase));
}`;

const STAR_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  // Square points on purpose: a nod to the white pixel stars of the original 2D game.
  gl_FragColor = vec4(uColor, vAlpha);
  #include <colorspace_fragment>
}`;

interface StarLayer {
  points: THREE.Points;
  material: THREE.ShaderMaterial;
  speedMul: number;
  count: number;
}

/**
 * Stylized infinite space: nebula skybox, three parallax star layers (far / mid / near),
 * small decorative rocks, a drifting planet and occasional shooting stars.
 * Everything wraps or recycles — no big world, no allocations while playing.
 */
export class SpaceBackground {
  readonly group = new THREE.Group();
  private readonly layers: StarLayer[] = [];
  private readonly farStars: THREE.Points;
  private readonly miniRocks: THREE.InstancedMesh;
  private readonly miniRockData: { x: number; y: number; z: number; s: number; rx: number; ry: number; spin: number }[] = [];
  private readonly menuPlanet: THREE.Group;
  private readonly driftPlanet: THREE.Group;
  private readonly shooting: THREE.Mesh;
  private readonly shootingVel = new THREE.Vector3();
  private shootingTimer = 3;
  private offset = 0;
  private readonly dummy = new THREE.Object3D();
  private readonly rng = new Rng(4242);
  private density = 1;

  constructor(
    private readonly scene: THREE.Scene,
    models: Models,
    textureSize: number,
  ) {
    scene.background = this.makeNebulaTexture(textureSize);
    scene.fog = new THREE.Fog(PALETTE.fog, 60, 190);

    // Far layer: tiny static stars on a huge sphere.
    const farCount = 1400;
    const farPos = new Float32Array(farCount * 3);
    for (let i = 0; i < farCount; i++) {
      const u = this.rng.next() * 2 - 1;
      const t = this.rng.next() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      farPos[i * 3] = Math.cos(t) * r * 600;
      farPos[i * 3 + 1] = u * 600;
      farPos[i * 3 + 2] = Math.sin(t) * r * 600;
    }
    const farGeo = new THREE.BufferGeometry();
    farGeo.setAttribute('position', new THREE.BufferAttribute(farPos, 3));
    this.farStars = new THREE.Points(
      farGeo,
      new THREE.PointsMaterial({ color: 0xc9d6ff, size: 1.6, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }),
    );
    this.farStars.frustumCulled = false;
    this.group.add(this.farStars);

    // Mid layer: bigger white "pixel" stars below the plane, streaming with parallax.
    this.layers.push(this.makeStarLayer(900, [-70, 70], [-60, -16], -150, 190, [0.18, 0.42], 0xffffff, 2.2));
    // Near layer: faint dust just around the plane, streaming faster.
    this.layers.push(this.makeStarLayer(260, [-30, 30], [-7, -1.2], -60, 80, [0.05, 0.1], 0xaab8ff, 2.8));

    // Near small objects: tumbling mini rocks far below the plane (decorative only).
    const rockCount = 10;
    this.miniRocks = new THREE.InstancedMesh(models.miniRock, models.mat.miniRock, rockCount);
    this.miniRocks.frustumCulled = false;
    for (let i = 0; i < rockCount; i++) {
      this.miniRockData.push({
        x: this.rng.range(-55, 55),
        y: this.rng.range(-60, -28),
        z: this.rng.range(-140, 40),
        s: this.rng.range(0.5, 1.3),
        rx: this.rng.range(0, 6),
        ry: this.rng.range(0, 6),
        spin: this.rng.range(-1, 1),
      });
    }
    this.group.add(this.miniRocks);

    this.menuPlanet = this.makePlanet(models, 0xffffff, 1);
    this.menuPlanet.position.set(-78, -26, 30);
    this.menuPlanet.rotation.set(0.3, 0.4, 0.2);
    this.group.add(this.menuPlanet);

    this.driftPlanet = this.makePlanet(models, 0x9ad8ff, 0.55);
    this.driftPlanet.position.set(-45, -95, -170);
    this.group.add(this.driftPlanet);

    // Shooting star (decorative meteor streak far away)
    this.shooting = new THREE.Mesh(models.tail, models.mat.fireTail);
    this.shooting.visible = false;
    this.group.add(this.shooting);

    scene.add(this.group);
  }

  setQuality(density: number): void {
    this.density = density;
    for (const l of this.layers) l.points.geometry.setDrawRange(0, Math.floor(l.count * Math.min(1, 0.45 + density * 0.55)));
  }

  setViewport(heightPx: number, fovDeg: number): void {
    const scale = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    for (const l of this.layers) l.material.uniforms.uScale.value = scale;
  }

  /** speed = world cruise speed (units/s); the layers multiply it for parallax. */
  update(dt: number, speed: number): void {
    this.offset += dt * speed;
    for (const l of this.layers) l.material.uniforms.uOffset.value = (this.offset * l.speedMul) % l.material.uniforms.uRange.value;
    this.farStars.rotation.y += dt * 0.004;

    for (let i = 0; i < this.miniRockData.length; i++) {
      const r = this.miniRockData[i];
      r.z += dt * speed * 2.2;
      if (r.z > 45) {
        r.z = -150;
        r.x = this.rng.range(-55, 55);
      }
      r.rx += dt * r.spin;
      r.ry += dt * r.spin * 0.7;
      this.dummy.position.set(r.x, r.y, r.z);
      this.dummy.rotation.set(r.rx, r.ry, 0);
      this.dummy.scale.setScalar(r.s);
      this.dummy.updateMatrix();
      this.miniRocks.setMatrixAt(i, this.dummy.matrix);
    }
    this.miniRocks.instanceMatrix.needsUpdate = true;

    this.menuPlanet.rotation.y += dt * 0.03;
    this.driftPlanet.rotation.y += dt * 0.05;
    this.driftPlanet.position.z += dt * speed * 0.35;
    if (this.driftPlanet.position.z > 60) {
      this.driftPlanet.position.set(this.rng.range(-70, 70), this.rng.range(-110, -80), -220);
    }

    this.updateShootingStar(dt);
  }

  private updateShootingStar(dt: number): void {
    const s = this.shooting;
    if (s.visible) {
      s.position.addScaledVector(this.shootingVel, dt);
      if (s.position.z > 60 || Math.abs(s.position.x) > 140) s.visible = false;
      return;
    }
    this.shootingTimer -= dt * (0.5 + this.density * 0.5);
    if (this.shootingTimer > 0) return;
    this.shootingTimer = this.rng.range(4, 9);
    const side = this.rng.sign();
    s.position.set(-side * this.rng.range(40, 90), this.rng.range(-45, -20), this.rng.range(-140, -60));
    this.shootingVel.set(side * this.rng.range(30, 45), 0, this.rng.range(15, 30));
    s.rotation.set(0, Math.atan2(-this.shootingVel.x, -this.shootingVel.z), 0);
    s.scale.set(0.6, 0.6, 7);
    s.visible = true;
  }

  private makeStarLayer(
    count: number,
    xr: [number, number],
    yr: [number, number],
    zStart: number,
    range: number,
    sizeRange: [number, number],
    color: number,
    speedMul: number,
  ): StarLayer {
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = this.rng.range(xr[0], xr[1]);
      pos[i * 3 + 1] = this.rng.range(yr[0], yr[1]);
      pos[i * 3 + 2] = this.rng.range(zStart, zStart + range);
      size[i] = this.rng.range(sizeRange[0], sizeRange[1]);
      phase[i] = this.rng.range(0, 6.28);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uOffset: { value: 0 },
        uRange: { value: range },
        uZStart: { value: zStart },
        uScale: { value: 600 },
        uTime: sharedUniforms.uTime,
        uColor: { value: new THREE.Color(color) },
      },
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, material);
    points.frustumCulled = false;
    this.group.add(points);
    return { points, material, speedMul, count };
  }

  private makePlanet(models: Models, tint: number, scale: number): THREE.Group {
    const g = new THREE.Group();
    const mat = models.mat.planet.clone();
    mat.color.setHex(tint);
    const body = new THREE.Mesh(models.planet, mat);
    const ring = new THREE.Mesh(models.planetRing, models.mat.planetRing);
    ring.rotation.set(1.05, 0.2, 0.5);
    g.add(body, ring);
    g.scale.setScalar(scale);
    return g;
  }

  /** Stylized nebula skybox painted once into a small equirectangular texture. */
  private makeNebulaTexture(width: number): THREE.Texture | THREE.Color {
    if (typeof document === 'undefined') return new THREE.Color(PALETTE.space);
    const w = width;
    const h = width / 2;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new THREE.Color(PALETTE.space);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#07051a');
    grad.addColorStop(0.5, '#050312');
    grad.addColorStop(1, '#0b0622');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    const rng = new Rng(77);
    const hues = ['108, 52, 210', '40, 70, 200', '170, 40, 190', '30, 110, 190', '90, 30, 150'];
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const x = rng.range(0, w);
      const y = rng.range(h * 0.05, h * 0.95);
      const r = rng.range(w * 0.04, w * 0.16);
      const c = hues[i % hues.length];
      const a = rng.range(0.05, 0.13);
      for (const dx of [0, -w, w]) {
        const g2 = ctx.createRadialGradient(x + dx, y, 0, x + dx, y, r);
        g2.addColorStop(0, `rgba(${c}, ${a})`);
        g2.addColorStop(0.5, `rgba(${c}, ${a * 0.45})`);
        g2.addColorStop(1, `rgba(${c}, 0)`);
        ctx.fillStyle = g2;
        ctx.fillRect(x + dx - r, y - r, r * 2, r * 2);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < w * 0.6; i++) {
      const b = rng.range(120, 255) | 0;
      ctx.fillStyle = `rgba(${b}, ${b}, 255, ${rng.range(0.3, 0.9)})`;
      const s = rng.chance(0.1) ? 2 : 1;
      ctx.fillRect(rng.range(0, w) | 0, rng.range(0, h) | 0, s, s);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  dispose(): void {
    this.scene.remove(this.group);
  }
}
