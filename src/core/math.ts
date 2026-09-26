export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (a === b ? 0 : clamp((v - a) / (b - a), 0, 1));

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential smoothing. */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Wraps an angle to [-PI, PI]. */
export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return current + wrapAngle(target - current) * (1 - Math.exp(-rate * dt));
}

export const dist2 = (ax: number, az: number, bx: number, bz: number): number => {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
};

/** Circle-vs-circle overlap on the XZ gameplay plane. */
export const circlesOverlap = (ax: number, az: number, ar: number, bx: number, bz: number, br: number): boolean => {
  const r = ar + br;
  return dist2(ax, az, bx, bz) < r * r;
};

/**
 * Time (seconds, >= 0) at which a point moving with velocity (vx, vz) from (px, pz)
 * is closest to the static point (tx, tz). Returns 0 when not moving.
 */
export function closestApproachTime(px: number, pz: number, vx: number, vz: number, tx: number, tz: number): number {
  const v2 = vx * vx + vz * vz;
  if (v2 < 1e-9) return 0;
  const t = ((tx - px) * vx + (tz - pz) * vz) / v2;
  return t < 0 ? 0 : t;
}

/** HSL (0..1) to packed RGB hex. */
export function hslToHex(h: number, s: number, l: number): number {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return (Math.round(f(0) * 255) << 16) | (Math.round(f(8) * 255) << 8) | Math.round(f(4) * 255);
}
