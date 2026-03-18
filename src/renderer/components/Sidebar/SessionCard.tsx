import { useState, useRef, useEffect } from 'react';
import type { SessionInfo } from '../../../shared/types';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import Tooltip from '../shared/Tooltip';
import StatusBadge from './StatusBadge';

interface SessionCardProps {
  session: SessionInfo;
  isSelected: boolean;
  hasTile: boolean;
  onSelect(): void;
  onDoubleClick(): void;
  onKill(): void;
  onDelete(): void;
  onRename(label: string): void;
}

const attentionBorderColors: Record<string, string> = {
  high: 'border-l-2 border-l-red-400',
  medium: 'border-l-2 border-l-amber-400',
  low: 'border-l-2 border-l-blue-400',
  none: '',
};

function SessionCard({
  session,
  isSelected,
  hasTile,
  onSelect,
  onDoubleClick,
  onKill,
  onDelete,
  onRename,
}: SessionCardProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const startEditing = (): void => {
    setEditValue(session.label);
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
    if (trimmed && trimmed !== session.label) {
      onRename(trimmed);
    } else {
      setEditValue(session.label);
    }
    setIsEditing(false);
  };

  const shortTime = useRelativeTime(session.startedAt);
  const attentionBorder = attentionBorderColors[session.attentionLevel] ?? '';

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors ${attentionBorder} ${
        isSelected
          ? 'bg-bg-elevated'
          : 'hover:bg-bg-secondary'
      }`}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      {/* Status dot with attention ring */}
      <StatusBadge status={session.status} attentionLevel={session.attentionLevel} attentionReason={session.attentionReason} />

      {/* Label + metadata */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            ref={inputRef}
            className="w-full bg-bg-primary text-text-primary text-sm px-1 py-0 border border-border-focus rounded outline-none"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={handleRenameSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRenameSubmit();
              if (e.key === 'Escape') {
                setEditValue(session.label);
                setIsEditing(false);
              }
            }}
          />
        ) : (
          <span
            className="block text-sm text-text-primary truncate"
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEditing();
            }}
            title={session.label}
          >
            {session.sessionType === 'terminal' && (
              <span className="text-text-muted font-mono text-xs mr-1">&gt;_</span>
            )}
            {session.label}
          </span>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-muted truncate" title={session.cwd}>
            {session.cwd}
          </span>
          {shortTime && (
            <span className="text-xs text-text-muted shrink-0">
              · {shortTime}
            </span>
          )}
          {session.lastTool && session.status !== 'ended' && (
            <Tooltip content={`Last tool: ${session.lastTool}`} side="right">
              <span className="text-xs text-text-muted bg-bg-primary px-1 rounded shrink-0">
                {session.lastTool}
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!hasTile && (session.status !== 'ended' || (session.sessionType === 'claude' && session.claudeSessionId)) && (
          <Tooltip content={session.status === 'ended' ? 'View / Resume session' : 'Open tile'} side="top">
            <button
              className="text-text-secondary hover:text-text-primary text-xs p-0.5"
              onClick={(e) => {
                e.stopPropagation();
                onDoubleClick();
              }}
            >
              +
            </button>
          </Tooltip>
        )}
        {session.status !== 'ended' ? (
          <Tooltip content="Kill session" side="top">
            <button
              className="text-text-secondary hover:text-red-400 text-xs p-0.5"
              onClick={(e) => {
                e.stopPropagation();
                onKill();
              }}
            >
              x
            </button>
          </Tooltip>
        ) : (
          <Tooltip content="Delete session" side="top">
            <button
              className="text-text-secondary hover:text-red-400 text-xs p-0.5"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              x
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

export default SessionCard;
