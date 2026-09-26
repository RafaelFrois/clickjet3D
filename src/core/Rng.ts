/** Small seedable PRNG (mulberry32) so simulations and tests are reproducible. */
export class Rng {
  private state: number;

  constructor(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.state = seed >>> 0;
  }

  reseed(seed: number): void {
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Picks a key from a weight table. Keys with weight <= 0 are never chosen. */
  weighted<K extends string>(weights: Readonly<Record<K, number>>): K {
    let total = 0;
    for (const k in weights) total += Math.max(0, weights[k]);
    let r = this.next() * total;
    let last: K | undefined;
    for (const k in weights) {
      const w = Math.max(0, weights[k]);
      if (w <= 0) continue;
      last = k;
      if (r < w) return k;
      r -= w;
    }
    return last as K;
  }
}
