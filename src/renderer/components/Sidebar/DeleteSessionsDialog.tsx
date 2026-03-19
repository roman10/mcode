import { useState, useEffect } from 'react';
import type { SessionInfo } from '../../../shared/types';

interface DeleteSessionsDialogProps {
  endedSessions: SessionInfo[];
  onClose(): void;
  onDelete(sessionIds: string[]): void;
}

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function DeleteSessionsDialog({
  endedSessions,
  onClose,
  onDelete,
}: DeleteSessionsDialogProps): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(endedSessions.map((s) => s.sessionId)),
  );
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const allSelected = selected.size === endedSessions.length;

  const toggleAll = (): void => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(endedSessions.map((s) => s.sessionId)));
    }
  };

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDelete = (): void => {
    if (selected.size === 0 || isDeleting) return;
    setIsDeleting(true);
    onDelete([...selected]);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-bg-elevated border border-border-default rounded-lg p-6 w-[420px] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-text-primary text-lg font-medium mb-1">
          Delete Sessions
        </h2>
        <p className="text-text-muted text-sm mb-4">
          Select sessions to delete. This cannot be undone.
        </p>

        {/* Select all toggle */}
        <button
          className="text-xs text-text-muted hover:text-text-secondary mb-2"
          onClick={toggleAll}
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>

        {/* Session list */}
        <div className="max-h-[300px] overflow-y-auto border border-border-default rounded">
          {endedSessions.map((session) => (
            <label
              key={session.sessionId}
              className="flex items-center gap-3 px-3 py-2 hover:bg-bg-secondary cursor-pointer transition-colors"
            >
              <input
                type="checkbox"
                checked={selected.has(session.sessionId)}
                onChange={() => toggle(session.sessionId)}
                className="shrink-0 accent-accent"
              />
              <div className="flex-1 min-w-0">
                <span className="block text-sm text-text-primary truncate">
                  {session.label}
                </span>
                <span className="text-xs text-text-muted truncate block">
                  {session.cwd}
                  {' · '}
                  {formatRelativeTime(session.startedAt)}
                </span>
              </div>
            </label>
          ))}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6">
          <button
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            disabled={selected.size === 0 || isDeleting}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-50 transition-colors"
            onClick={handleDelete}
          >
            {isDeleting
              ? 'Deleting...'
              : `Delete ${selected.size} session${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DeleteSessionsDialog;
