/**
 * Generic object pool. Everything that appears often during a run (coins, meteors,
 * rocks, aliens, warnings, debris) is pre-allocated and recycled instead of being
 * created/destroyed every frame.
 */
export class Pool<T> {
  readonly active: T[] = [];
  private readonly free: T[] = [];
  private created = 0;

  constructor(
    private readonly factory: () => T,
    initial: number,
    readonly max: number = Infinity,
  ) {
    for (let i = 0; i < initial; i++) this.free.push(this.make());
  }

  get size(): number {
    return this.created;
  }

  get count(): number {
    return this.active.length;
  }

  /** Returns a recycled item, or null when the pool is exhausted. */
  acquire(): T | null {
    let item = this.free.pop();
    if (item === undefined) {
      if (this.created >= this.max) return null;
      item = this.make();
    }
    this.active.push(item);
    return item;
  }

  release(item: T): void {
    const i = this.active.indexOf(item);
    if (i < 0) return;
    const last = this.active.length - 1;
    if (i !== last) this.active[i] = this.active[last];
    this.active.pop();
    this.free.push(item);
  }

  releaseAll(onRelease?: (item: T) => void): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const item = this.active[i];
      onRelease?.(item);
      this.free.push(item);
    }
    this.active.length = 0;
  }

  private make(): T {
    this.created++;
    return this.factory();
  }
}
