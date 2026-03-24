// --- Task Queue ---

export type TaskStatus = 'pending' | 'dispatched' | 'completed' | 'failed';

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
}

export interface CreateTaskInput {
  prompt: string;
  cwd: string;
  targetSessionId?: string;
  priority?: number;
  scheduledAt?: string;
  maxRetries?: number;
  planModeAction?: PlanModeAction;
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
