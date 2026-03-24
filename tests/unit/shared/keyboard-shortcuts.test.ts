import { describe, it, expect } from 'vitest';
import { KEYBOARD_SHORTCUTS } from '../../../src/shared/keyboard-shortcuts';

describe('keyboard-shortcuts registry', () => {
  it('contains Toggle Terminal Panel entry', () => {
    const entry = KEYBOARD_SHORTCUTS.find((s) => s.label === 'Toggle Terminal Panel');
    expect(entry).toBeDefined();
    expect(entry!.keys).toBe('Ctrl+`');
    expect(entry!.mod).toBe(false);
    expect(entry!.category).toBe('general');
  });

  it('has no duplicate label+keys within the same category', () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const s of KEYBOARD_SHORTCUTS) {
      const key = `${s.category}:${s.label}:${s.keys}`;
      if (seen.has(key)) duplicates.push(key);
      seen.add(key);
    }
    expect(duplicates).toEqual([]);
  });
});
