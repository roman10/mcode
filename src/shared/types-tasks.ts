// --- Task Queue ---

import type { PermissionMode } from './constants';

export type TaskStatus = 'pending' | 'dispatched' | 'completed' | 'failed';

/** Permission mode that a task can target via Shift+Tab cycling. Includes 'default' which is a valid cycle position. */
export type TaskPermissionMode = PermissionMode | 'default';

export interface PlanModeAction {
  exitPlanMode: boolean; // UI hint: true = proceed, false = revise
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
