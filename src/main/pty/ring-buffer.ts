/**
 * Bounded UTF-8 ring buffer for PTY output.
 *
 * Backed by a Buffer of size 2*capacity. Append writes UTF-8 bytes to the
 * tail; when the buffer fills past 2*capacity, the last `capacity` bytes are
 * compacted to the head. Amortized append is O(chunk-length), not O(buffer)
 * — replacing the previous `existing + data; slice(-capacity)` pattern that
 * memcpy'd the full window on every chunk and stalled the main process under
 * sustained PTY output.
 *
 * Truncation unit is BYTES (UTF-8). The previous implementation truncated by
 * JS string length (UTF-16 code units); for ASCII-heavy ANSI streams the two
 * are identical, but bytes is more faithful to the memory budget for
 * multi-byte content.
 *
 * Multi-byte boundary on read: `Buffer.toString('utf8')` may decode a partial
 * leading code point as U+FFFD. Acceptable: at most the first 1–3 bytes of
 * the returned tail are affected, which is invisible inside an ANSI stream.
 *
 * Also tracks a per-instance monotonic byte offset (`currentOffset`) since
 * construction, used by `readSince(offset)` to serve delta replays.
 */
export class RingBuffer {
  private buf: Buffer;
  private len = 0;
  private streamOffset = 0;

  constructor(private readonly capacity: number) {
    this.buf = Buffer.allocUnsafe(capacity * 2);
  }

  append(chunk: string): void {
    const need = Buffer.byteLength(chunk, 'utf8');
    if (this.len + need > this.buf.length) {
      const keep = Math.min(this.len, this.capacity);
      this.buf.copy(this.buf, 0, this.len - keep, this.len);
      this.len = keep;
    }
    this.len += this.buf.write(chunk, this.len, 'utf8');
    this.streamOffset += need;
  }

  read(): string {
    const start = Math.max(0, this.len - this.capacity);
    return this.buf.toString('utf8', start, this.len);
  }

  /**
   * Decode and return up to the last `bytes` bytes of the readable window.
   * Same U+FFFD leading-boundary caveat as `read()` — a partial UTF-8
   * codepoint at the cut may decode to U+FFFD. For polling consumers
   * (permission-prompt / user-choice scans) this is invisible inside the
   * ANSI byte stream.
   *
   * Hot-path companion to `read()`: skips the full ~512 KB decode when only
   * the recent tail is needed.
   */
  readTail(bytes: number): string {
    if (bytes <= 0) return '';
    const window = Math.min(this.len, this.capacity);
    const take = Math.min(bytes, window);
    return this.buf.toString('utf8', this.len - take, this.len);
  }

  byteLength(): number {
    return Math.min(this.len, this.capacity);
  }

  currentOffset(): number {
    return this.streamOffset;
  }

  earliestOffset(): number {
    return this.streamOffset - this.byteLength();
  }

  /**
   * Bytes from `offset` (inclusive) to currentOffset, decoded UTF-8.
   * - `offset >= currentOffset`: returns empty data (caller is up to date).
   * - `offset < earliestOffset`: caller is behind the window — returns the
   *   full readable buffer with `dataStartOffset = earliestOffset` so the
   *   caller can detect the drop (`dataStartOffset > offset`).
   * - Otherwise: returns just the new bytes since `offset`, with
   *   `dataStartOffset === offset`.
   */
  readSince(offset: number): { data: string; dataStartOffset: number; currentOffset: number } {
    const earliest = this.earliestOffset();
    const current = this.streamOffset;
    if (offset >= current) {
      return { data: '', dataStartOffset: current, currentOffset: current };
    }
    if (offset < earliest) {
      return { data: this.read(), dataStartOffset: earliest, currentOffset: current };
    }
    const skipBytes = offset - earliest;
    const start = Math.max(0, this.len - this.capacity) + skipBytes;
    return {
      data: this.buf.toString('utf8', start, this.len),
      dataStartOffset: offset,
      currentOffset: current,
    };
  }
}
