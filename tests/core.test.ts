import { describe, expect, it } from 'vitest';
import { EventBus } from '../src/core/EventBus';
import { circlesOverlap, closestApproachTime, damp, wrapAngle } from '../src/core/math';
import { Pool } from '../src/core/Pool';
import { Rng } from '../src/core/Rng';
import { ShuffleBag } from '../src/core/ShuffleBag';

describe('ShuffleBag (music rotation)', () => {
  it('never plays the same item twice in a row and covers every item per cycle', () => {
    const items = ['A', 'B', 'C', 'D', 'E'];
    const bag = new ShuffleBag(items, new Rng(42));
    let prev: string | undefined;
    for (let cycle = 0; cycle < 300; cycle++) {
      const seen = new Set<string>();
      for (let i = 0; i < items.length; i++) {
        const next = bag.next();
        expect(next).not.toBe(prev);
        seen.add(next);
        prev = next;
      }
      expect(seen.size).toBe(items.length);
    }
  });

  it('works with two items (alternates)', () => {
    const bag = new ShuffleBag(['A', 'B'], new Rng(1));
    let prev = bag.next();
    for (let i = 0; i < 50; i++) {
      const n = bag.next();
      expect(n).not.toBe(prev);
      prev = n;
    }
  });
});

describe('Pool', () => {
  it('pre-allocates, recycles and respects max', () => {
    let created = 0;
    const pool = new Pool(() => ({ id: created++ }), 3, 5);
    expect(pool.size).toBe(3);
    const a = pool.acquire()!;
    const b = pool.acquire()!;
    pool.release(a);
    const c = pool.acquire()!;
    expect(c).toBe(a); // recycled, not re-created
    for (let i = 0; i < 10; i++) pool.acquire();
    expect(pool.size).toBe(5);
    expect(pool.count).toBe(5);
    expect(pool.acquire()).toBeNull();
    pool.releaseAll();
    expect(pool.count).toBe(0);
    expect(b).toBeDefined();
  });
});

describe('EventBus', () => {
  it('delivers and unsubscribes', () => {
    const bus = new EventBus<{ ping: { n: number } }>();
    const got: number[] = [];
    const off = bus.on('ping', (e) => got.push(e.n));
    bus.emit('ping', { n: 1 });
    off();
    bus.emit('ping', { n: 2 });
    expect(got).toEqual([1]);
  });
});

describe('math', () => {
  it('collision and helpers', () => {
    expect(circlesOverlap(0, 0, 1, 1.5, 0, 0.6)).toBe(true);
    expect(circlesOverlap(0, 0, 1, 1.7, 0, 0.6)).toBe(false);
    expect(closestApproachTime(0, 0, 1, 0, 5, 3)).toBeCloseTo(5);
    expect(closestApproachTime(0, 0, 1, 0, -5, 0)).toBe(0);
    expect(Math.abs(wrapAngle(7))).toBeLessThanOrEqual(Math.PI);
    expect(damp(0, 10, 1000, 1)).toBeCloseTo(10);
  });

  it('Rng is deterministic per seed', () => {
    const a = new Rng(9);
    const b = new Rng(9);
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
    const w = new Rng(3);
    for (let i = 0; i < 200; i++) expect(w.weighted({ x: 0, y: 1, z: 0 })).toBe('y');
  });
});
