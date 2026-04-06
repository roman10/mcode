import { useState, useMemo } from 'react';
import { ChevronUp, ChevronDown, Pencil, TimerOff, X } from 'lucide-react';
import { useTaskStore } from '../../stores/task-store';
import { useSessionStore } from '../../stores/session-store';
import { useDialogStore } from '../../stores/dialog-store';
import type { Task, TaskStatus } from '@shared/types';
import Tooltip from '../shared/Tooltip';

const statusColors: Record<TaskStatus, string> = {
  pending: 'bg-amber-400',
  dispatched: 'bg-green-400',
  completed: 'bg-blue-400',
  failed: 'bg-red-400',
};

interface TileTaskItemProps {
  task: Task;
  isFirst: boolean;
  isLast: boolean;
}

function TileTaskItem({ task, isFirst, isLast }: TileTaskItemProps): React.JSX.Element {
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const reorderTask = useTaskStore((s) => s.reorderTask);
  const openCreateTaskDialog = useDialogStore((s) => s.openCreateTaskDialog);

  const promptPreview =
    task.prompt.length > 80 ? task.prompt.slice(0, 77) + '...' : task.prompt;

  const isPending = task.status === 'pending';

  return (
    <div className="px-3 py-1.5 border-b border-border-default/50 group hover:bg-bg-elevated/50 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <Tooltip
          content={isPending ? 'Queued' : 'Running'}
          side="right"
        >
          <span
            className={`shrink-0 w-2 h-2 rounded-full ${statusColors[task.status]}`}
          />
        </Tooltip>
        {task.planModeAction != null && (
          <span className={`text-xs shrink-0 ${
            task.planModeAction.action === 'auto-accept' ? 'text-green-400' :
            task.planModeAction.action === 'manual-approve' ? 'text-blue-400' :
            'text-amber-400'
          }`}>
            {task.planModeAction.action === 'auto-accept' ? 'Auto-accept:' :
             task.planModeAction.action === 'manual-approve' ? 'Manual:' :
             'Revise:'}
          </span>
        )}
        <span
          className="text-xs text-text-primary truncate flex-1"
          title={task.prompt}
        >
          {promptPreview}
        </span>
        {isPending && (
          <div className="flex items-center gap-0.5 opacity-40 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
            {!isFirst && (
              <button
                className="text-text-muted hover:text-text-primary p-0.5 transition-colors"
                onClick={() => reorderTask(task.id, 'up').catch(() => {})}
                title="Move up"
              >
                <ChevronUp size={12} strokeWidth={1.5} />
              </button>
            )}
            {!isLast && (
              <button
                className="text-text-muted hover:text-text-primary p-0.5 transition-colors"
                onClick={() => reorderTask(task.id, 'down').catch(() => {})}
                title="Move down"
              >
                <ChevronDown size={12} strokeWidth={1.5} />
              </button>
            )}
            <button
              className="text-text-muted hover:text-text-primary p-0.5 transition-colors"
              onClick={() => openCreateTaskDialog({ editTask: task })}
              title="Edit task"
            >
              <Pencil size={12} strokeWidth={1.5} />
            </button>
            <button
              className="text-text-muted hover:text-red-400 p-0.5 transition-colors"
              onClick={() => cancelTask(task.id).catch(() => {})}
              title="Delete task"
            >
              <X size={12} strokeWidth={1.5} />
            </button>
          </div>
        )}
        {!isPending && (
          <span className="text-xs text-green-400 shrink-0">
            Running
          </span>
        )}
      </div>
      {(task.scheduledAt || task.retryCount > 0) && (
        <div className="flex items-center gap-2 mt-0.5 ml-4">
          {task.scheduledAt && task.status === 'pending' && (
            <span className="text-xs text-text-muted">scheduled</span>
          )}
          {task.retryCount > 0 && (
            <span className="text-xs text-text-muted">
              retry {task.retryCount}/{task.maxRetries}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

interface TileTaskPanelProps {
  sessionId: string;
}

function TileTaskPanel({
  sessionId,
}: TileTaskPanelProps): React.JSX.Element | null {
  const tasks = useTaskStore((s) => s.tasks);
  const session = useSessionStore((s) => s.sessions[sessionId]);
  const openCreateTaskDialog = useDialogStore((s) => s.openCreateTaskDialog);
  const [expanded, setExpanded] = useState(true);

  const sessionTasks = useMemo(
    () =>
      Object.values(tasks)
        .filter(
          (t) =>
            t.targetSessionId === sessionId &&
            (t.status === 'pending' || t.status === 'dispatched'),
        )
        .sort((a, b) => {
          // dispatched first, then pending
          if (a.status !== b.status)
            return a.status === 'dispatched' ? -1 : 1;
          // by sort_order when available
          if (a.sortOrder != null && b.sortOrder != null)
            return a.sortOrder - b.sortOrder;
          // fallback: higher priority first, then older first
          if (a.priority !== b.priority) return b.priority - a.priority;
          return a.createdAt.localeCompare(b.createdAt);
        }),
    [tasks, sessionId],
  );

  const pendingTasks = useMemo(
    () => sessionTasks.filter((t) => t.status === 'pending'),
    [sessionTasks],
  );

  // Show the plan mode banner when the session is waiting for a user-choice menu
  // (attentionReason "Waiting for your response") and no plan mode task is queued yet
  const isInPlanMode =
    session?.status === 'waiting' &&
    session?.attentionReason === 'Waiting for your response';

  const hasPlanModeTask = sessionTasks.some((t) => t.planModeAction !== null);

  const showPlanModeBanner = isInPlanMode && !hasPlanModeTask;

  if (sessionTasks.length === 0 && !showPlanModeBanner) return null;

  return (
    <>
      <div className="border-b border-border-default bg-bg-secondary shrink-0">
        {/* Plan mode banner */}
        {showPlanModeBanner && (
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-default/50 bg-red-950/20">
            <span className="text-xs text-red-400">Needs response</span>
            <button
              className="text-xs text-red-400 hover:text-red-300 transition-colors"
              onClick={() => openCreateTaskDialog({ taskType: 'planResponse', targetSessionId: sessionId, cwd: session?.cwd })}
            >
              Queue response ›
            </button>
          </div>
        )}

        {/* Task list */}
        {sessionTasks.length > 0 && (
          <>
            <div
              className="flex items-center h-6 px-3 cursor-pointer hover:bg-bg-elevated/50 transition-colors"
              onClick={() => setExpanded(!expanded)}
            >
              <span className="text-xs text-text-muted mr-1.5">
                {expanded ? '\u25BC' : '\u25B6'}
              </span>
              <span className="text-xs text-text-secondary font-medium mr-1.5">
                Tasks
              </span>
              <span className="text-xs bg-bg-elevated text-text-muted px-1 rounded">
                {sessionTasks.length} queued
              </span>
              {session?.autoClose && (
                <span className="ml-1.5 flex items-center gap-0.5 text-xs text-accent">
                  <TimerOff size={10} strokeWidth={1.5} />
                  <span>auto-close</span>
                </span>
              )}
            </div>
            {expanded && (
              <div className="max-h-32 overflow-y-auto">
                {sessionTasks.map((task) => {
                  const pendingIndex = pendingTasks.indexOf(task);
                  return (
                    <TileTaskItem
                      key={task.id}
                      task={task}
                      isFirst={pendingIndex <= 0}
                      isLast={pendingIndex === -1 || pendingIndex === pendingTasks.length - 1}
                    />
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

    </>
  );
}

export default TileTaskPanel;
