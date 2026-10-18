/**
 * The snapshot plumbing the watch page's controllers share: one immutable
 * snapshot, replaced on every change, read by React through
 * useSyncExternalStore. Writes after `close()` are dropped, so a controller
 * disposed under StrictMode's first mount can't repaint the second.
 */
import { useSyncExternalStore } from "react";

export class Store<T extends object> {
  private snap: T;
  private listeners = new Set<() => void>();
  private closed = false;

  constructor(initial: T) {
    this.snap = initial;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): T => this.snap;

  get state(): T {
    return this.snap;
  }

  set(patch: Partial<T>): void {
    if (this.closed) return;
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  close(): void {
    this.closed = true;
    this.listeners.clear();
  }
}

const noopSubscribe = (): (() => void) => () => {};

/** A store's snapshot, or `fallback` while there is no store yet. */
export function useStore<T extends object>(store: Store<T> | null | undefined, fallback: T): T {
  return useSyncExternalStore(store ? store.subscribe : noopSubscribe, store ? store.getSnapshot : () => fallback);
}
