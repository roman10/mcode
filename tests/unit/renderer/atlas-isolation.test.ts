import { describe, it, expect } from 'vitest';
import {
  atlasIsolatedFontFamily,
  TERMINAL_FONT_FAMILY,
} from '../../../src/shared/constants';

/**
 * The WebGL texture-atlas corruption fix relies on each terminal getting a
 * unique `fontFamily` string (so `@xterm/addon-webgl`'s `configEquals` gives
 * every terminal a private atlas) while rendering identically (the unique
 * leading family is non-existent and skipped by CSS font fallback).
 */
describe('atlasIsolatedFontFamily', () => {
  it('produces a distinct family string per sessionId', () => {
    expect(atlasIsolatedFontFamily('aaa')).not.toBe(atlasIsolatedFontFamily('bbb'));
  });

  it('keeps the real font stack as the fallback suffix (identical rendering)', () => {
    const family = atlasIsolatedFontFamily('session-1');
    expect(family.endsWith(TERMINAL_FONT_FAMILY)).toBe(true);
  });

  it('quotes the unique leading family so the canvas font shorthand stays parseable', () => {
    const family = atlasIsolatedFontFamily('sess_42-AB');
    expect(family.startsWith('"mcode-atlas-sess_42-AB", ')).toBe(true);
  });

  it('sanitizes unsafe characters out of the sessionId token', () => {
    const family = atlasIsolatedFontFamily('a/b c"."d');
    // Only [A-Za-z0-9_-] survive in the token; quote/space/slash/dot stripped.
    expect(family.startsWith('"mcode-atlas-abcd", ')).toBe(true);
    // Still a single valid family before the first comma, then the real stack.
    expect(family).toBe(`"mcode-atlas-abcd", ${TERMINAL_FONT_FAMILY}`);
  });

  it('falls back to a stable token when the sessionId has no safe characters', () => {
    expect(atlasIsolatedFontFamily('/// ""')).toBe(
      `"mcode-atlas-default", ${TERMINAL_FONT_FAMILY}`,
    );
  });
});
