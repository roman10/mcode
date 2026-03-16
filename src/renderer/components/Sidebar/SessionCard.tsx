import { useState, useRef, useEffect } from 'react';
import type { SessionInfo } from '../../../shared/types';

interface SessionCardProps {
  session: SessionInfo;
  isSelected: boolean;
  hasTile: boolean;
  onSelect(): void;
  onDoubleClick(): void;
  onKill(): void;
  onRename(label: string): void;
}

const statusColors: Record<string, string> = {
  starting: 'bg-amber-400',
  active: 'bg-green-400',
  ended: 'bg-neutral-500',
};

function SessionCard({
  session,
  isSelected,
  hasTile,
  onSelect,
  onDoubleClick,
  onKill,
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

  return (
    <div
      className={`group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors ${
        isSelected
          ? 'bg-bg-elevated'
          : 'hover:bg-bg-secondary'
      }`}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
    >
      {/* Status dot */}
      <span
        className={`shrink-0 w-2 h-2 rounded-full ${statusColors[session.status] || 'bg-neutral-500'}`}
        title={session.status}
      />

      {/* Label */}
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
            {session.label}
          </span>
        )}
        <span className="block text-xs text-text-muted truncate" title={session.cwd}>
          {session.cwd}
        </span>
      </div>

      {/* Actions */}
      <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {!hasTile && session.status !== 'ended' && (
          <button
            className="text-text-secondary hover:text-text-primary text-xs p-0.5"
            title="Open tile"
            onClick={(e) => {
              e.stopPropagation();
              onDoubleClick();
            }}
          >
            +
          </button>
        )}
        {session.status !== 'ended' && (
          <button
            className="text-text-secondary hover:text-red-400 text-xs p-0.5"
            title="Kill session"
            onClick={(e) => {
              e.stopPropagation();
              onKill();
            }}
          >
            x
          </button>
        )}
      </div>
    </div>
  );
}

export default SessionCard;
