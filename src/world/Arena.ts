import { BALANCE } from '../config/balance';

/**
 * The gameplay space: a bounded region of the XZ plane (y = 0). X = right,
 * Z = toward the camera (screen down), -Z = forward (screen up / where things come from).
 * Its size adapts to the screen aspect so every resolution gets a fair, fully visible arena.
 */
export class Arena {
  halfWidth = 11;
  zMin = -10;
  zMax = 6;
  /** Spawn lines just outside the visible area. */
  spawnTop = -17;
  spawnBottom = 10;
  /** Visible half-width at z = zMax and z = zMin (the view is a trapezoid). */
  visibleNear = 12;
  visibleFar = 16;

  get playerMinX(): number {
    return -this.halfWidth + 0.7;
  }
  get playerMaxX(): number {
    return this.halfWidth - 0.7;
  }
  get playerMinZ(): number {
    return Math.max(this.zMin + 2.2, -12);
  }
  get playerMaxZ(): number {
    return this.zMax - 0.9;
  }
  get startZ(): number {
    return Math.min(BALANCE.player.startZ, this.playerMaxZ - 1);
  }

  /** Visible half-width of the view at depth z (linear across the trapezoid). */
  visibleHalfWidthAt(z: number): number {
    const t = (z - this.zMax) / (this.zMin - this.zMax);
    return this.visibleNear + (this.visibleFar - this.visibleNear) * t;
  }

  /** Side spawn x (just outside the visible region) for a given depth. */
  sideSpawnX(z: number, radius: number): number {
    return this.visibleHalfWidthAt(z) + 1.5 + radius;
  }

  /** True when an object has fully left the play space (with margin) and can be recycled. */
  isOutside(x: number, z: number, radius: number): boolean {
    const m = radius + 3;
    const half = Math.max(this.visibleHalfWidthAt(z), this.halfWidth) + 4;
    return x < -half - m || x > half + m || z < this.spawnTop - 8 - m || z > this.spawnBottom + 4 + m;
  }

  set(layout: { halfWidth: number; zMin: number; zMax: number; spawnTop: number; spawnBottom: number; visibleNear: number; visibleFar: number }): void {
    this.halfWidth = layout.halfWidth;
    this.zMin = layout.zMin;
    this.zMax = layout.zMax;
    this.spawnTop = layout.spawnTop;
    this.spawnBottom = layout.spawnBottom;
    this.visibleNear = layout.visibleNear;
    this.visibleFar = layout.visibleFar;
  }
}
