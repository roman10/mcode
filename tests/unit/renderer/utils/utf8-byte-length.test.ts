import { describe, it, expect } from 'vitest';
import { utf8ByteLength } from '../../../../src/renderer/utils/utf8-byte-length';

const fixtures: string[] = [
  '',
  'a',
  'hello world',
  'ASCII: !@#$%^&*()_+-=[]{}|;:,.<>?/`~',
  '\n\r\t\x00\x1b[31m',
  // 2-byte: Greek + Cyrillic
  'Καλημέρα',
  'Привет, мир',
  // 3-byte: CJK
  '안녕하세요',
  '你好世界',
  '日本語テスト',
  // 4-byte: emoji (surrogate pairs)
  '🚀',
  '😀😁😂',
  '👨‍👩‍👧‍👦',
  // Mixed
  'Hello, 世界! 🌍',
  'mcode 🔥 is 快 fast',
  // Long
  'x'.repeat(10_000),
  '日'.repeat(1_000),
  '🚀'.repeat(500),
];

const referenceEncoder = new TextEncoder();

describe('utf8ByteLength', () => {
  it.each(fixtures)('matches TextEncoder for: %s', (s) => {
    expect(utf8ByteLength(s)).toBe(referenceEncoder.encode(s).byteLength);
  });

  it('returns 0 for empty string', () => {
    expect(utf8ByteLength('')).toBe(0);
  });

  it('counts ASCII as 1 byte each', () => {
    expect(utf8ByteLength('abc')).toBe(3);
  });

  it('counts CJK as 3 bytes each', () => {
    expect(utf8ByteLength('日本')).toBe(6);
  });

  it('counts a single emoji surrogate pair as 4 bytes', () => {
    expect(utf8ByteLength('🚀')).toBe(4);
  });
});
