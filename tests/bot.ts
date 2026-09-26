import type { MoveCommand } from '../src/core/types';
import type { World } from '../src/world/World';

const strafeSign = new WeakMap<World, number>();

/** Simple potential-field bot: avoids hazards and danger lanes, drifts home. */
export function botCommand(world: World, out: MoveCommand): MoveCommand {
  const p = world.player.pos;
  let fx = 0;
  let fz = 0;
  const push = (x: number, z: number, r: number, strength: number, range: number) => {
    const dx = p.x - x;
    const dz = p.z - z;
    const len = Math.hypot(dx, dz) || 0.001;
    const gap = len - r;
    if (gap > range) return;
    const k = strength / Math.max(0.25, gap) ** 2;
    fx += (dx / len) * k;
    fz += (dz / len) * k;
  };
  const lane = (sx: number, sz: number, vx: number, vz: number, r: number, strength: number) => {
    const sp = Math.hypot(vx, vz) || 1;
    const t = ((p.x - sx) * vx + (p.z - sz) * vz) / (sp * sp);
    if (t < 0) return;
    const cx = sx + vx * t;
    const cz = sz + vz * t;
    const d = Math.hypot(p.x - cx, p.z - cz);
    if (d > r + 2.2 || t > 2.5) return;
    // Move perpendicular to the lane, away from it.
    let nx = -vz / sp;
    let nz = vx / sp;
    if ((p.x - cx) * nx + (p.z - cz) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    const k = strength / Math.max(0.3, d - r + 0.3);
    fx += nx * k;
    fz += nz * k;
  };
  for (const r of world.rocks.active) push(r.pos.x + r.vel.x * 0.3, r.pos.z + r.vel.z * 0.3, r.radius, 1.2, 3);
  for (const a of world.aliens.active) push(a.pos.x + a.vel.x * 0.3, a.pos.z + a.vel.z * 0.3, a.radius, 1.5, 3.5);
  if (world.chaser.active) {
    // Circle-strafe around the chaser (it can't turn fast), toward open space.
    const c = world.chaser.pos;
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const d = Math.hypot(dx, dz) || 0.001;
    if (d < 7) {
      const ax = dx / d;
      const az = dz / d;
      // Sticky orbit direction (hysteresis) — only flip when the orbit heads into a wall.
      let sign = strafeSign.get(world) ?? 1;
      let tx = -az * sign;
      let tz = ax * sign;
      const a0 = world.arena;
      const nextX = p.x + tx * 2.5;
      const nextZ = p.z + tz * 2.5;
      if (nextX < a0.playerMinX || nextX > a0.playerMaxX || nextZ < a0.playerMinZ || nextZ > a0.playerMaxZ) {
        sign = -sign;
        strafeSign.set(world, sign);
        tx = -tx;
        tz = -tz;
      }
      const w = ((7 - d) / 7) * 4;
      fx += (ax * 0.7 + tx) * w;
      fz += (az * 0.7 + tz) * w;
    }
  }
  for (const m of world.meteors.active) lane(m.pos.x, m.pos.z, m.vel.x, m.vel.z, m.radius, 3);
  for (const w of world.warnings.active) lane(w.start.x, w.start.z, w.vel.x, w.vel.z, w.radius, 2);
  // Walls + home position
  const a = world.arena;
  const wall = (dist: number) => (dist < 3 ? 1.5 / Math.max(0.3, dist) ** 2 : 0);
  fx += wall(p.x - a.playerMinX) - wall(a.playerMaxX - p.x);
  fz += wall(p.z - a.playerMinZ) - wall(a.playerMaxZ - p.z);
  fx += (-p.x / a.halfWidth) * 0.25;
  fz += ((a.startZ - 2 - p.z) / 8) * 0.25;
  const len = Math.hypot(fx, fz);
  out.kind = len > 0.05 ? 'axis' : 'none';
  out.x = len > 0 ? fx / Math.max(len, 0.35) : 0;
  out.z = len > 0 ? fz / Math.max(len, 0.35) : 0;
  return out;
}
