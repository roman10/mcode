import { describe, it, expect } from 'vitest';
import {
  AGENT_PERMISSION_MODES,
  DEFAULT_AGENT_PERMISSION_MODE,
  PERMISSION_MODE_LABELS,
  type PermissionMode,
} from '../../../src/shared/constants';

describe('AGENT_PERMISSION_MODES', () => {
  it('agy supports sandbox and skipPermissions, defaulting to skipPermissions', () => {
    expect(AGENT_PERMISSION_MODES.agy).toEqual(['sandbox', 'skipPermissions']);
    expect(DEFAULT_AGENT_PERMISSION_MODE.agy).toBe('skipPermissions');
  });

  it('every agent mode has a label', () => {
    for (const [agent, modes] of Object.entries(AGENT_PERMISSION_MODES)) {
      for (const mode of modes!) {
        expect(
          PERMISSION_MODE_LABELS[mode as PermissionMode],
          `${agent} mode "${mode}" is missing from PERMISSION_MODE_LABELS`,
        ).toBeDefined();
      }
    }
  });

  it('no two agents share the same mode constant except plan', () => {
    const seen = new Map<string, string>();
    for (const [agent, modes] of Object.entries(AGENT_PERMISSION_MODES)) {
      for (const mode of modes!) {
        if (mode === 'plan') continue; // Claude-only, but skip defensively
        expect(
          seen.has(mode),
          `mode "${mode}" appears in both ${seen.get(mode)} and ${agent}`,
        ).toBe(false);
        seen.set(mode, agent);
      }
    }
  });
});
