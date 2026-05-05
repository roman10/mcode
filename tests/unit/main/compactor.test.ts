import { describe, it, expect } from 'vitest';
import { pickCompactorOrder, compact } from '../../../src/main/session/compactor';

describe('compactor.pickCompactorOrder', () => {
  it('lists the preferred CLI first when it has a known headless mode', () => {
    expect(pickCompactorOrder('claude')).toEqual(['claude', 'codex']);
    expect(pickCompactorOrder('codex')).toEqual(['codex', 'claude']);
  });

  it('falls back through the static order when preferred CLI has no headless mode', () => {
    // gemini and copilot are not in the headless map (yet)
    expect(pickCompactorOrder('gemini')).toEqual(['claude', 'codex']);
    expect(pickCompactorOrder('copilot')).toEqual(['claude', 'codex']);
  });

  it('returns the default order when no CLI is preferred', () => {
    expect(pickCompactorOrder(undefined)).toEqual(['claude', 'codex']);
  });
});

describe('compactor.compact', () => {
  it('rejects an empty transcript before spawning anything', async () => {
    await expect(compact({ transcript: '   ' })).rejects.toThrow(/empty/);
  });
});
