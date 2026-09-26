import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hslToHex, TAU } from '../core/math';
import { Rng } from '../core/Rng';
import { PALETTE } from './palette';
import { hash3, sharedUniforms } from './shared';

/* -------------------------------------------------------------------------- */
/*  Geometry builder: merges primitives with per-part vertex colors so each     */
/*  model is ONE low-poly mesh (one draw call) with flat, stylized shading.     */
/* -------------------------------------------------------------------------- */

interface PartOptions {
  matrix?: THREE.Matrix4;
  /** Per-vertex sway weight computed from the part's local (pre-matrix) position. */
  sway?: (p: THREE.Vector3) => number;
  /** Per-triangle color override (receives triangle index and centroid in local space). */
  faceColor?: (tri: number, centroid: THREE.Vector3) => number;
}

const tmpColor = new THREE.Color();
const tmpV = new THREE.Vector3();

class GeoBuilder {
  private parts: THREE.BufferGeometry[] = [];
  private withSway = false;

  add(source: THREE.BufferGeometry, color: number, opts: PartOptions = {}): this {
    const g = source.index ? source.toNonIndexed() : source.clone();
    g.deleteAttribute('uv');
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const count = pos.count;

    const colors = new Float32Array(count * 3);
    if (opts.faceColor) {
      const c = new THREE.Vector3();
      for (let t = 0; t < count / 3; t++) {
        c.set(0, 0, 0);
        for (let k = 0; k < 3; k++) c.add(tmpV.fromBufferAttribute(pos, t * 3 + k));
        c.multiplyScalar(1 / 3);
        tmpColor.setHex(opts.faceColor(t, c));
        for (let k = 0; k < 3; k++) tmpColor.toArray(colors, (t * 3 + k) * 3);
      }
    } else {
      tmpColor.setHex(color);
      for (let i = 0; i < count; i++) tmpColor.toArray(colors, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const sway = new Float32Array(count);
    if (opts.sway) {
      this.withSway = true;
      for (let i = 0; i < count; i++) sway[i] = opts.sway(tmpV.fromBufferAttribute(pos, i));
    }
    g.setAttribute('aSway', new THREE.BufferAttribute(sway, 1));

    if (opts.matrix) g.applyMatrix4(opts.matrix);
    this.parts.push(g);
    return this;
  }

  build(): THREE.BufferGeometry {
    const merged = mergeGeometries(this.parts, false);
    if (!merged) throw new Error('Failed to merge geometry');
    if (!this.withSway) merged.deleteAttribute('aSway');
    merged.computeBoundingSphere();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    return merged;
  }
}

const M = (): THREE.Matrix4 => new THREE.Matrix4();
function compose(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return M().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

/** Displaces vertices along their direction with hash-noise (consistent for shared vertices). */
function jitter(geo: THREE.BufferGeometry, amount: number, seed: number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    tmpV.fromBufferAttribute(pos, i);
    const k = 1 + (hash3(+tmpV.x.toFixed(3), +tmpV.y.toFixed(3), +tmpV.z.toFixed(3), seed) - 0.5) * 2 * amount;
    tmpV.multiplyScalar(k);
    pos.setXYZ(i, tmpV.x, tmpV.y, tmpV.z);
  }
  pos.needsUpdate = true;
  return geo;
}

function starShape(outer: number, inner: number, points = 5): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * TAU + Math.PI / 2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return shape;
}

/** Adds a 0..1 attribute along +Z (0 at z=0 → 1 at z=1) used by the tail shaders. */
function withAlongZ(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const t = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) t[i] = THREE.MathUtils.clamp(pos.getZ(i), 0, 1);
  geo.setAttribute('aT', new THREE.BufferAttribute(t, 1));
  return geo;
}

/* -------------------------------------------------------------------------- */
/*  Materials                                                                   */
/* -------------------------------------------------------------------------- */

function lambert(params: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...params });
}

/** Lambert material whose vertices with aSway > 0 wiggle (alien tentacles). */
function swayMaterial(amp: number, speed: number, params: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  const mat = lambert(params);
  const uniforms = { uSwayAmp: { value: amp }, uSwaySpeed: { value: speed } };
  mat.userData.sway = uniforms;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = sharedUniforms.uTime;
    shader.uniforms.uSwayAmp = uniforms.uSwayAmp;
    shader.uniforms.uSwaySpeed = uniforms.uSwaySpeed;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aSway;\nuniform float uTime;\nuniform float uSwayAmp;\nuniform float uSwaySpeed;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float swPh = modelMatrix[3].x * 0.9 + modelMatrix[3].z * 0.6;
        float swW = aSway * aSway;
        transformed.x += sin(uTime * uSwaySpeed + position.x * 4.0 + swPh) * swW * uSwayAmp;
        transformed.z += cos(uTime * uSwaySpeed * 0.83 + position.z * 4.0 + swPh) * swW * uSwayAmp;
        transformed.y += sin(uTime * uSwaySpeed * 1.3 + swPh) * swW * uSwayAmp * 0.35;`,
      );
  };
  mat.customProgramCacheKey = () => 'sway';
  return mat;
}

const TAIL_VERT = /* glsl */ `
attribute float aT;
varying float vT;
varying vec3 vLocal;
varying float vFacing;
void main() {
  vT = aT;
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;

const TAIL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uRainbow;
uniform float uOpacity;
varying float vT;
varying vec3 vLocal;
varying float vFacing;
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
void main() {
  float ang = atan(vLocal.y, vLocal.x);
  float flick = 0.8 + 0.2 * sin(uTime * 31.0 + ang * 3.0 + vT * 9.0);
  vec3 fire = mix(vec3(1.0, 0.78, 0.3), vec3(1.0, 0.38, 0.04), smoothstep(0.0, 0.3, vT));
  fire = mix(fire, vec3(0.6, 0.06, 0.02), smoothstep(0.35, 1.0, vT));
  vec3 rainbow = hsv2rgb(vec3(fract(vT * 0.9 - uTime * 0.7 + ang / 6.2831), 0.85, 1.0));
  vec3 col = mix(fire, rainbow, uRainbow);
  // Soft edges: fade where the cone surface turns away from the camera.
  float soft = smoothstep(0.05, 0.75, vFacing);
  float a = (1.0 - vT) * (1.0 - vT) * flick * soft * uOpacity * 0.8;
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}`;

export function makeTailMaterial(rainbow: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: sharedUniforms.uTime, uRainbow: { value: rainbow ? 1 : 0 }, uOpacity: { value: 0.95 } },
    vertexShader: TAIL_VERT,
    fragmentShader: TAIL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

const AURA_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const AURA_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float a = f * uOpacity;
  gl_FragColor = vec4(uColor * a, a);
  #include <colorspace_fragment>
}`;

export function makeAuraMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 } },
    vertexShader: AURA_VERT,
    fragmentShader: AURA_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/* -------------------------------------------------------------------------- */
/*  Model library                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Builds every procedural low-poly model once at startup. Entities create meshes that
 * share these geometries and materials, keeping memory, draw calls and GC low.
 */
export class Models {
  readonly rocket: THREE.BufferGeometry;
  readonly rocketCockpit: THREE.BufferGeometry;
  readonly flame: THREE.BufferGeometry;
  readonly flameCore: THREE.BufferGeometry;
  readonly aura: THREE.BufferGeometry;
  readonly coinYellow: THREE.BufferGeometry;
  readonly coinRainbow: THREE.BufferGeometry;
  readonly rocks: THREE.BufferGeometry[];
  readonly meteorCore: THREE.BufferGeometry[];
  readonly crystal: THREE.BufferGeometry;
  readonly tail: THREE.BufferGeometry;
  readonly greenAlien: THREE.BufferGeometry;
  readonly purpleAlien: THREE.BufferGeometry;
  readonly purpleEyes: THREE.BufferGeometry;
  readonly planet: THREE.BufferGeometry;
  readonly planetRing: THREE.BufferGeometry;
  readonly debris: THREE.BufferGeometry[];
  readonly miniRock: THREE.BufferGeometry;
  readonly warningStrip: THREE.BufferGeometry;

  readonly mat: {
    rocket: THREE.MeshLambertMaterial;
    cockpit: THREE.MeshLambertMaterial;
    flame: THREE.MeshBasicMaterial;
    coinYellow: THREE.MeshLambertMaterial;
    coinRainbow: THREE.MeshLambertMaterial;
    rock: THREE.MeshLambertMaterial;
    meteorCore: THREE.MeshLambertMaterial;
    crystal: THREE.MeshLambertMaterial;
    fireTail: THREE.ShaderMaterial;
    rainbowTail: THREE.ShaderMaterial;
    greenAlien: THREE.MeshLambertMaterial;
    purpleAlien: THREE.MeshLambertMaterial;
    purpleEyes: THREE.MeshBasicMaterial;
    planet: THREE.MeshLambertMaterial;
    planetRing: THREE.MeshBasicMaterial;
    debris: THREE.MeshLambertMaterial;
    miniRock: THREE.MeshLambertMaterial;
  };

  constructor() {
    const rng = new Rng(1337);
    this.rocket = this.buildRocket();
    this.rocketCockpit = new THREE.SphereGeometry(0.16, 8, 6).applyMatrix4(compose(0, 0.2, -0.22, 0, 0, 0, 1, 0.8, 1.7));
    this.flame = this.buildFlame(0.21, false);
    this.flameCore = this.buildFlame(0.11, true);
    this.aura = new THREE.IcosahedronGeometry(1, 2);
    this.coinYellow = this.buildCoin(false);
    this.coinRainbow = this.buildCoin(true);
    this.rocks = [0, 1, 2, 3, 4].map((i) => this.buildRock(rng, i));
    this.meteorCore = [0, 1, 2].map((i) => this.buildMeteorCore(rng, i));
    this.crystal = this.buildCrystal();
    this.tail = this.buildTail();
    this.greenAlien = this.buildGreenAlien();
    this.purpleAlien = this.buildPurpleAlien();
    this.purpleEyes = this.buildPurpleEyes();
    this.planet = this.buildPlanet(rng);
    this.planetRing = new THREE.RingGeometry(19, 26, 48, 1);
    this.debris = [PALETTE.rocketBody, PALETTE.rocketLight, PALETTE.rocketDark, PALETTE.rocketAccent].map((c) =>
      new GeoBuilder().add(new THREE.TetrahedronGeometry(0.2), c).build(),
    );
    this.miniRock = jitter(new THREE.IcosahedronGeometry(1, 0), 0.3, 99);
    this.warningStrip = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5);

    this.mat = {
      rocket: lambert(),
      cockpit: new THREE.MeshLambertMaterial({ color: PALETTE.cockpit, emissive: 0x1b7f8f, flatShading: true }),
      flame: new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      }),
      coinYellow: lambert({ emissive: 0x6a4300 }),
      coinRainbow: lambert({ emissive: 0x3a3a3a }),
      rock: lambert(),
      meteorCore: lambert({ emissive: 0x3a1204 }),
      crystal: lambert({ emissive: 0x555555 }),
      fireTail: makeTailMaterial(false),
      rainbowTail: makeTailMaterial(true),
      greenAlien: swayMaterial(0.16, 5.5),
      purpleAlien: swayMaterial(0.2, 8),
      purpleEyes: new THREE.MeshBasicMaterial({ color: PALETTE.alienPurpleEye }),
      planet: lambert({ emissive: 0x120a26, fog: false }),
      planetRing: new THREE.MeshBasicMaterial({
        color: 0xb89cff,
        transparent: true,
        opacity: 0.28,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      }),
      debris: lambert({ emissive: 0x221100 }),
      miniRock: new THREE.MeshLambertMaterial({ color: 0x23223a, flatShading: true }),
    };
  }

  /* ------------------------------ Rocket -------------------------------- */

  private buildRocket(): THREE.BufferGeometry {
    const b = new GeoBuilder();
    const noseToZ = -Math.PI / 2; // cylinder/cone +Y axis → -Z (forward)
    // Fuselage
    b.add(new THREE.CylinderGeometry(0.24, 0.3, 0.95, 8), PALETTE.rocketBody, { matrix: compose(0, 0, 0.05, noseToZ) });
    // Nose cone + accent band
    b.add(new THREE.ConeGeometry(0.24, 0.55, 8), PALETTE.rocketLight, { matrix: compose(0, 0, -0.7, noseToZ) });
    b.add(new THREE.CylinderGeometry(0.255, 0.255, 0.08, 8), PALETTE.rocketAccent, { matrix: compose(0, 0, -0.36, noseToZ) });
    // Engine nozzle
    b.add(new THREE.CylinderGeometry(0.2, 0.27, 0.2, 8), PALETTE.rocketNozzle, { matrix: compose(0, 0, 0.62, noseToZ) });

    // Swept wings (shape y → world z, extrusion → world -y)
    const wingR = new THREE.Shape([
      new THREE.Vector2(0.18, -0.12),
      new THREE.Vector2(0.88, 0.34),
      new THREE.Vector2(0.88, 0.52),
      new THREE.Vector2(0.18, 0.46),
    ]);
    const wingL = new THREE.Shape([
      new THREE.Vector2(-0.18, 0.46),
      new THREE.Vector2(-0.88, 0.52),
      new THREE.Vector2(-0.88, 0.34),
      new THREE.Vector2(-0.18, -0.12),
    ]);
    const wingOpts = { depth: 0.07, bevelEnabled: false };
    const wingM = compose(0, 0.035, 0, Math.PI / 2);
    b.add(new THREE.ExtrudeGeometry(wingR, wingOpts), PALETTE.rocketDark, { matrix: wingM });
    b.add(new THREE.ExtrudeGeometry(wingL, wingOpts), PALETTE.rocketDark, { matrix: wingM });
    // Wing-tip fins (silhouette + accent)
    b.add(new THREE.BoxGeometry(0.06, 0.26, 0.3), PALETTE.rocketAccent, { matrix: compose(0.88, 0.08, 0.43) });
    b.add(new THREE.BoxGeometry(0.06, 0.26, 0.3), PALETTE.rocketAccent, { matrix: compose(-0.88, 0.08, 0.43) });

    // Tail fin (shape x → world z, y → world y, extrusion → -x)
    const fin = new THREE.Shape([
      new THREE.Vector2(0.12, 0.18),
      new THREE.Vector2(0.58, 0.18),
      new THREE.Vector2(0.62, 0.62),
      new THREE.Vector2(0.44, 0.62),
    ]);
    b.add(new THREE.ExtrudeGeometry(fin, { depth: 0.05, bevelEnabled: false }), PALETTE.rocketLight, {
      matrix: compose(0.025, 0, 0, 0, -Math.PI / 2),
    });
    return b.build();
  }

  private buildFlame(radius: number, core: boolean): THREE.BufferGeometry {
    // Cone tip → +Z (backwards), base at z = 0, tip at z = 1. Colors fade along length.
    const geo = new THREE.ConeGeometry(radius, 1, 8, 2, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    const g = geo.toNonIndexed();
    geo.dispose();
    g.deleteAttribute('uv');
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const cBase = new THREE.Color(core ? 0xffffff : PALETTE.flameCore);
    const cMid = new THREE.Color(core ? PALETTE.flameCore : PALETTE.flameMid);
    const cTip = new THREE.Color(core ? PALETTE.flameMid : PALETTE.flameOuter);
    for (let i = 0; i < pos.count; i++) {
      const t = THREE.MathUtils.clamp(pos.getZ(i), 0, 1);
      if (t < 0.5) tmpColor.copy(cBase).lerp(cMid, t * 2);
      else tmpColor.copy(cMid).lerp(cTip, (t - 0.5) * 2).multiplyScalar(1 - (t - 0.5) * 1.4);
      tmpColor.toArray(colors, i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return g;
  }

  /* ------------------------------- Coins -------------------------------- */

  private buildCoin(rainbow: boolean): THREE.BufferGeometry {
    const b = new GeoBuilder();
    const faceZ = Math.PI / 2; // cylinder axis Y → Z (coin faces the camera side)
    if (rainbow) {
      b.add(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 12), 0xffffff, {
        matrix: compose(0, 0, 0, faceZ),
        faceColor: (_t, c) => hslToHex(Math.atan2(c.z, c.x) / TAU + 0.5, 0.95, 0.58),
      });
      b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.13, 12), 0xffffff, { matrix: compose(0, 0, 0, faceZ) });
      b.add(new THREE.ExtrudeGeometry(starShape(0.17, 0.075), { depth: 0.16, bevelEnabled: false }), 0xfff6a0, {
        matrix: compose(0, 0, -0.08),
      });
    } else {
      b.add(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 14), PALETTE.coinGold, { matrix: compose(0, 0, 0, faceZ) });
      b.add(new THREE.CylinderGeometry(0.33, 0.33, 0.12, 14), PALETTE.coinDark, { matrix: compose(0, 0, 0, faceZ) });
      b.add(new THREE.ExtrudeGeometry(starShape(0.21, 0.09), { depth: 0.15, bevelEnabled: false }), PALETTE.coinLight, {
        matrix: compose(0, 0, -0.075),
      });
    }
    return b.build();
  }

  /* --------------------------- Rocks / meteors -------------------------- */

  private buildRock(rng: Rng, seed: number): THREE.BufferGeometry {
    const base = jitter(new THREE.IcosahedronGeometry(1, 1), 0.26, seed + 1);
    const sx = rng.range(0.85, 1.15);
    const sy = rng.range(0.75, 0.95);
    const sz = rng.range(0.85, 1.15);
    return new GeoBuilder()
      .add(base, 0, {
        matrix: compose(0, 0, 0, 0, 0, 0, sx, sy, sz),
        faceColor: (t, c) => {
          // Darker "craters" + lighter top faces for a readable stylized rock.
          const shade = PALETTE.rock[(t * 7 + seed) % PALETTE.rock.length];
          return c.y > 0.45 ? PALETTE.rock[2] : shade;
        },
      })
      .build();
  }

  private buildMeteorCore(rng: Rng, seed: number): THREE.BufferGeometry {
    const base = jitter(new THREE.IcosahedronGeometry(1, 1), 0.22, seed + 40);
    return new GeoBuilder()
      .add(base, 0, {
        faceColor: (t) => {
          if (rng.chance(0.22)) return PALETTE.lava[t % 2];
          return PALETTE.meteorRock[t % PALETTE.meteorRock.length];
        },
      })
      .build();
  }

  private buildCrystal(): THREE.BufferGeometry {
    return new GeoBuilder()
      .add(new THREE.OctahedronGeometry(1, 0), 0, {
        matrix: compose(0, 0, 0, 0, 0, 0, 1, 1.25, 1),
        faceColor: (t) => hslToHex(t / 8, 0.85, 0.66),
      })
      .build();
  }

  private buildTail(): THREE.BufferGeometry {
    // Wide end at z = 0 (on the core), tip trailing to z = 1.
    const geo = new THREE.ConeGeometry(1, 1, 10, 3, true).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    geo.deleteAttribute('uv');
    return withAlongZ(geo);
  }

  /* ------------------------------- Aliens ------------------------------- */

  private addTentacles(
    b: GeoBuilder,
    count: number,
    ringRadius: number,
    y: number,
    length: number,
    rTop: number,
    color: number,
  ): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU + 0.2;
      const x = Math.cos(a) * ringRadius;
      const z = Math.sin(a) * ringRadius;
      const tilt = 0.32;
      const m = M()
        .makeTranslation(x, y, z)
        .multiply(M().makeRotationY(-a))
        .multiply(M().makeRotationZ(tilt))
        .multiply(M().makeTranslation(0, -length / 2, 0));
      b.add(new THREE.CylinderGeometry(rTop, rTop * 0.28, length, 5, 3), color, {
        matrix: m,
        sway: (p) => THREE.MathUtils.clamp((length / 2 - p.y) / length, 0, 1),
      });
    }
  }

  /** Face points +Z; the entity pitches the model toward the camera so it reads like the sprite. */
  private buildGreenAlien(): THREE.BufferGeometry {
    const b = new GeoBuilder();
    b.add(new THREE.SphereGeometry(0.72, 12, 9), PALETTE.alienGreen, {
      matrix: compose(0, 0.25, 0, 0, 0, 0, 1, 0.9, 0.95),
      faceColor: (_t, c) => (c.y > 0.55 ? PALETTE.alienGreenDark : PALETTE.alienGreen),
    });
    // Eyes + pupils (looking slightly inward = grumpy)
    for (const s of [-1, 1]) {
      b.add(new THREE.SphereGeometry(0.16, 8, 6), PALETTE.eyeWhite, { matrix: compose(0.25 * s, 0.3, 0.58, 0, 0, 0, 1, 0.75, 0.55) });
      b.add(new THREE.SphereGeometry(0.075, 6, 4), PALETTE.ink, { matrix: compose(0.22 * s, 0.28, 0.66) });
      // Angry brows: inner ends low → "V"
      b.add(new THREE.BoxGeometry(0.36, 0.085, 0.1), PALETTE.ink, { matrix: compose(0.24 * s, 0.5, 0.57, -0.25, 0, 0.45 * s) });
    }
    // Frowning "M" mouth
    b.add(new THREE.BoxGeometry(0.26, 0.05, 0.06), PALETTE.ink, { matrix: compose(0, 0.03, 0.66, -0.3) });
    for (const s of [-1, 1]) {
      b.add(new THREE.BoxGeometry(0.1, 0.05, 0.06), PALETTE.ink, { matrix: compose(0.15 * s, -0.01, 0.64, -0.3, 0, 0.7 * s) });
    }
    this.addTentacles(b, 7, 0.42, -0.18, 0.85, 0.13, PALETTE.alienGreenDeep);
    return b.build();
  }

  private buildPurpleAlien(): THREE.BufferGeometry {
    const b = new GeoBuilder();
    b.add(new THREE.SphereGeometry(0.56, 10, 8), PALETTE.alienPurple, {
      matrix: compose(0, 0.25, 0, 0, 0, 0, 1, 1.08, 0.95),
      faceColor: (_t, c) => (c.y > 0.45 ? PALETTE.alienPurpleDark : PALETTE.alienPurple),
    });
    // Spiky crest — a clearly different silhouette from the green aliens
    for (let i = -1; i <= 1; i++) {
      b.add(new THREE.ConeGeometry(0.09, 0.34, 5), PALETTE.alienPurpleDark, { matrix: compose(i * 0.2, 0.86 - Math.abs(i) * 0.08, -0.05, 0, 0, -i * 0.45) });
    }
    for (const s of [-1, 1]) {
      // Pupils: slits drawn in front of the glowing eye mesh
      b.add(new THREE.BoxGeometry(0.035, 0.14, 0.03), PALETTE.ink, { matrix: compose(0.2 * s, 0.28, 0.56) });
      b.add(new THREE.BoxGeometry(0.3, 0.08, 0.1), PALETTE.ink, { matrix: compose(0.2 * s, 0.48, 0.47, -0.3, 0, 0.55 * s) });
    }
    // Toothy mouth
    b.add(new THREE.BoxGeometry(0.3, 0.07, 0.06), PALETTE.ink, { matrix: compose(0, 0.02, 0.52, -0.2) });
    for (let i = -1; i <= 1; i += 2) {
      b.add(new THREE.ConeGeometry(0.035, 0.09, 4), PALETTE.eyeWhite, { matrix: compose(i * 0.07, -0.03, 0.55, 0, 0, Math.PI) });
    }
    this.addTentacles(b, 6, 0.32, -0.12, 0.95, 0.1, PALETTE.alienPurpleDark);
    return b.build();
  }

  private buildPurpleEyes(): THREE.BufferGeometry {
    const b = new GeoBuilder();
    for (const s of [-1, 1]) b.add(new THREE.SphereGeometry(0.13, 8, 6), 0xffffff, { matrix: compose(0.2 * s, 0.29, 0.47, 0, 0, 0, 1, 0.85, 0.6) });
    return b.build();
  }

  /* ------------------------------ Scenery ------------------------------- */

  private buildPlanet(rng: Rng): THREE.BufferGeometry {
    const base = jitter(new THREE.IcosahedronGeometry(14, 2), 0.035, 7);
    const bands = [0x6a3fd1, 0x4b2fa8, 0x8a5cf0, 0x3b3fb8, 0x5d49d6];
    return new GeoBuilder()
      .add(base, 0, {
        faceColor: (_t, c) => {
          const band = Math.floor((c.y / 14 + 1) * 3.5 + rng.range(-0.2, 0.2));
          return bands[((band % bands.length) + bands.length) % bands.length];
        },
      })
      .build();
  }
}
