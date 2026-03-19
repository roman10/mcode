import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTaskStore } from '../../stores/task-store';
import { useSessionStore } from '../../stores/session-store';
import type { TaskStatus, Task, CreateTaskInput } from '../../../shared/types';
import Tooltip from '../shared/Tooltip';
import CreateTaskDialog from '../shared/CreateTaskDialog';

const statusColors: Record<TaskStatus, string> = {
  pending: 'bg-amber-400',
  dispatched: 'bg-green-400',
  completed: 'bg-blue-400',
  failed: 'bg-red-400',
};

const statusLabels: Record<TaskStatus, string> = {
  pending: 'Queued',
  dispatched: 'Running',
  completed: 'Done',
  failed: 'Failed',
};

function TaskItem({ task }: { task: Task }): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const targetLabel = task.targetSessionId
    ? (sessions[task.targetSessionId]?.label ?? task.targetSessionId.slice(0, 8))
    : 'New session';

  const promptPreview = task.prompt.length > 60
    ? task.prompt.slice(0, 57) + '...'
    : task.prompt;

  return (
    <div className="px-3 py-1.5 border-b border-border-default/50 group hover:bg-bg-elevated/50 transition-colors">
      <div className="flex items-center gap-2 min-w-0">
        <Tooltip content={`${statusLabels[task.status]}${task.error ? ` — ${task.error}` : ''}`} side="right">
          <span className={`shrink-0 w-2 h-2 rounded-full ${statusColors[task.status]}`} />
        </Tooltip>
        <span className="text-xs text-text-primary truncate flex-1" title={task.prompt}>
          {promptPreview}
        </span>
        {task.status === 'pending' && (
          <button
            className="text-xs text-text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={() => cancelTask(task.id).catch(() => {})}
            title="Cancel task"
          >
            x
          </button>
        )}
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="text-[10px] text-text-muted truncate">
          {targetLabel}
        </span>
        {task.scheduledAt && task.status === 'pending' && (
          <span className="text-[10px] text-text-muted">
            scheduled
          </span>
        )}
        {task.retryCount > 0 && (
          <span className="text-[10px] text-text-muted">
            retry {task.retryCount}/{task.maxRetries}
          </span>
        )}
      </div>
    </div>
  );
}

function TaskQueuePanel(): React.JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const tasks = useTaskStore((s) => s.tasks);
  const addTask = useTaskStore((s) => s.addTask);
  const hookRuntime = useSessionStore((s) => s.hookRuntime);

  const taskList = Object.values(tasks).sort((a, b) => {
    // Active tasks first (dispatched), then pending, then completed/failed
    const statusOrder: Record<TaskStatus, number> = { dispatched: 0, pending: 1, failed: 2, completed: 3 };
    const statusDiff = statusOrder[a.status] - statusOrder[b.status];
    if (statusDiff !== 0) return statusDiff;
    // Within same status: higher priority first, then older first
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.createdAt.localeCompare(b.createdAt);
  });

  const activeCount = taskList.filter((t) => t.status === 'pending' || t.status === 'dispatched').length;
  const isDegraded = hookRuntime.state !== 'ready';

  const handleCreateTask = async (input: CreateTaskInput): Promise<void> => {
    try {
      await addTask(input);
      setShowCreateDialog(false);
    } catch (err) {
      console.error('Failed to create task:', err);
      setShowCreateDialog(false);
    }
  };

  if (taskList.length === 0 && !expanded) {
    return <></>;
  }

  return (
    <>
      <div className="border-t border-border-default">
        <div
          className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-bg-elevated/50 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-text-muted">{expanded ? '\u25BC' : '\u25B6'}</span>
            <span className="text-xs text-text-secondary font-medium">Tasks</span>
            <span className="text-[10px] bg-bg-elevated text-text-muted px-1 rounded">
              {activeCount} active
            </span>
          </div>
          <Tooltip content="New task (⌘⇧T)" side="right">
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                setShowCreateDialog(true);
              }}
            >
              <Plus size={14} strokeWidth={1.5} />
            </button>
          </Tooltip>
        </div>

        {expanded && (
          <div className="max-h-48 overflow-y-auto">
            {isDegraded && (
              <div className="px-3 py-1.5 text-[10px] text-amber-300">
                Task queue requires live hook mode
              </div>
            )}
            {taskList.length === 0 ? (
              <div className="px-3 py-2 text-[10px] text-text-muted">
                No tasks queued
              </div>
            ) : (
              taskList.map((task) => <TaskItem key={task.id} task={task} />)
            )}
          </div>
        )}
      </div>

      {showCreateDialog && (
        <CreateTaskDialog
          onClose={() => setShowCreateDialog(false)}
          onCreate={handleCreateTask}
        />
      )}
    </>
  );
}

export default TaskQueuePanel;
