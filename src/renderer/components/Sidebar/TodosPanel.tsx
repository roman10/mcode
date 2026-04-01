import { useEffect, useState, useRef, useCallback } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import { useTodoStore } from '../../stores/todo-store';
import { resolveActiveCwd } from '../../utils/session-actions';
import type { TodoItem, TodoPriority } from '@shared/types';

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
};

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

function TodosPanel(): React.JSX.Element {
  const { todos, loading, refreshTodos, addTodo } = useTodoStore();
  const [showCompleted, setShowCompleted] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newText, setNewText] = useState('');
  const addInputRef = useRef<HTMLInputElement>(null);
  const isMac = window.mcode.app.getPlatform() === 'darwin';
  const modKey = isMac ? '⌘' : 'Ctrl+';

  const cwd = resolveActiveCwd();

  useEffect(() => {
    if (cwd) refreshTodos(cwd);
  }, [cwd, refreshTodos]);

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  const handleAdd = useCallback((): void => {
    const trimmed = newText.trim();
    if (!trimmed || !cwd) return;
    // Parse priority from trailing #tag
    let priority: TodoPriority | undefined;
    let text = trimmed;
    const tagMatch = text.match(/\s+#(high|medium|low)$/);
    if (tagMatch) {
      priority = tagMatch[1] as TodoPriority;
      text = text.slice(0, tagMatch.index).trim();
    }
    addTodo(cwd, { text, priority });
    setNewText('');
    setAdding(false);
  }, [newText, cwd, addTodo]);

  const handleAddKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') handleAdd();
    if (e.key === 'Escape') {
      setNewText('');
      setAdding(false);
    }
  };

  const pending = todos.filter((t) => !t.completed);
  const completed = todos.filter((t) => t.completed);

  if (!cwd) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 text-xs text-text-muted">
        No active session
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-default shrink-0">
        <span className="text-xs text-text-secondary uppercase tracking-wide">Todos</span>
        <button
          className="p-1 text-text-muted hover:text-text-secondary transition-colors"
          onClick={() => setAdding(true)}
          title="Add todo"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Add input */}
      {adding && (
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
        {loading && todos.length === 0 ? (
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
            {/* Pending items */}
            {pending.map((item) => (
              <TodoItemRow key={item.index} item={item} cwd={cwd} />
            ))}

            {/* Completed section */}
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
                  <TodoItemRow key={item.index} item={item} cwd={cwd} />
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
