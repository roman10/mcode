import { describe, it, expect } from 'vitest';
import {
  getTokenAtCursor,
  filterByPrefixThenIncludes,
} from '../../../../src/renderer/utils/autocomplete-utils';

// ---------------------------------------------------------------------------
// getTokenAtCursor
// ---------------------------------------------------------------------------

describe('getTokenAtCursor', () => {
  it('returns null for empty string', () => {
    expect(getTokenAtCursor('', 0, '@')).toBeNull();
  });

  it('finds @ at start of text', () => {
    expect(getTokenAtCursor('@foo', 4, '@')).toEqual({
      trigger: '@',
      query: 'foo',
      startIndex: 0,
      endIndex: 4,
    });
  });

  it('finds @ with empty query', () => {
    expect(getTokenAtCursor('@', 1, '@')).toEqual({
      trigger: '@',
      query: '',
      startIndex: 0,
      endIndex: 1,
    });
  });

  it('finds @ after space', () => {
    expect(getTokenAtCursor('hello @wo', 9, '@')).toEqual({
      trigger: '@',
      query: 'wo',
      startIndex: 6,
      endIndex: 9,
    });
  });

  it('finds @ after newline', () => {
    expect(getTokenAtCursor('line1\n@path', 11, '@')).toEqual({
      trigger: '@',
      query: 'path',
      startIndex: 6,
      endIndex: 11,
    });
  });

  it('finds @ with empty query after space', () => {
    expect(getTokenAtCursor('hello @', 7, '@')).toEqual({
      trigger: '@',
      query: '',
      startIndex: 6,
      endIndex: 7,
    });
  });

  it('returns null when @ is mid-word (email)', () => {
    expect(getTokenAtCursor('email@host', 10, '@')).toBeNull();
  });

  it('returns null when cursor is before the token', () => {
    expect(getTokenAtCursor('hello @foo', 5, '@')).toBeNull();
  });

  it('returns null when cursor is in whitespace after token', () => {
    expect(getTokenAtCursor('@foo bar', 5, '@')).toBeNull();
  });

  it('returns null when cursor is at position 0', () => {
    expect(getTokenAtCursor('@foo', 0, '@')).toBeNull();
  });

  it('finds / trigger at position 0', () => {
    expect(getTokenAtCursor('/cmd', 4, '/')).toEqual({
      trigger: '/',
      query: 'cmd',
      startIndex: 0,
      endIndex: 4,
    });
  });

  it('finds / trigger after space', () => {
    expect(getTokenAtCursor('text /cmd', 9, '/')).toEqual({
      trigger: '/',
      query: 'cmd',
      startIndex: 5,
      endIndex: 9,
    });
  });

  it('handles cursor in the middle of a token', () => {
    // cursor at position 3 → "hel" but trigger @ is at 6
    expect(getTokenAtCursor('hello @foo', 3, '@')).toBeNull();
  });

  it('finds token when cursor is mid-token', () => {
    // typing @fo and cursor is right after the o
    expect(getTokenAtCursor('fix @fo bug', 7, '@')).toEqual({
      trigger: '@',
      query: 'fo',
      startIndex: 4,
      endIndex: 7,
    });
  });

  it('returns null for non-matching trigger', () => {
    expect(getTokenAtCursor('@foo', 4, '/')).toBeNull();
  });

  it('handles multiple @ tokens — picks the one at cursor', () => {
    expect(getTokenAtCursor('@first @second', 14, '@')).toEqual({
      trigger: '@',
      query: 'second',
      startIndex: 7,
      endIndex: 14,
    });
  });

  it('handles tab-preceded trigger', () => {
    expect(getTokenAtCursor('hello\t@file', 11, '@')).toEqual({
      trigger: '@',
      query: 'file',
      startIndex: 6,
      endIndex: 11,
    });
  });
});

// ---------------------------------------------------------------------------
// filterByPrefixThenIncludes
// ---------------------------------------------------------------------------

describe('filterByPrefixThenIncludes', () => {
  const items = ['apple', 'banana', 'avocado', 'pineapple', 'grape'];
  const getText = (s: string): string => s;

  it('returns all items for empty query', () => {
    expect(filterByPrefixThenIncludes(items, '', getText)).toEqual(items);
  });

  it('returns prefix matches when they exist', () => {
    expect(filterByPrefixThenIncludes(items, 'a', getText)).toEqual([
      'apple',
      'avocado',
    ]);
  });

  it('falls back to includes when no prefix match', () => {
    expect(filterByPrefixThenIncludes(items, 'nana', getText)).toEqual([
      'banana',
    ]);
  });

  it('is case-insensitive', () => {
    expect(filterByPrefixThenIncludes(items, 'A', getText)).toEqual([
      'apple',
      'avocado',
    ]);
  });

  it('returns empty array when nothing matches', () => {
    expect(filterByPrefixThenIncludes(items, 'xyz', getText)).toEqual([]);
  });

  it('preserves original order', () => {
    expect(filterByPrefixThenIncludes(items, 'ap', getText)).toEqual([
      'apple',
    ]);
  });

  it('works with custom getText function', () => {
    const objects = [
      { name: 'alpha', id: 1 },
      { name: 'beta', id: 2 },
      { name: 'gamma', id: 3 },
    ];
    expect(
      filterByPrefixThenIncludes(objects, 'bet', (o) => o.name),
    ).toEqual([{ name: 'beta', id: 2 }]);
  });

  it('prefers prefix over includes matches', () => {
    // "grape" includes "ap" but "apple" starts with "ap"
    // Since prefix match exists, only prefix matches are returned
    const result = filterByPrefixThenIncludes(items, 'ap', getText);
    expect(result).toEqual(['apple']);
    expect(result).not.toContain('grape');
  });
});
