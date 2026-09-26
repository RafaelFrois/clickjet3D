export type Listener<T> = (payload: T) => void;

/**
 * Minimal typed publish/subscribe bus. Systems talk through it so gameplay code
 * never has to know about UI, audio or particles directly.
 */
export class EventBus<Events extends object> {
  private listeners = new Map<keyof Events, Listener<never>[]>();

  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    let list = this.listeners.get(type);
    if (!list) {
      list = [];
      this.listeners.set(type, list);
    }
    list.push(fn as Listener<never>);
    return () => this.off(type, fn);
  }

  off<K extends keyof Events>(type: K, fn: Listener<Events[K]>): void {
    const list = this.listeners.get(type);
    if (!list) return;
    const i = list.indexOf(fn as Listener<never>);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.listeners.get(type);
    if (!list) return;
    for (let i = 0; i < list.length; i++) (list[i] as Listener<Events[K]>)(payload);
  }

  clear(): void {
    this.listeners.clear();
  }
}
