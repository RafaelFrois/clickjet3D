import * as THREE from 'three';
import { clamp, damp, DEG, easeInOutCubic, lerp } from '../core/math';

/** Camera elevation above the gameplay plane (degrees). Tilted top-down chase view. */
const PITCH = 56 * DEG;
const TARGET_HFOV = 64 * DEG;

export interface Layout {
  aspect: number;
  fov: number;
  distance: number;
  targetZ: number;
  halfWidth: number;
  zMin: number;
  zMax: number;
  spawnTop: number;
  spawnBottom: number;
  visibleNear: number;
  visibleFar: number;
}

const tmp = new THREE.Vector3();
const ray = new THREE.Ray();
const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function placeCamera(cam: THREE.PerspectiveCamera, targetX: number, targetZ: number, distance: number): void {
  cam.position.set(targetX, Math.sin(PITCH) * distance, targetZ + Math.cos(PITCH) * distance);
  cam.lookAt(targetX, 0, targetZ);
  cam.updateMatrixWorld(true);
}

/** Intersects the ray through an NDC point with the gameplay plane (y = 0). */
function ndcToPlane(cam: THREE.PerspectiveCamera, nx: number, ny: number, out: THREE.Vector3): THREE.Vector3 | null {
  tmp.set(nx, ny, 0.5).unproject(cam);
  ray.origin.copy(cam.position);
  ray.direction.copy(tmp).sub(cam.position).normalize();
  return ray.intersectPlane(plane, out);
}

/**
 * Computes an arena size and camera placement that fits the screen: the whole arena is
 * visible below the HUD on every aspect ratio (phones, tablets, 16:9 … 21:9).
 */
export function computeLayout(aspect: number, hudTopNdc = 0.82): Layout {
  const cam = new THREE.PerspectiveCamera(50, aspect, 0.1, 2000);
  const halfWidth = clamp(6.2 * aspect, 5.6, 15.5);
  const zMax = 6;
  const zFarBase = -10;
  const vfov = clamp(2 * Math.atan(Math.tan(TARGET_HFOV / 2) / aspect), 36 * DEG, 72 * DEG);
  cam.fov = vfov / DEG;
  cam.updateProjectionMatrix();

  const corners = [
    new THREE.Vector3(-halfWidth, 0, zMax),
    new THREE.Vector3(halfWidth, 0, zMax),
    new THREE.Vector3(-halfWidth, 0, zFarBase),
    new THREE.Vector3(halfWidth, 0, zFarBase),
  ];
  const fits = (targetZ: number, d: number): boolean => {
    placeCamera(cam, 0, targetZ, d);
    for (const c of corners) {
      tmp.copy(c).project(cam);
      if (Math.abs(tmp.x) > 0.95 || tmp.y < -0.93 || tmp.y > hudTopNdc || tmp.z > 1) return false;
    }
    return true;
  };
  const nearEdgeNdcY = (targetZ: number, d: number): number => {
    placeCamera(cam, 0, targetZ, d);
    return tmp.set(0, 0, zMax).project(cam).y;
  };
  const fitDistance = (targetZ: number): number => {
    let lo = 3;
    let hi = 400;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      if (fits(targetZ, mid)) hi = mid;
      else lo = mid;
    }
    return hi;
  };

  // Choose the look-at depth giving the tightest (largest on screen) fit, preferring
  // compositions where the near edge (where the rocket lives) is at the screen bottom.
  let bestZ = -2;
  let bestD = Infinity;
  let anyZ = -2;
  let anyD = Infinity;
  for (let tz = -14; tz <= 5; tz += 0.25) {
    const d = fitDistance(tz);
    if (d < anyD) {
      anyD = d;
      anyZ = tz;
    }
    if (d < bestD && nearEdgeNdcY(tz, d) <= -0.78) {
      bestD = d;
      bestZ = tz;
    }
  }
  if (!Number.isFinite(bestD)) {
    bestD = anyD;
    bestZ = anyZ;
  }
  placeCamera(cam, 0, bestZ, bestD);

  const p = new THREE.Vector3();
  const zTop = ndcToPlane(cam, 0, hudTopNdc - 0.02, p)?.z ?? zFarBase;
  const zMin = clamp(zTop, -18, zFarBase);
  const zScreenTop = ndcToPlane(cam, 0, 1.1, p)?.z ?? zMin - 8;
  // Spawn just beyond the top of the screen, but never absurdly far (tall phones).
  const spawnTop = clamp(zScreenTop - 1.5, zMin - 9, zMin - 3);
  const zScreenBottom = ndcToPlane(cam, 0, -1.1, p)?.z ?? zMax + 4;
  const spawnBottom = Math.max(zScreenBottom + 1, zMax + 2);

  // Right edge of the view on the plane is a straight line: sample two points.
  const a = ndcToPlane(cam, 1, -1, new THREE.Vector3()) ?? new THREE.Vector3(halfWidth, 0, zMax);
  const b = ndcToPlane(cam, 1, 0.8, new THREE.Vector3()) ?? new THREE.Vector3(halfWidth * 1.4, 0, zMin);
  const xAt = (z: number): number => (Math.abs(b.z - a.z) < 1e-6 ? a.x : a.x + ((z - a.z) / (b.z - a.z)) * (b.x - a.x));

  return {
    aspect,
    fov: cam.fov,
    distance: bestD,
    targetZ: bestZ,
    halfWidth,
    zMin,
    zMax,
    spawnTop,
    spawnBottom,
    visibleNear: xAt(zMax),
    visibleFar: xAt(zMin),
  };
}

export type CameraMode = 'menu' | 'game';

/**
 * Smooth third-person camera. Game mode: tilted chase view behind/above the rocket that
 * follows it softly (no rotation, no constant shake). Menu mode: 3/4 showcase of the
 * rocket. Transitions between modes are eased swoops.
 */
export class CameraController {
  readonly camera: THREE.PerspectiveCamera;
  layout: Layout;
  mode: CameraMode = 'menu';
  shakeEnabled = true;
  portrait = false;

  private blend = 0; // 0 = menu pose, 1 = game pose
  private readonly target = new THREE.Vector3();
  private readonly follow = new THREE.Vector3();
  private trauma = 0;
  private time = 0;
  private readonly menuPos = new THREE.Vector3();
  private readonly menuLook = new THREE.Vector3();
  private readonly gamePos = new THREE.Vector3();
  private readonly gameLook = new THREE.Vector3();
  private readonly pos = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  constructor(aspect: number) {
    this.layout = computeLayout(aspect);
    this.camera = new THREE.PerspectiveCamera(this.layout.fov, aspect, 0.1, 1500);
    this.follow.set(0, 0, this.layout.targetZ);
  }

  resize(aspect: number, hudTopNdc: number): Layout {
    this.layout = computeLayout(aspect, hudTopNdc);
    this.camera.aspect = aspect;
    this.portrait = aspect < 0.9;
    this.camera.updateProjectionMatrix();
    return this.layout;
  }

  setMode(mode: CameraMode, instant = false): void {
    this.mode = mode;
    if (instant) this.blend = mode === 'game' ? 1 : 0;
  }

  /** Adds trauma for screen shake (0..1). Shake is short and optional (settings). */
  shake(amount: number): void {
    if (!this.shakeEnabled) return;
    this.trauma = Math.min(1, this.trauma + amount);
  }

  snapFollow(x: number, z: number, startZ: number): void {
    this.follow.set(x * 0.3, 0, this.layout.targetZ + (z - startZ) * 0.2);
  }

  update(dt: number, rocket: THREE.Vector3, startZ: number): void {
    this.time += dt;
    const L = this.layout;

    // Game pose: soft follow (partial, damped) so the arena stays readable.
    const fx = rocket.x * 0.3;
    const fz = L.targetZ + (rocket.z - startZ) * 0.2;
    this.follow.x = damp(this.follow.x, fx, 3.2, dt);
    this.follow.z = damp(this.follow.z, fz, 3.2, dt);
    this.gameLook.set(this.follow.x, 0, this.follow.z);
    this.gamePos.set(this.follow.x, Math.sin(PITCH) * L.distance, this.follow.z + Math.cos(PITCH) * L.distance);

    // Menu pose: 3/4 view of the floating rocket, offset so the UI has room.
    const sway = Math.sin(this.time * 0.25) * 0.5;
    const far = this.portrait ? 1.45 : 1;
    this.menuPos.set(rocket.x + (5.6 + sway) * far, (2.1 + Math.sin(this.time * 0.33) * 0.25) * far, rocket.z - 3.1 * far);
    const dx = rocket.x - this.menuPos.x;
    const dz = rocket.z - this.menuPos.z;
    const len = Math.hypot(dx, dz) || 1;
    // camera right vector on the ground plane = (-dz, dx) normalized
    const rx = -dz / len;
    const rz = dx / len;
    if (this.portrait) this.menuLook.set(rocket.x, 3.3, rocket.z);
    else this.menuLook.set(rocket.x - rx * 2.5, 0.25, rocket.z - rz * 2.5);

    const goal = this.mode === 'game' ? 1 : 0;
    const speed = 1 / 0.95; // transition duration
    this.blend = goal > this.blend ? Math.min(goal, this.blend + dt * speed) : Math.max(goal, this.blend - dt * speed);
    const t = easeInOutCubic(this.blend);

    this.pos.lerpVectors(this.menuPos, this.gamePos, t);
    // Lift the path mid-transition for a nicer swoop.
    this.pos.y += Math.sin(t * Math.PI) * 4;
    this.look.lerpVectors(this.menuLook, this.gameLook, t);
    const menuFov = this.portrait ? 62 : 42;
    this.camera.fov = lerp(menuFov, L.fov, t);
    this.camera.updateProjectionMatrix();

    // Screen shake (trauma², decays fast).
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma * 0.55;
      this.pos.x += (Math.sin(this.time * 71) + Math.sin(this.time * 37)) * 0.5 * s;
      this.pos.y += (Math.sin(this.time * 63 + 1) + Math.sin(this.time * 29)) * 0.5 * s;
      this.pos.z += Math.sin(this.time * 53 + 2) * 0.5 * s;
      this.trauma = Math.max(0, this.trauma - dt * 1.9);
    }

    this.camera.position.copy(this.pos);
    this.camera.lookAt(this.look);
    this.camera.updateMatrixWorld();
  }

  /** Screen → gameplay plane (for pointer input). */
  screenToPlane(clientX: number, clientY: number, width: number, height: number, out: THREE.Vector3): THREE.Vector3 | null {
    const nx = (clientX / width) * 2 - 1;
    const ny = -(clientY / height) * 2 + 1;
    return ndcToPlane(this.camera, nx, ny, out);
  }

  /** World → CSS pixels. Returns false when behind the camera. */
  project(x: number, y: number, z: number, width: number, height: number, out: { x: number; y: number }): boolean {
    this.target.set(x, y, z).project(this.camera);
    out.x = (this.target.x * 0.5 + 0.5) * width;
    out.y = (-this.target.y * 0.5 + 0.5) * height;
    return this.target.z < 1;
  }
}
