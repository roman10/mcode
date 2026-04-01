import { useEffect, useState, useMemo, useCallback } from 'react';
import { Command } from 'cmdk';
import uFuzzy from '@leeoniya/ufuzzy';
import { useSessionStore } from '../../stores/session-store';
import { useTodoStore } from '../../stores/todo-store';
import type { TodoItem, TodoPriority } from '@shared/types';

const uf = new uFuzzy({ intraMode: 1 });

const PRIORITY_DOTS: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
};

const repoName = (cwd: string): string => cwd.split('/').at(-1) ?? cwd;

// Parse priority (#high/medium/low) and repo (@name) suffix tokens from query text.
// Supports either ordering: "Fix bug #high @mcode" or "Fix bug @mcode #high"
export function parseInput(raw: string): { text: string; priority?: TodoPriority; repoToken?: string } {
  let remaining = raw.trim();
  let priority: TodoPriority | undefined;
  let repoToken: string | undefined;

  const pm = remaining.match(/\s+#(high|medium|low)$/);
  if (pm) { priority = pm[1] as TodoPriority; remaining = remaining.slice(0, pm.index!).trim(); }

  const rm = remaining.match(/\s+@(\S+)$/);
  if (rm) { repoToken = rm[1]; remaining = remaining.slice(0, rm.index!).trim(); }

  // Handle reverse order: @repo appeared before #priority
  if (!priority) {
    const pm2 = remaining.match(/\s+#(high|medium|low)$/);
    if (pm2) { priority = pm2[1] as TodoPriority; remaining = remaining.slice(0, pm2.index!).trim(); }
  }

  return { text: remaining, priority, repoToken };
}

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

  const uniqueCwds = useMemo(
    () => [...new Set(Object.values(sessions).map((s) => s.cwd))],
    [sessions],
  );

  const { text: parsedText, priority: parsedPriority, repoToken: parsedRepoToken } = useMemo(
    () => parseInput(query.trim()),
    [query],
  );

  // Resolve the target repo: fuzzy-match @repoToken against known repo names, or fall back to primary
  const targetCwd = useMemo(() => {
    if (!parsedRepoToken) return primaryCwd;
    const names = uniqueCwds.map(repoName);
    const idxs = uf.filter(names, parsedRepoToken);
    if (!idxs?.length) return null; // typed @repo but no match
    const info = uf.info(idxs, names, parsedRepoToken);
    const order = uf.sort(info, names, parsedRepoToken);
    return uniqueCwds[info.idx[order[0]]];
  }, [parsedRepoToken, uniqueCwds, primaryCwd]);

  const fetchTodos = useCallback(() => {
    if (!targetCwd) {
      setTodos([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    window.mcode.todos.scan(targetCwd).then((items) => {
      setTodos(items);
      setLoading(false);
    }).catch(() => {
      setTodos([]);
      setLoading(false);
    });
  }, [targetCwd]);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos]);

  const handleCreate = useCallback(() => {
    if (!targetCwd || !parsedText) return;
    window.mcode.todos.create(targetCwd, { text: parsedText, priority: parsedPriority }).then(() => {
      useTodoStore.getState().refreshRepo(targetCwd);
      onClose();
    }).catch(console.error);
  }, [targetCwd, parsedText, parsedPriority, onClose]);

  const handleToggle = useCallback((item: TodoItem) => {
    if (!targetCwd) return;
    window.mcode.todos.update(targetCwd, item.index, { completed: !item.completed }).then(() => {
      fetchTodos();
      useTodoStore.getState().refreshRepo(targetCwd);
    }).catch(console.error);
  }, [targetCwd, fetchTodos]);

  // Build fuzzy search — use parsed text (modifiers already stripped) as the clean query
  const haystack = useMemo(() => todos.map((t) => t.text), [todos]);

  const filtered = useMemo(() => {
    const cleanQuery = parsedText;
    if (!cleanQuery) return todos;
    const idxs = uf.filter(haystack, cleanQuery);
    if (!idxs || idxs.length === 0) return [];
    const info = uf.info(idxs, haystack, cleanQuery);
    const order = uf.sort(info, haystack, cleanQuery);
    return order.map((sortIdx) => todos[info.idx[sortIdx]]);
  }, [todos, haystack, parsedText]);

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

  const multiRepo = uniqueCwds.length > 1;

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
          {multiRepo && (
            <span className="ml-auto text-text-muted text-xs shrink-0">
              {targetCwd
                ? `→ ${repoName(targetCwd)}`
                : <span className="text-red-400">@{parsedRepoToken ?? '?'} not found</span>}
            </span>
          )}
        </Command.Item>
      )}
      {/* Hint: visible when multiple repos exist and no @repo override is typed */}
      {multiRepo && !parsedRepoToken && parsedText && (
        <div className="px-4 pb-1 text-xs text-text-muted">
          type @reponame to change repo
        </div>
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
