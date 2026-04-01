import { describe, it, expect } from 'vitest';
import {
  AGENT_PERMISSION_MODES,
  PERMISSION_MODE_LABELS,
  type PermissionMode,
} from '../../../src/shared/constants';

describe('AGENT_PERMISSION_MODES', () => {
  it('gemini supports plan, autoEdit, and yolo', () => {
    expect(AGENT_PERMISSION_MODES.gemini).toEqual(['plan', 'autoEdit', 'yolo']);
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
        if (mode === 'plan') continue; // shared between Claude and Gemini
        expect(
          seen.has(mode),
          `mode "${mode}" appears in both ${seen.get(mode)} and ${agent}`,
        ).toBe(false);
        seen.set(mode, agent);
      }
    }
  });
});
