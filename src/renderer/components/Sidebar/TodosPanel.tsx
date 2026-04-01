import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, ArrowUp, ArrowDown, Check } from 'lucide-react';
import { useTodoStore } from '../../stores/todo-store';
import { useSessionStore } from '../../stores/session-store';
import type { TodoItem, TodoPriority } from '@shared/types';

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
};

function repoName(cwd: string): string {
  return cwd.split('/').at(-1) ?? cwd;
}

function PriorityDot({ priority }: { priority: TodoPriority | null }): React.JSX.Element | null {
  if (!priority) return null;
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${PRIORITY_COLORS[priority] ?? ''}`}
      title={priority}
    />
  );
}

function TodoItemRow({ item, cwd }: { item: TodoItem; cwd: string }): React.JSX.Element {
  const { updateTodo, removeTodo, reorderTodo } = useTodoStore();
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const handleToggle = (): void => {
    updateTodo(cwd, item.index, { completed: !item.completed });
  };

  const handleSave = (): void => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== item.text) {
      updateTodo(cwd, item.index, { text: trimmed });
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setEditText(item.text);
      setEditing(false);
    }
  };

  return (
    <div className="group flex items-start gap-2 px-3 py-1.5 hover:bg-bg-secondary transition-colors">
      <input
        type="checkbox"
        checked={item.completed}
        onChange={handleToggle}
        className="mt-0.5 shrink-0 accent-accent cursor-pointer"
      />
      <PriorityDot priority={item.priority} />
      {editing ? (
        <input
          ref={inputRef}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="flex-1 min-w-0 bg-bg-primary border border-border-default rounded px-1 py-0.5 text-xs text-text-primary outline-none focus:border-accent"
        />
      ) : (
        <span
          className={`flex-1 min-w-0 text-xs cursor-pointer select-none ${
            item.completed ? 'line-through text-text-muted' : 'text-text-primary'
          }`}
          onClick={() => {
            setEditText(item.text);
            setEditing(true);
          }}
        >
          {item.text}
        </span>
      )}
      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
        <button
          className="p-0.5 text-text-muted hover:text-text-secondary"
          onClick={() => reorderTodo(cwd, item.index, 'up')}
          title="Move up"
        >
          <ArrowUp size={12} />
        </button>
        <button
          className="p-0.5 text-text-muted hover:text-text-secondary"
          onClick={() => reorderTodo(cwd, item.index, 'down')}
          title="Move down"
        >
          <ArrowDown size={12} />
        </button>
        <button
          className="p-0.5 text-text-muted hover:text-red-400"
          onClick={() => removeTodo(cwd, item.index)}
          title="Delete"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  );
}

function RepoSection({
  name,
  cwd,
  items,
}: {
  name: string;
  cwd: string;
  items: TodoItem[];
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);
  const pending = items.filter((t) => !t.completed);
  const completed = items.filter((t) => t.completed);

  return (
    <div className="border-b border-border-default last:border-b-0">
      <button
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-secondary transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span className="font-medium truncate">{name}</span>
        <span className="ml-auto text-text-muted shrink-0">{pending.length} pending</span>
      </button>
      {expanded && (
        <>
          {pending.length === 0 && completed.length === 0 ? (
            <div className="px-6 py-2 text-xs text-text-muted">No TODOs</div>
          ) : (
            <>
              {pending.map((item) => (
                <TodoItemRow key={item.index} item={item} cwd={cwd} />
              ))}
              {completed.length > 0 && (
                <div>
                  <button
                    className="flex items-center gap-1 px-6 py-1 text-xs text-text-muted hover:text-text-secondary w-full"
                    onClick={() => setShowCompleted(!showCompleted)}
                  >
                    {showCompleted ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    Completed ({completed.length})
                  </button>
                  {showCompleted && completed.map((item) => (
                    <TodoItemRow key={item.index} item={item} cwd={cwd} />
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

type RepoMode = 'auto' | 'all' | string; // string = pinned cwd

function TodosPanel(): React.JSX.Element {
  const { todosByRepo, loadingByRepo, refreshRepo, refreshAllRepos, addTodo } = useTodoStore();
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const sessions = useSessionStore((s) => s.sessions);

  const [repoMode, setRepoMode] = useState<RepoMode>('all');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showCompleted, setShowCompleted] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isMac = window.mcode.app.getPlatform() === 'darwin';
  const modKey = isMac ? '⌘' : 'Ctrl+';

  // Reactive cwd from focused session
  const autoCwd = useMemo(() => {
    if (selectedSessionId && sessions[selectedSessionId]) {
      return sessions[selectedSessionId].cwd;
    }
    const sorted = Object.values(sessions).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return sorted[0]?.cwd ?? null;
  }, [selectedSessionId, sessions]);

  // All unique cwds from active sessions
  const uniqueCwds = useMemo(
    () => [...new Set(Object.values(sessions).map((s) => s.cwd))],
    [sessions],
  );

  // Effective cwd: null when in "all" mode
  const effectiveCwd = repoMode === 'auto' ? autoCwd : (repoMode === 'all' ? null : repoMode);

  // Load todos when effective cwd changes (single-repo mode)
  useEffect(() => {
    if (effectiveCwd) {
      refreshRepo(effectiveCwd);
    }
  }, [effectiveCwd, refreshRepo]);

  // Load all repos when switching to "all" mode or when uniqueCwds changes
  useEffect(() => {
    if (repoMode === 'all' && uniqueCwds.length > 0) {
      refreshAllRepos(uniqueCwds);
    }
  }, [repoMode, uniqueCwds, refreshAllRepos]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  const handleAdd = useCallback((): void => {
    const trimmed = newText.trim();
    if (!trimmed || !effectiveCwd) return;
    let priority: TodoPriority | undefined;
    let text = trimmed;
    const tagMatch = text.match(/\s+#(high|medium|low)$/);
    if (tagMatch) {
      priority = tagMatch[1] as TodoPriority;
      text = text.slice(0, tagMatch.index).trim();
    }
    addTodo(effectiveCwd, { text, priority });
    setNewText('');
    setAdding(false);
  }, [newText, effectiveCwd, addTodo]);

  const handleAddKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') handleAdd();
    if (e.key === 'Escape') {
      setNewText('');
      setAdding(false);
    }
  };

  // Label shown in dropdown button
  const modeLabel = (): string => {
    if (repoMode === 'all') return 'All repos';
    const cwd = repoMode === 'auto' ? autoCwd : repoMode;
    const name = cwd ? repoName(cwd) : '—';
    return repoMode === 'auto' ? `${name} (auto)` : name;
  };

  const todos = effectiveCwd ? (todosByRepo[effectiveCwd] ?? []) : [];
  const isLoading = effectiveCwd ? (loadingByRepo[effectiveCwd] ?? false) : false;
  const pending = todos.filter((t) => !t.completed);
  const completed = todos.filter((t) => t.completed);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border-default shrink-0">
        {/* Repo dropdown */}
        <div ref={dropdownRef} className="relative flex-1 min-w-0">
          <button
            className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary transition-colors max-w-full"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            title="Switch repository"
          >
            <ChevronDown size={12} className="shrink-0" />
            <span className="truncate">{modeLabel()}</span>
          </button>

          {dropdownOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 min-w-40 max-w-64 bg-bg-primary border border-border-default rounded shadow-lg py-1">
              {/* Auto option */}
              <button
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-text-primary hover:bg-bg-secondary transition-colors"
                onClick={() => { setRepoMode('auto'); setDropdownOpen(false); }}
              >
                {repoMode === 'auto' && <Check size={12} className="text-accent shrink-0" />}
                <span className={repoMode === 'auto' ? 'pl-0' : 'pl-4'}>
                  Auto{autoCwd ? ` — ${repoName(autoCwd)}` : ''}
                </span>
              </button>

              {uniqueCwds.length > 0 && (
                <>
                  <div className="my-1 border-t border-border-default" />
                  {uniqueCwds.map((cwd) => (
                    <button
                      key={cwd}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-text-primary hover:bg-bg-secondary transition-colors"
                      onClick={() => { setRepoMode(cwd); setDropdownOpen(false); }}
                      title={cwd}
                    >
                      {repoMode === cwd && <Check size={12} className="text-accent shrink-0" />}
                      <span className={`truncate ${repoMode === cwd ? '' : 'pl-4'}`}>
                        {repoName(cwd)}
                      </span>
                    </button>
                  ))}
                </>
              )}

              <div className="my-1 border-t border-border-default" />
              <button
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-text-primary hover:bg-bg-secondary transition-colors"
                onClick={() => { setRepoMode('all'); setDropdownOpen(false); }}
              >
                {repoMode === 'all' && <Check size={12} className="text-accent shrink-0" />}
                <span className={repoMode === 'all' ? '' : 'pl-4'}>All repos</span>
              </button>
            </div>
          )}
        </div>

        {/* Add button — only in single-repo mode */}
        {repoMode !== 'all' && effectiveCwd && (
          <button
            className="p-1 text-text-muted hover:text-text-secondary transition-colors shrink-0"
            onClick={() => setAdding(true)}
            title="Add todo"
          >
            <Plus size={14} />
          </button>
        )}
      </div>

      {/* Add input */}
      {adding && effectiveCwd && (
        <div className="px-3 py-1.5 border-b border-border-default">
          <input
            ref={addInputRef}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onBlur={() => { if (!newText.trim()) setAdding(false); }}
            onKeyDown={handleAddKeyDown}
            placeholder="New todo... (append #high/#low for priority)"
            className="w-full bg-bg-primary border border-border-default rounded px-2 py-1 text-xs text-text-primary outline-none focus:border-accent placeholder:text-text-muted"
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {repoMode === 'all' ? (
          /* All repos grouped view */
          uniqueCwds.length === 0 ? (
            <div className="flex items-center justify-center py-8 px-4 text-xs text-text-muted text-center">
              No active sessions
            </div>
          ) : (
            uniqueCwds.map((cwd) => (
              <RepoSection
                key={cwd}
                name={repoName(cwd)}
                cwd={cwd}
                items={todosByRepo[cwd] ?? []}
              />
            ))
          )
        ) : !effectiveCwd ? (
          <div className="flex-1 flex items-center justify-center px-4 text-xs text-text-muted">
            No active session
          </div>
        ) : isLoading && todos.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-text-muted">
            Loading...
          </div>
        ) : pending.length === 0 && completed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 text-xs text-text-muted text-center gap-1">
            <span>No TODOs yet.</span>
            <span>Press <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default font-mono">{modKey}P</kbd> then <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default font-mono">+</kbd> to capture one.</span>
          </div>
        ) : (
          <>
            {pending.map((item) => (
              <TodoItemRow key={item.index} item={item} cwd={effectiveCwd} />
            ))}
            {completed.length > 0 && (
              <div className="mt-1">
                <button
                  className="flex items-center gap-1 px-3 py-1 text-xs text-text-muted hover:text-text-secondary w-full"
                  onClick={() => setShowCompleted(!showCompleted)}
                >
                  {showCompleted ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  Completed ({completed.length})
                </button>
                {showCompleted && completed.map((item) => (
                  <TodoItemRow key={item.index} item={item} cwd={effectiveCwd} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default TodosPanel;
