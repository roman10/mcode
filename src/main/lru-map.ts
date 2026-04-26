/**
 * Minimal LRU cache built on top of Map's insertion-order guarantees.
 *
 * Trade-offs vs the lru-cache npm package: no TTL, no size-based eviction,
 * no async loaders. We don't need any of those — this exists only to bound
 * the unbounded path/string caches in trackers (commit-tracker.ts etc.) so
 * the main process doesn't grow forever as the user touches new repos.
 */
export class LruMap<K, V> {
  private readonly max: number;
  private readonly map = new Map<K, V>();

  constructor(max: number) {
    if (max <= 0) throw new Error('LruMap max must be > 0');
    this.max = max;
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Mark as most-recently-used by re-inserting.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      // Map iteration is insertion order; first key is the oldest.
      const oldest = this.map.keys().next().value as K | undefined;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  delete(key: K): boolean {
    return this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}
