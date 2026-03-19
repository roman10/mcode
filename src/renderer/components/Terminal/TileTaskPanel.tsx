import { useState, useMemo, useRef, useEffect } from 'react';
import { Pencil, X } from 'lucide-react';
import { useTaskStore } from '../../stores/task-store';
import type { Task, TaskStatus } from '../../../shared/types';
import Tooltip from '../shared/Tooltip';

const statusColors: Record<TaskStatus, string> = {
  pending: 'bg-amber-400',
  dispatched: 'bg-green-400',
  completed: 'bg-blue-400',
  failed: 'bg-red-400',
};

interface TileTaskItemProps {
  task: Task;
}

function TileTaskItem({ task }: TileTaskItemProps): React.JSX.Element {
  const updateTask = useTaskStore((s) => s.updateTask);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(task.prompt);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  const handleSave = async (): Promise<void> => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== task.prompt) {
      try {
        await updateTask(task.id, { prompt: trimmed });
      } catch {
        // Revert on failure
        setEditValue(task.prompt);
      }
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    // Stop propagation for all mod+key combos to prevent TerminalTile handlers
    // (e.g., Cmd+Enter = maximize, Cmd+W = close) from firing
    if (e.metaKey || e.ctrlKey) {
      e.stopPropagation();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      setEditValue(task.prompt);
      setEditing(false);
    }
  };

  const promptPreview =
    task.prompt.length > 80 ? task.prompt.slice(0, 77) + '...' : task.prompt;

  const isPending = task.status === 'pending';

  return (
    <div className="px-3 py-1.5 border-b border-border-default/50 group hover:bg-bg-elevated/50 transition-colors">
      {editing ? (
        <div>
          <textarea
            ref={textareaRef}
            className="w-full bg-bg-primary text-text-primary text-xs px-2 py-1 border border-border-focus rounded outline-none resize-none"
            rows={3}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <span className="text-[10px] text-text-muted">
            {'\u2318\u21B5'} to save &middot; Esc to cancel
          </span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 min-w-0">
            <Tooltip
              content={isPending ? 'Queued' : 'Running'}
              side="right"
            >
              <span
                className={`shrink-0 w-2 h-2 rounded-full ${statusColors[task.status]}`}
              />
            </Tooltip>
            <span
              className="text-xs text-text-primary truncate flex-1"
              title={task.prompt}
            >
              {promptPreview}
            </span>
            {isPending && (
              <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                <button
                  className="text-text-muted hover:text-text-primary p-0.5 transition-colors"
                  onClick={() => {
                    setEditValue(task.prompt);
                    setEditing(true);
                  }}
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
              <span className="text-[10px] text-green-400 shrink-0">
                Running
              </span>
            )}
          </div>
          {(task.scheduledAt || task.retryCount > 0) && (
            <div className="flex items-center gap-2 mt-0.5 ml-4">
              {task.scheduledAt && task.status === 'pending' && (
                <span className="text-[10px] text-text-muted">scheduled</span>
              )}
              {task.retryCount > 0 && (
                <span className="text-[10px] text-text-muted">
                  retry {task.retryCount}/{task.maxRetries}
                </span>
              )}
            </div>
          )}
        </>
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
          // higher priority first
          if (a.priority !== b.priority) return b.priority - a.priority;
          // older first
          return a.createdAt.localeCompare(b.createdAt);
        }),
    [tasks, sessionId],
  );

  if (sessionTasks.length === 0) return null;

  return (
    <div className="border-b border-border-default bg-bg-secondary shrink-0">
      <div
        className="flex items-center h-6 px-3 cursor-pointer hover:bg-bg-elevated/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[10px] text-text-muted mr-1.5">
          {expanded ? '\u25BC' : '\u25B6'}
        </span>
        <span className="text-xs text-text-secondary font-medium mr-1.5">
          Tasks
        </span>
        <span className="text-[10px] bg-bg-elevated text-text-muted px-1 rounded">
          {sessionTasks.length} queued
        </span>
      </div>
      {expanded && (
        <div className="max-h-32 overflow-y-auto">
          {sessionTasks.map((task) => (
            <TileTaskItem key={task.id} task={task} />
          ))}
        </div>
      )}
    </div>
  );
}

export default TileTaskPanel;
