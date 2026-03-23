import { useState, useRef, useEffect, useMemo } from 'react';
import { Maximize2, Minimize2, Plus, Square, X } from 'lucide-react';
import { useSessionStore } from '../../stores/session-store';
import { useTaskStore } from '../../stores/task-store';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { splitLabelIcon } from '../../utils/label-utils';
import Tooltip from '../shared/Tooltip';
import CreateTaskDialog from '../shared/CreateTaskDialog';
import type { SessionStatus, CreateTaskInput } from '@shared/types';

interface TerminalToolbarProps {
  sessionId: string;
  onClose(): void;
  isMaximized: boolean;
  onToggleMaximize(): void;
}

const statusLabels: Record<SessionStatus, string> = {
  starting: 'Starting',
  active: 'Active',
  idle: 'Idle',
  waiting: 'Waiting',
  detached: 'Detached',
  ended: 'Ended',
};

const statusColors: Record<SessionStatus, string> = {
  starting: 'text-amber-400',
  active: 'text-green-400',
  idle: 'text-blue-400',
  waiting: 'text-red-400',
  detached: 'text-neutral-400',
  ended: 'text-neutral-500',
};

function TerminalToolbar({
  sessionId,
  onClose,
  isMaximized,
  onToggleMaximize,
}: TerminalToolbarProps): React.JSX.Element {
  const session = useSessionStore((s) => s.sessions[sessionId]);
  const label = session?.label ?? 'Unknown';
  const [labelIcon, labelText] = splitLabelIcon(label);
  const status = session?.status ?? 'ended';
  const attentionLevel = session?.attentionLevel ?? 'none';
  const lastTool = session?.lastTool;
  const shortTime = useRelativeTime(session?.startedAt ?? '');

  const canQueueTasks =
    session?.sessionType === 'claude' &&
    session?.hookMode === 'live' &&
    status !== 'ended';

  const tasks = useTaskStore((s) => s.tasks);
  const addTask = useTaskStore((s) => s.addTask);
  const pendingTaskCount = useMemo(
    () =>
      canQueueTasks
        ? Object.values(tasks).filter(
            (t) =>
              t.targetSessionId === sessionId &&
              (t.status === 'pending' || t.status === 'dispatched'),
          ).length
        : 0,
    [tasks, sessionId, canQueueTasks],
  );

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = (): void => {
    setEditValue(labelText);
    setIsEditing(true);
  };

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleRenameSubmit = (): void => {
    const trimmed = editValue.trim();
    const full = labelIcon ? `${labelIcon} ${trimmed}` : trimmed;
    if (trimmed && full !== label) {
      window.mcode.sessions.setLabel(sessionId, full).catch(console.error);
      useSessionStore.getState().setLabel(sessionId, full);
    }
    setIsEditing(false);
  };

  const handleKill = async (): Promise<void> => {
    try {
      await window.mcode.sessions.kill(sessionId);
    } catch (err) {
      console.error('Failed to kill session:', err);
    }
  };

  const handleCreateTask = async (input: CreateTaskInput): Promise<void> => {
    try {
      await addTask(input);
      setShowCreateDialog(false);
    } catch (err) {
      console.error('Failed to create task:', err);
      setShowCreateDialog(false);
    }
  };

  const actionAttentionGlow =
    attentionLevel === 'action'
      ? 'shadow-[inset_0_-1px_0_0_rgba(248,113,113,0.5)]'
      : '';

  return (
    <div
      className={`flex items-center h-8 px-3 bg-bg-secondary border-b border-border-default shrink-0 [-webkit-app-region:no-drag] ${actionAttentionGlow}`}
    >
      {/* Status + label */}
      <span className={`text-xs mr-1.5 ${statusColors[status]}`}>
        {statusLabels[status]}
      </span>
      {lastTool && status !== 'ended' && (
        <span className="text-xs text-text-muted mr-1.5">
          {lastTool}
        </span>
      )}
      {labelIcon && <span className="text-xs mr-1">{labelIcon}</span>}
      {isEditing ? (
        <input
          ref={inputRef}
          className="flex-1 min-w-0 bg-bg-primary text-text-primary text-xs px-1 py-0 h-5 border border-border-focus rounded outline-none"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleRenameSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleRenameSubmit();
            if (e.key === 'Escape') {
              setEditValue(labelText);
              setIsEditing(false);
            }
          }}
        />
      ) : (
        <span
          className="text-xs text-text-primary truncate flex-1"
          title={label}
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEditing();
          }}
        >
          {labelText}
        </span>
      )}
      {shortTime && (
        <span className="text-xs text-text-muted ml-1 shrink-0">
          {shortTime}
        </span>
      )}

      {/* Task count badge */}
      {pendingTaskCount > 0 && (
        <span className="text-xs bg-amber-400/20 text-amber-300 px-1.5 rounded ml-1 shrink-0">
          {pendingTaskCount} {pendingTaskCount === 1 ? 'task' : 'tasks'}
        </span>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1 ml-2">
        {canQueueTasks && (
          <Tooltip content="Add task (⌘⇧T)" side="bottom">
            <button
              aria-label="Add task"
              className="text-text-muted hover:text-text-primary text-xs px-1 transition-colors"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus size={14} strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
        <Tooltip content={isMaximized ? 'Restore layout (⌘↵)' : 'Maximize tile (⌘↵)'} side="bottom">
          <button
            aria-label={isMaximized ? 'Restore layout' : 'Maximize tile'}
            className="text-text-muted hover:text-text-primary text-xs px-1 transition-colors"
            onClick={onToggleMaximize}
          >
            {isMaximized ? <Minimize2 size={14} strokeWidth={1.5} /> : <Maximize2 size={14} strokeWidth={1.5} />}
          </button>
        </Tooltip>
        {status !== 'ended' && (
          <Tooltip content="Kill session (⌘⇧W)" side="bottom">
            <button
              aria-label="Kill session"
              className="text-text-muted hover:text-red-400 text-xs px-1 transition-colors"
              onClick={handleKill}
            >
              <Square size={14} strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
        <Tooltip content="Close tile (⌘W)" side="bottom">
          <button
            aria-label="Close tile"
            className="text-text-muted hover:text-text-primary text-xs px-1 transition-colors"
            onClick={onClose}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </Tooltip>
      </div>

      <CreateTaskDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreate={handleCreateTask}
        defaultTargetSessionId={sessionId}
        defaultCwd={session?.cwd}
      />
    </div>
  );
}

export default TerminalToolbar;
