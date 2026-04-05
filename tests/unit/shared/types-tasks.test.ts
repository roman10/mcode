import { describe, expect, it } from 'vitest';
import { normalizePlanModeAction } from '../../../src/shared/types-tasks';

describe('normalizePlanModeAction', () => {
  it('passes through new format unchanged', () => {
    expect(normalizePlanModeAction({ action: 'auto-accept' })).toEqual({ action: 'auto-accept' });
    expect(normalizePlanModeAction({ action: 'manual-approve' })).toEqual({ action: 'manual-approve' });
    expect(normalizePlanModeAction({ action: 'revise' })).toEqual({ action: 'revise' });
  });

  it('converts legacy exitPlanMode: true to auto-accept', () => {
    expect(normalizePlanModeAction({ exitPlanMode: true })).toEqual({ action: 'auto-accept' });
  });

  it('converts legacy exitPlanMode: false to revise', () => {
    expect(normalizePlanModeAction({ exitPlanMode: false })).toEqual({ action: 'revise' });
  });

  it('falls back to auto-accept for unknown shapes', () => {
    expect(normalizePlanModeAction({})).toEqual({ action: 'auto-accept' });
    expect(normalizePlanModeAction(null)).toEqual({ action: 'auto-accept' });
    expect(normalizePlanModeAction(undefined)).toEqual({ action: 'auto-accept' });
    expect(normalizePlanModeAction('garbage')).toEqual({ action: 'auto-accept' });
  });
});
