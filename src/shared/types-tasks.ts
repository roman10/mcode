// --- Task Queue ---

import type { PermissionMode } from './constants';

export type TaskStatus = 'pending' | 'dispatched' | 'completed' | 'failed';

/** Permission mode that a task can target via Shift+Tab cycling. Includes 'default' which is a valid cycle position. */
export type TaskPermissionMode = PermissionMode | 'default';

export type PlanModeActionType = 'auto-accept' | 'manual-approve' | 'revise';

export interface PlanModeAction {
  action: PlanModeActionType;
}

/** Normalize legacy `{ exitPlanMode: boolean }` DB records to current format. */
export function normalizePlanModeAction(raw: unknown): PlanModeAction {
  if (raw && typeof raw === 'object' && 'action' in raw) return raw as PlanModeAction;
  if (raw && typeof raw === 'object' && 'exitPlanMode' in raw) {
    return { action: (raw as { exitPlanMode: boolean }).exitPlanMode ? 'auto-accept' : 'revise' };
  }
  return { action: 'auto-accept' };
}

export interface Task {
  id: number;
  prompt: string;
  cwd: string;
  targetSessionId: string | null;
  sessionId: string | null;
  status: TaskStatus;
  priority: number;
  scheduledAt: string | null;
  createdAt: string;
  dispatchedAt: string | null;
  completedAt: string | null;
  retryCount: number;
  maxRetries: number;
  error: string | null;
  planModeAction: PlanModeAction | null;
  sortOrder: number | null;
  permissionMode: TaskPermissionMode | null;
}

export interface CreateTaskInput {
  prompt: string;
  cwd: string;
  targetSessionId?: string;
  priority?: number;
  scheduledAt?: string;
  maxRetries?: number;
  planModeAction?: PlanModeAction;
  permissionMode?: TaskPermissionMode;
}

export interface UpdateTaskInput {
  prompt?: string;
  priority?: number;
  scheduledAt?: string | null;
  planModeAction?: PlanModeAction | null;
}

export interface TaskFilter {
  statuses?: TaskStatus[];
  targetSessionId?: string;
  limit?: number;
}

export type TaskChangeEvent =
  | { type: 'upsert'; task: Task }
  | { type: 'remove'; taskId: number }
  | { type: 'refresh' };
