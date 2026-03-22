import { useState, useCallback, useEffect, useRef } from 'react';
import { groupSessionsByDate } from '../../utils/date-grouping';
import Dialog from '../shared/Dialog';
import type { SessionInfo } from '../../../shared/types';

interface DeleteSessionsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  endedSessions: SessionInfo[];
  onDelete(sessionIds: string[]): void;
}

function DeleteSessionsDialog({
  open,
  onOpenChange,
  endedSessions,
  onDelete,
}: DeleteSessionsDialogProps): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(endedSessions.map((s) => s.sessionId)),
  );
  const [isDeleting, setIsDeleting] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // Reset state when dialog opens with fresh session list
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setSelected(new Set(endedSessions.map((s) => s.sessionId)));
      setIsDeleting(false);
      setCollapsed({});
    }
    prevOpenRef.current = open;
  });

  const groups = groupSessionsByDate(endedSessions);

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

  const toggleGroup = (sessions: SessionInfo[]): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allInGroupSelected = sessions.every((s) => prev.has(s.sessionId));
      for (const s of sessions) {
        if (allInGroupSelected) {
          next.delete(s.sessionId);
        } else {
          next.add(s.sessionId);
        }
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
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Delete Sessions"
      description="Select sessions to delete. This cannot be undone."
    >
      {/* Select all toggle */}
      <button
        className="text-xs text-text-muted hover:text-text-secondary mb-2"
        onClick={toggleAll}
      >
        {allSelected ? 'Deselect all' : 'Select all'}
      </button>

      {/* Session list grouped by date */}
      <div className="max-h-[300px] overflow-y-auto border border-border-default rounded">
        {groups.map((group) => {
          const groupIds = group.sessions.map((s) => s.sessionId);
          const allGroupSelected = groupIds.every((id) => selected.has(id));
          const someGroupSelected = !allGroupSelected && groupIds.some((id) => selected.has(id));

          const isCollapsed = collapsed[group.key] ?? true;

          return (
            <div key={group.key}>
              {/* Group header with checkbox */}
              <GroupHeader
                label={group.label}
                count={group.sessions.length}
                checked={allGroupSelected}
                indeterminate={someGroupSelected}
                collapsed={isCollapsed}
                onToggle={() => toggleGroup(group.sessions)}
                onToggleCollapse={() => setCollapsed((prev) => ({ ...prev, [group.key]: !isCollapsed }))}
              />

              {/* Sessions in group */}
              {!isCollapsed && group.sessions.map((session) => (
                <label
                  key={session.sessionId}
                  className="flex items-center gap-3 px-3 pl-8 py-1.5 hover:bg-bg-secondary cursor-pointer transition-colors"
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
                    </span>
                  </div>
                </label>
              ))}
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 mt-6">
        <button
          className="inline-flex items-center px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          onClick={() => onOpenChange(false)}
        >
          Cancel
          <kbd className="ml-2 text-xs opacity-70 font-mono">Esc</kbd>
        </button>
        <button
          disabled={selected.size === 0 || isDeleting}
          className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          onClick={handleDelete}
        >
          {isDeleting
            ? 'Deleting...'
            : `Delete ${selected.size} session${selected.size === 1 ? '' : 's'}`}
        </button>
      </div>
    </Dialog>
  );
}

function GroupHeader({
  label,
  count,
  checked,
  indeterminate,
  collapsed,
  onToggle,
  onToggleCollapse,
}: {
  label: string;
  count: number;
  checked: boolean;
  indeterminate: boolean;
  collapsed: boolean;
  onToggle(): void;
  onToggleCollapse(): void;
}): React.JSX.Element {
  const setRef = useCallback(
    (el: HTMLInputElement | null) => {
      if (el) el.indeterminate = indeterminate;
    },
    [indeterminate],
  );

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-bg-primary sticky top-0">
      <input
        ref={setRef}
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="shrink-0 accent-accent cursor-pointer"
      />
      <button
        className="flex items-center gap-1 flex-1 min-w-0 cursor-pointer"
        onClick={onToggleCollapse}
      >
        <span className="text-xs text-text-muted">
          {collapsed ? '\u25B6' : '\u25BC'}
        </span>
        <span className="text-xs font-medium text-text-muted uppercase tracking-wide flex-1 text-left">
          {label}
        </span>
        <span className="text-xs text-text-muted">{count}</span>
      </button>
    </div>
  );
}

export default DeleteSessionsDialog;
