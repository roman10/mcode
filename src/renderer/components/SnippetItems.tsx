import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Command } from 'cmdk';
import uFuzzy from '@leeoniya/ufuzzy';
import { useSessionStore } from '../stores/session-store';
import { useLayoutStore } from '../stores/layout-store';
import { resolveActiveCwd } from '../utils/session-actions';
import type { SnippetEntry } from '@shared/types';

const uf = new uFuzzy({ intraMode: 1 });

interface SnippetItemsProps {
  query: string;
  onClose: () => void;
  escapeOverrideRef: React.MutableRefObject<(() => void) | null>;
}

function renderTemplate(body: string, values: Record<string, string>): string {
  return body.replace(/\{\{([^}]+)\}\}/g, (_, raw) => {
    const name = raw.trim();
    return values[name] ?? '';
  });
}

function insertSnippetText(text: string): boolean {
  const sessionId = useSessionStore.getState().selectedSessionId;
  if (!sessionId) return false;
  window.mcode.pty.write(sessionId, text);
  return true;
}

// --- Variable Form ---

function VariableForm({
  snippet,
  onInsert,
  onBack,
}: {
  snippet: SnippetEntry;
  onInsert: (text: string) => void;
  onBack: () => void;
}): React.JSX.Element {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const v of snippet.variables) {
      initial[v.name] = v.default ?? '';
    }
    return initial;
  });
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [noSession, setNoSession] = useState(false);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(() => {
    const rendered = renderTemplate(snippet.body, values);
    if (insertSnippetText(rendered)) {
      onInsert(rendered);
    } else {
      setNoSession(true);
    }
  }, [snippet, values, onInsert]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="px-4 py-3 text-sm" onKeyDown={handleKeyDown}>
      <div className="mb-1 font-medium text-text-primary">{snippet.name}</div>
      {snippet.description && (
        <div className="mb-3 text-xs text-text-secondary">{snippet.description}</div>
      )}

      <div className="flex flex-col gap-2.5">
        {snippet.variables.map((v, i) => (
          <label key={v.name} className="flex flex-col gap-1">
            <span className="text-xs text-text-secondary">
              {v.description ?? v.name}
            </span>
            <input
              ref={i === 0 ? firstInputRef : undefined}
              type="text"
              value={values[v.name] ?? ''}
              onChange={(e) =>
                setValues((prev) => ({ ...prev, [v.name]: e.target.value }))
              }
              placeholder={v.default ?? ''}
              className="w-full bg-bg-primary text-text-primary text-sm px-3 py-1.5
                         border border-border-default rounded focus:border-border-focus outline-none"
            />
          </label>
        ))}
      </div>

      {noSession && (
        <div className="mt-2 text-xs text-red-400">
          No active session — select a session first.
        </div>
      )}

      <div className="flex justify-end gap-2 mt-3">
        <button
          type="button"
          onClick={onBack}
          className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary
                     rounded border border-border-default hover:bg-bg-secondary cursor-pointer"
        >
          Back
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          className="px-3 py-1.5 text-xs bg-accent text-white rounded
                     hover:opacity-90 cursor-pointer"
        >
          Insert ⏎
        </button>
      </div>
    </div>
  );
}

// --- Delete confirmation ---

function DeleteConfirm({
  snippet,
  onConfirm,
  onCancel,
}: {
  snippet: SnippetEntry;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <div className="px-4 py-3 text-sm">
      <div className="mb-1 font-medium text-text-primary">Delete snippet?</div>
      <div className="mb-3 text-xs text-text-secondary">
        This will permanently delete <span className="font-medium text-text-primary">{snippet.name}</span> ({snippet.source}).
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary
                     rounded border border-border-default hover:bg-bg-secondary cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="px-3 py-1.5 text-xs bg-red-600 text-white rounded
                     hover:opacity-90 cursor-pointer"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// --- Main SnippetItems ---

export default function SnippetItems({
  query,
  onClose,
  escapeOverrideRef,
}: SnippetItemsProps): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const [snippets, setSnippets] = useState<SnippetEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSnippet, setSelectedSnippet] = useState<SnippetEntry | null>(null);
  const [deletingSnippet, setDeletingSnippet] = useState<SnippetEntry | null>(null);
  const [noSession, setNoSession] = useState(false);

  // Derive primary cwd (same pattern as FileSearchItems)
  const primaryCwd = useMemo(() => {
    const selected = selectedSessionId ? sessions[selectedSessionId] : null;
    if (selected) return selected.cwd;
    const sorted = Object.values(sessions).sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt),
    );
    return sorted[0]?.cwd ?? null;
  }, [sessions, selectedSessionId]);

  // Fetch snippets on mount
  const fetchSnippets = useCallback(() => {
    if (!primaryCwd) {
      setSnippets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    window.mcode.snippets.scan(primaryCwd).then((entries) => {
      setSnippets(entries);
      setLoading(false);
    }).catch(() => {
      setSnippets([]);
      setLoading(false);
    });
  }, [primaryCwd]);

  useEffect(() => {
    fetchSnippets();
  }, [fetchSnippets]);

  // If query changes while in form mode, go back to search
  const prevQueryRef = useRef(query);
  useEffect(() => {
    if (prevQueryRef.current !== query && selectedSnippet) {
      setSelectedSnippet(null);
    }
    prevQueryRef.current = query;
  }, [query, selectedSnippet]);

  // Manage escape override
  useEffect(() => {
    if (selectedSnippet || deletingSnippet) {
      escapeOverrideRef.current = () => {
        setSelectedSnippet(null);
        setDeletingSnippet(null);
      };
    } else {
      escapeOverrideRef.current = null;
    }
    return () => { escapeOverrideRef.current = null; };
  }, [selectedSnippet, deletingSnippet, escapeOverrideRef]);

  // Build search haystack
  const haystack = useMemo(
    () => snippets.map((s) => `${s.name} ${s.description}`),
    [snippets],
  );

  // Fuzzy filter
  const filtered = useMemo(() => {
    if (!query.trim()) return snippets;

    const idxs = uf.filter(haystack, query);
    if (!idxs || idxs.length === 0) return [];

    const info = uf.info(idxs, haystack, query);
    const order = uf.sort(info, haystack, query);

    return order.map((sortIdx) => snippets[info.idx[sortIdx]]);
  }, [snippets, haystack, query]);

  const handleSelect = useCallback(
    (snippet: SnippetEntry) => {
      if (snippet.variables.length === 0) {
        // No variables — insert directly
        if (insertSnippetText(snippet.body)) {
          onClose();
        } else {
          setNoSession(true);
        }
      } else {
        setSelectedSnippet(snippet);
      }
    },
    [onClose],
  );

  const handleEdit = useCallback(
    (snippet: SnippetEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      useLayoutStore.getState().addFileViewer(snippet.filePath);
      onClose();
    },
    [onClose],
  );

  const handleDeleteConfirm = useCallback(() => {
    if (!deletingSnippet) return;
    window.mcode.snippets.delete(deletingSnippet.filePath).then(() => {
      setDeletingSnippet(null);
      fetchSnippets();
    }).catch(console.error);
  }, [deletingSnippet, fetchSnippets]);

  const handleNewSnippet = useCallback(() => {
    const cwd = resolveActiveCwd();
    window.mcode.snippets.create('user', cwd).then((filePath) => {
      useLayoutStore.getState().addFileViewer(filePath);
      onClose();
    }).catch(console.error);
  }, [onClose]);

  // --- Delete confirmation mode ---
  if (deletingSnippet) {
    return (
      <DeleteConfirm
        snippet={deletingSnippet}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeletingSnippet(null)}
      />
    );
  }

  // --- Variable form mode ---
  if (selectedSnippet) {
    return (
      <VariableForm
        snippet={selectedSnippet}
        onInsert={() => onClose()}
        onBack={() => setSelectedSnippet(null)}
      />
    );
  }

  // --- Search mode ---
  if (loading) {
    return (
      <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
        Loading snippets...
      </Command.Empty>
    );
  }

  if (snippets.length === 0 && !query.trim()) {
    return (
      <div className="px-4 py-3 text-sm">
        <div className="text-center text-text-muted mb-3">
          No snippets found. Create <span className="font-mono text-text-secondary">~/.mcode/snippets/*.md</span> files to get started.
        </div>
        <button
          type="button"
          onClick={handleNewSnippet}
          className="w-full text-left px-3 py-1.5 text-sm cursor-pointer rounded
                     text-accent hover:bg-accent/10"
        >
          + New Snippet
        </button>
      </div>
    );
  }

  if (filtered.length === 0 && query.trim()) {
    return (
      <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
        No matching snippets.
      </Command.Empty>
    );
  }

  return (
    <>
      {noSession && (
        <div className="px-3 py-1.5 text-xs text-red-400">
          No active session — select a session first.
        </div>
      )}
      {!query.trim() && (
        <Command.Item
          value="__new-snippet__"
          onSelect={handleNewSnippet}
          className="flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer
                     text-accent data-[selected=true]:bg-accent/20"
        >
          + New Snippet
        </Command.Item>
      )}
      {filtered.map((snippet) => (
        <Command.Item
          key={`${snippet.source}:${snippet.name}`}
          value={`${snippet.source}:${snippet.name}`}
          onSelect={() => handleSelect(snippet)}
          className="group flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer
                     text-text-primary data-[selected=true]:bg-accent/20"
        >
          <span className="truncate min-w-0 flex-1">{snippet.name}</span>
          <span className="truncate text-text-secondary text-xs ml-auto max-w-[50%]">
            {snippet.description}
          </span>
          <span className="shrink-0 text-xs text-text-muted px-1 rounded bg-bg-secondary">
            {snippet.source === 'project' ? 'Project' : 'User'}
          </span>
          <button
            type="button"
            title="Edit snippet"
            onClick={(e) => handleEdit(snippet, e)}
            className="shrink-0 opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary
                       p-0.5 rounded hover:bg-bg-secondary transition-opacity cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
          <button
            type="button"
            title="Delete snippet"
            onClick={(e) => {
              e.stopPropagation();
              setDeletingSnippet(snippet);
            }}
            className="shrink-0 opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400
                       p-0.5 rounded hover:bg-bg-secondary transition-opacity cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" />
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            </svg>
          </button>
        </Command.Item>
      ))}
    </>
  );
}
