import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../../../src/main/pty/ring-buffer';

describe('RingBuffer', () => {
  describe('append + read', () => {
    it('reads back what was written below capacity', () => {
      const rb = new RingBuffer(1024);
      rb.append('hello ');
      rb.append('world');
      expect(rb.read()).toBe('hello world');
    });

    it('truncates to last `capacity` bytes when over', () => {
      const rb = new RingBuffer(8);
      rb.append('abcdef');
      rb.append('ghij');
      // 10 ASCII bytes total, capacity 8 → last 8: 'cdefghij'
      expect(rb.read()).toBe('cdefghij');
      expect(rb.byteLength()).toBe(8);
    });

    it('handles a single chunk larger than capacity', () => {
      const rb = new RingBuffer(8);
      rb.append('1234567890ABCDEF'); // 16 bytes — exactly fills capacity*2
      // No compaction yet (0 + 16 == 16, not >). read() returns last 8 bytes.
      expect(rb.read()).toBe('90ABCDEF');
      expect(rb.byteLength()).toBe(8);
      // The next append forces compaction.
      rb.append('!');
      expect(rb.read()).toBe('0ABCDEF!');
    });

    it('keeps tail correct across many compactions', () => {
      const rb = new RingBuffer(16);
      // Repeatedly append small chunks to exercise the compaction path.
      for (let i = 0; i < 100; i++) {
        rb.append('x'.repeat(5));
      }
      // Total 500 bytes; tail of 16 is all 'x'.
      expect(rb.read()).toBe('x'.repeat(16));
      expect(rb.byteLength()).toBe(16);
    });

    it('returns empty string when nothing appended', () => {
      const rb = new RingBuffer(1024);
      expect(rb.read()).toBe('');
      expect(rb.byteLength()).toBe(0);
    });
  });

  describe('currentOffset / earliestOffset', () => {
    it('tracks bytes since construction (UTF-8 byteLength)', () => {
      const rb = new RingBuffer(64);
      rb.append('abc');         // 3 bytes
      rb.append('日本語');       // 9 UTF-8 bytes (3 chars × 3 bytes)
      expect(rb.currentOffset()).toBe(12);
      expect(rb.earliestOffset()).toBe(0);
    });

    it('earliestOffset advances as the window slides', () => {
      const rb = new RingBuffer(8);
      rb.append('abcdefgh'); // exactly fills capacity
      expect(rb.earliestOffset()).toBe(0);
      rb.append('ij');       // 2 bytes drop off the front
      expect(rb.currentOffset()).toBe(10);
      expect(rb.earliestOffset()).toBe(2);
    });
  });

  describe('readSince', () => {
    it('returns delta when offset is within the window', () => {
      const rb = new RingBuffer(64);
      rb.append('abcdef');
      const snap = rb.currentOffset(); // 6
      rb.append('ghij');                // adds 4 bytes
      const r = rb.readSince(snap);
      expect(r.data).toBe('ghij');
      expect(r.dataStartOffset).toBe(snap);
      expect(r.currentOffset).toBe(10);
    });

    it('returns empty data when caller is up to date', () => {
      const rb = new RingBuffer(64);
      rb.append('abcdef');
      const r = rb.readSince(rb.currentOffset());
      expect(r.data).toBe('');
      expect(r.dataStartOffset).toBe(6);
      expect(r.currentOffset).toBe(6);
    });

    it('signals a drop by returning full buffer with dataStartOffset > offset', () => {
      const rb = new RingBuffer(8);
      rb.append('abcdefgh');   // offset 0..8
      rb.append('ijklmnop');   // 8 more bytes, earliest is now 8
      // Caller asking from offset 0 has been dropped from the window.
      const r = rb.readSince(0);
      expect(r.dataStartOffset).toBe(8);
      expect(r.currentOffset).toBe(16);
      expect(r.data).toBe('ijklmnop');
      expect(r.dataStartOffset).toBeGreaterThan(0);
    });

    it('handles offset > currentOffset gracefully (clock-skew style edge)', () => {
      const rb = new RingBuffer(64);
      rb.append('hi');
      const r = rb.readSince(999999);
      expect(r.data).toBe('');
      expect(r.dataStartOffset).toBe(2);
      expect(r.currentOffset).toBe(2);
    });

    it('serves an exact-boundary delta when offset === earliestOffset', () => {
      const rb = new RingBuffer(8);
      rb.append('abcdefgh');
      rb.append('ijkl'); // earliest is now 4
      const r = rb.readSince(4);
      expect(r.dataStartOffset).toBe(4);
      expect(r.currentOffset).toBe(12);
      expect(r.data).toBe('efghijkl');
    });
  });

  describe('readTail', () => {
    it('returns empty string when nothing appended', () => {
      const rb = new RingBuffer(1024);
      expect(rb.readTail(2000)).toBe('');
    });

    it('returns the whole buffer when bytes >= len', () => {
      const rb = new RingBuffer(1024);
      rb.append('hello world');
      expect(rb.readTail(2000)).toBe('hello world');
      expect(rb.readTail(11)).toBe('hello world');
    });

    it('returns exactly the last N bytes when bytes < len (ASCII)', () => {
      const rb = new RingBuffer(1024);
      rb.append('abcdefghij'); // 10 ASCII bytes
      expect(rb.readTail(4)).toBe('ghij');
      expect(rb.readTail(1)).toBe('j');
    });

    it('matches read() when bytes >= capacity', () => {
      const rb = new RingBuffer(16);
      rb.append('x'.repeat(40));
      expect(rb.readTail(16)).toBe(rb.read());
      expect(rb.readTail(1024)).toBe(rb.read());
    });

    it('caps at the capacity window after compaction', () => {
      const rb = new RingBuffer(8);
      // Force compaction: fill buf (capacity*2 = 16 bytes), then append more.
      rb.append('ABCDEFGHIJKLMNOP'); // len 16, no compaction yet
      rb.append('QRST');             // triggers compaction: keep last 8 → 'IJKLMNOP', then write 'QRST'
      // Readable window now: 'MNOPQRST' (last 8 of the logical stream).
      expect(rb.read()).toBe('MNOPQRST');
      // readTail(100) must not exceed the readable window.
      expect(rb.readTail(100)).toBe('MNOPQRST');
      expect(rb.readTail(100).length).toBe(8);
      // readTail(4) returns the exact tail of the window.
      expect(rb.readTail(4)).toBe('QRST');
    });

    it('returns empty when bytes <= 0', () => {
      const rb = new RingBuffer(1024);
      rb.append('abc');
      expect(rb.readTail(0)).toBe('');
      expect(rb.readTail(-5)).toBe('');
    });

    it('decodes a UTF-8 boundary cut to a replacement char without throwing', () => {
      const rb = new RingBuffer(1024);
      rb.append('日本語'); // 9 bytes (3 chars × 3 bytes)
      // Cut 5 bytes from the end — lands inside the middle codepoint.
      // Should not throw and should be valid UTF-16 (replacement char acceptable
      // for any partial leading codepoint).
      const tail = rb.readTail(5);
      expect(typeof tail).toBe('string');
      // The last full codepoint must still be present.
      expect(tail.endsWith('語')).toBe(true);
    });
  });

  describe('memory profile', () => {
    it('byteLength stays bounded under sustained appends', () => {
      const rb = new RingBuffer(1024);
      for (let i = 0; i < 1000; i++) {
        rb.append('z'.repeat(100));
      }
      expect(rb.byteLength()).toBe(1024);
      expect(rb.read().length).toBe(1024);
    });
  });
});
