import { describe, it, expect } from 'vitest';
import { LruMap } from '../../../src/main/lru-map';

describe('LruMap', () => {
  it('rejects non-positive max', () => {
    expect(() => new LruMap<string, number>(0)).toThrow();
    expect(() => new LruMap<string, number>(-1)).toThrow();
  });

  it('stores and retrieves values like a Map', () => {
    const lru = new LruMap<string, number>(3);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1);
    expect(lru.get('b')).toBe(2);
    expect(lru.has('a')).toBe(true);
    expect(lru.size).toBe(2);
  });

  it('evicts the least-recently-used entry when over capacity', () => {
    const lru = new LruMap<string, number>(3);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    lru.set('d', 4); // evicts 'a'
    expect(lru.has('a')).toBe(false);
    expect(lru.has('b')).toBe(true);
    expect(lru.has('c')).toBe(true);
    expect(lru.has('d')).toBe(true);
    expect(lru.size).toBe(3);
  });

  it('promotes an entry to MRU on get', () => {
    const lru = new LruMap<string, number>(3);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    // Access 'a' so it becomes most-recently used; next eviction should drop 'b'.
    expect(lru.get('a')).toBe(1);
    lru.set('d', 4);
    expect(lru.has('a')).toBe(true);
    expect(lru.has('b')).toBe(false);
  });

  it('promotes an entry to MRU on re-set with the same key', () => {
    const lru = new LruMap<string, number>(3);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.set('c', 3);
    lru.set('a', 99); // refresh 'a'
    lru.set('d', 4); // evicts 'b'
    expect(lru.get('a')).toBe(99);
    expect(lru.has('b')).toBe(false);
  });

  it('clear() empties the map', () => {
    const lru = new LruMap<string, number>(3);
    lru.set('a', 1);
    lru.set('b', 2);
    lru.clear();
    expect(lru.size).toBe(0);
    expect(lru.has('a')).toBe(false);
  });

  it('delete() removes the entry', () => {
    const lru = new LruMap<string, number>(3);
    lru.set('a', 1);
    expect(lru.delete('a')).toBe(true);
    expect(lru.delete('a')).toBe(false);
    expect(lru.size).toBe(0);
  });
});
