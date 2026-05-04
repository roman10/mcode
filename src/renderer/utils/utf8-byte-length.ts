/**
 * Counts UTF-8 byte length of a string without allocating.
 *
 * Matches `new TextEncoder().encode(s).byteLength` for any well-formed JS
 * string. Used on the per-chunk pty.onData hot path to advance the renderer's
 * byteOffset mirror without producing a Uint8Array per chunk.
 *
 * Lone surrogates would diverge from TextEncoder (which emits the U+FFFD
 * replacement, 3 bytes), but PTY data arrives via JSON.parse which rejects
 * malformed UTF-16, so this case is unreachable in practice.
 */
export function utf8ByteLength(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { bytes += 4; i++; } // surrogate pair → 4 bytes
    else bytes += 3;
  }
  return bytes;
}
