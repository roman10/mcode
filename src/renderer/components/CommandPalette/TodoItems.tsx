import { useEffect, useState, useMemo, useCallback } from 'react';
import { Command } from 'cmdk';
import uFuzzy from '@leeoniya/ufuzzy';
import { useSessionStore } from '../../stores/session-store';
import type { TodoItem, TodoPriority } from '@shared/types';

const uf = new uFuzzy({ intraMode: 1 });

const PRIORITY_DOTS: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
};

interface TodoItemsProps {
  query: string;
  onClose: () => void;
}

export default function TodoItems({ query, onClose }: TodoItemsProps): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [loading, setLoading] = useState(true);

  const primaryCwd = useMemo(() => {
    const selected = selectedSessionId ? sessions[selectedSessionId] : null;
    if (selected) return selected.cwd;
    const sorted = Object.values(sessions).sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt),
    );
    return sorted[0]?.cwd ?? null;
  }, [sessions, selectedSessionId]);

  const fetchTodos = useCallback(() => {
    if (!primaryCwd) {
      setTodos([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    window.mcode.todos.scan(primaryCwd).then((items) => {
      setTodos(items);
      setLoading(false);
    }).catch(() => {
      setTodos([]);
      setLoading(false);
    });
  }, [primaryCwd]);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  // Parse priority from query text: "Fix bug #high" -> text="Fix bug", priority="high"
  const parseInput = useCallback((raw: string): { text: string; priority?: TodoPriority } => {
    const tagMatch = raw.match(/\s+#(high|medium|low)$/);
    if (tagMatch) {
      return {
        text: raw.slice(0, tagMatch.index).trim(),
        priority: tagMatch[1] as TodoPriority,
      };
    }
    return { text: raw };
  }, []);

  const handleCreate = useCallback(() => {
    if (!primaryCwd || !query.trim()) return;
    const { text, priority } = parseInput(query.trim());
    if (!text) return;
    window.mcode.todos.create(primaryCwd, { text, priority }).then(() => {
      onClose();
    }).catch(console.error);
  }, [primaryCwd, query, parseInput, onClose]);

  const handleToggle = useCallback((item: TodoItem) => {
    if (!primaryCwd) return;
    window.mcode.todos.update(primaryCwd, item.index, { completed: !item.completed }).then(() => {
      fetchTodos();
    }).catch(console.error);
  }, [primaryCwd, fetchTodos]);

  // Build fuzzy search
  const haystack = useMemo(() => todos.map((t) => t.text), [todos]);

  const filtered = useMemo(() => {
    // Strip trailing #tag from query before fuzzy matching
    const cleanQuery = query.replace(/\s+#(high|medium|low)$/, '').trim();
    if (!cleanQuery) return todos;
    const idxs = uf.filter(haystack, cleanQuery);
    if (!idxs || idxs.length === 0) return [];
    const info = uf.info(idxs, haystack, cleanQuery);
    const order = uf.sort(info, haystack, cleanQuery);
    return order.map((sortIdx) => todos[info.idx[sortIdx]]);
  }, [todos, haystack, query]);

  if (loading) {
    return (
      <Command.Empty className="px-4 py-6 text-sm text-text-muted text-center">
        Loading...
      </Command.Empty>
    );
  }

  if (!primaryCwd) {
    return (
      <Command.Empty className="px-4 py-6 text-sm text-text-muted text-center">
        No active session
      </Command.Empty>
    );
  }

  const { text: parsedText, priority: parsedPriority } = parseInput(query.trim());

  return (
    <>
      {/* Create option when there's query text */}
      {parsedText && (
        <Command.Item
          value={`__create__${query}`}
          onSelect={handleCreate}
          className="flex items-center gap-2 px-4 py-2 text-sm cursor-pointer
                     data-[selected=true]:bg-bg-secondary"
        >
          <span className="text-accent font-medium">+</span>
          <span className="text-text-primary">Create: {parsedText}</span>
          {parsedPriority && (
            <span className={`inline-block w-2 h-2 rounded-full ${PRIORITY_DOTS[parsedPriority] ?? ''}`} />
          )}
        </Command.Item>
      )}

      {/* Existing todos */}
      {filtered.length === 0 && !query.trim() && (
        <Command.Empty className="px-4 py-6 text-sm text-text-muted text-center">
          No TODOs yet. Type to create one.
        </Command.Empty>
      )}
      {filtered.map((item) => (
        <Command.Item
          key={item.index}
          value={`__todo__${item.index}__${item.text}`}
          onSelect={() => handleToggle(item)}
          className="flex items-center gap-2 px-4 py-2 text-sm cursor-pointer
                     data-[selected=true]:bg-bg-secondary"
        >
          <span className={`shrink-0 w-4 h-4 flex items-center justify-center rounded border text-[10px] ${
            item.completed
              ? 'bg-accent border-accent text-white'
              : 'border-border-default text-transparent'
          }`}>
            {item.completed ? '✓' : ''}
          </span>
          {item.priority && (
            <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOTS[item.priority] ?? ''}`} />
          )}
          <span className={item.completed ? 'line-through text-text-muted' : 'text-text-primary'}>
            {item.text}
          </span>
        </Command.Item>
      ))}
    </>
  );
}
