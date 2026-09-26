import { Rng } from './Rng';

/**
 * Shuffle bag that plays every item once per cycle and never repeats the same item
 * twice in a row (also across cycles): A → C → B → D → A ...
 */
export class ShuffleBag<T> {
  private bag: T[] = [];
  private last: T | undefined;

  constructor(
    private readonly items: readonly T[],
    private readonly rng: Rng = new Rng(),
  ) {
    if (items.length === 0) throw new Error('ShuffleBag needs at least one item');
  }

  next(): T {
    if (this.bag.length === 0) this.refill();
    const item = this.bag.pop() as T;
    this.last = item;
    return item;
  }

  peekLast(): T | undefined {
    return this.last;
  }

  private refill(): void {
    this.bag = this.items.slice();
    for (let i = this.bag.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng.next() * (i + 1));
      [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
    }
    // The next item popped is the last element: avoid an immediate repeat.
    const n = this.bag.length;
    if (n > 1 && this.bag[n - 1] === this.last) {
      [this.bag[n - 1], this.bag[0]] = [this.bag[0], this.bag[n - 1]];
    }
  }
}
