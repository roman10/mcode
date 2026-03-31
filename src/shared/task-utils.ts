import type { SessionInfo } from './types';
import type { TaskPermissionMode } from './types-tasks';
import { PERMISSION_MODE_LABELS } from './constants';

/**
 * Build the Shift+Tab cycle order for a given session.
 * Docs: default → acceptEdits → plan → [bypassPermissions] → [auto] → wrap
 */
export function buildModeCycle(session: SessionInfo): string[] {
  const cycle: string[] = ['default', 'acceptEdits', 'plan'];
  if (session.permissionMode === 'bypassPermissions' || session.allowBypassPermissions) {
    cycle.push('bypassPermissions');
  }
  if (session.enableAutoMode) {
    cycle.push('auto');
  }
  return cycle;
}

/** Human-readable labels for task permission modes. */
export const TASK_PERMISSION_MODE_LABELS: Record<TaskPermissionMode, string> = {
  default: 'Default',
  ...PERMISSION_MODE_LABELS,
};
