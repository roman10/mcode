import { useState, useRef, useEffect, useMemo } from 'react';
import { Maximize2, Minimize2, Plus, RefreshCw, Square, TimerOff, X } from 'lucide-react';
import { useSessionStore } from '../../stores/session-store';
import { useTaskStore } from '../../stores/task-store';
import { useAccountsStore } from '../../stores/accounts-store';
import { useDialogStore } from '../../stores/dialog-store';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { splitLabelIcon } from '../../utils/label-utils';
import AgentIcon from '../shared/AgentIcon';
import Tooltip from '../shared/Tooltip';
import ModelPill from './ModelPill';
import AccountPill from './AccountPill';
import ContextUsagePill from './ContextUsagePill';
import { canSessionQueueTasks } from '@shared/session-capabilities';
import type { SessionStatus } from '@shared/types';
import { useSlashCommandWarningStore } from '../../stores/slash-command-warning-store';

interface TerminalToolbarProps {
  sessionId: string;
  onClose(): void;
  isMaximized: boolean;
  onToggleMaximize(): void;
  onRefit(): void;
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
  onRefit,
}: TerminalToolbarProps): React.JSX.Element {
  const session = useSessionStore((s) => s.sessions[sessionId]);
  const label = session?.label ?? 'Unknown';
  const [labelIcon, labelText] = splitLabelIcon(label);
  const status = session?.status ?? 'ended';
  const attentionLevel = session?.attentionLevel ?? 'none';
  const lastTool = session?.lastTool;
  const shortTime = useRelativeTime(session?.startedAt ?? '');
  const slashWarning = useSlashCommandWarningStore((s) => s.warnings[sessionId] ?? null);

  const account = useAccountsStore((s) => {
    if (!session?.accountId) return null;
    const a = s.accounts.find((acc) => acc.accountId === session.accountId);
    return a && !a.isDefault ? a : null;
  });

  const canQueueTasks = canSessionQueueTasks(session);
  const openCreateTaskDialog = useDialogStore((s) => s.openCreateTaskDialog);

  const tasks = useTaskStore((s) => s.tasks);
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
      <ModelPill model={session?.model ?? null} sessionType={session?.sessionType ?? 'terminal'} />
      {account && <AccountPill name={account.name} email={account.providers?.[session?.sessionType ?? '']?.identity ?? null} />}
      {lastTool && status !== 'ended' && (
        <span className="text-xs text-text-muted mr-1.5">
          {lastTool}
        </span>
      )}
      {labelIcon && <AgentIcon icon={labelIcon} className="text-xs mr-1 text-text-secondary" />}
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
      {slashWarning && (
        <Tooltip content={slashWarning} side="bottom">
          <span className="text-xs bg-amber-400/20 text-amber-300 px-1.5 rounded ml-1 shrink-0 cursor-help">
            Slash warning
          </span>
        </Tooltip>
      )}
      <ContextUsagePill claudeSessionId={session?.claudeSessionId ?? null} />

      {/* Actions */}
      <div className="flex items-center gap-1 ml-2">
        {canQueueTasks && (
          <Tooltip content="Add task (⌘⇧T)" side="bottom">
            <button
              aria-label="Add task"
              className="text-text-muted hover:text-text-primary text-xs px-1 transition-colors"
              onClick={() => openCreateTaskDialog({ targetSessionId: sessionId, cwd: session?.cwd })}
            >
              <Plus size={14} strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
        {canQueueTasks && (
          <Tooltip content={session?.autoClose ? 'Auto-close enabled — session will close when queue empties (⌘⇧Q)' : 'Auto-close disabled (⌘⇧Q)'} side="bottom">
            <button
              aria-label={session?.autoClose ? 'Disable auto-close' : 'Enable auto-close'}
              className={`px-1 transition-colors rounded ${
                session?.autoClose
                  ? 'text-accent bg-accent/15'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
              onClick={() => {
                window.mcode.sessions.setAutoClose(sessionId, !session?.autoClose).catch(console.error);
              }}
            >
              <TimerOff size={14} strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
        <Tooltip content="Refit terminal (recover from narrow rendering)" side="bottom">
          <button
            aria-label="Refit terminal"
            className="text-text-muted hover:text-text-primary text-xs px-1 transition-colors"
            onClick={onRefit}
          >
            <RefreshCw size={14} strokeWidth={1.5} />
          </button>
        </Tooltip>
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
    </div>
  );
}

export default TerminalToolbar;
