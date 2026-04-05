import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Command } from 'cmdk';
import {
  insertPromptText,
  truncate,
  relativeTime,
  renderTemplate,
  useFuzzyFilter,
  usePrimaryCwd,
} from './prompt-library-utils';
import { useLayoutStore } from '../../stores/layout-store';
import { resolveActiveCwd } from '../../utils/session-actions';
import { basename } from '../../utils/path-utils';
import type { PromptHistoryEntry, SnippetEntry } from '@shared/types';

// ── SVG Icons ───────────────────────────────────────────────────────────────

function PinIcon({ filled }: { filled: boolean }): React.JSX.Element {
  return filled ? (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

const EditIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </svg>
);

const CopyIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const DeleteIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </svg>
);

const SaveIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
    <polyline points="17 21 17 13 7 13 7 21" />
    <polyline points="7 3 7 8 15 8" />
  </svg>
);

// ── Section icon components ─────────────────────────────────────────────────

const SnippetIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-muted">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const ClockIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-text-muted">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

// ── Unified item type ──────────────────────────────────────────────────────

type LibraryItemType = 'snippet' | 'pinned' | 'history';

interface LibraryItem {
  type: LibraryItemType;
  key: string;
  searchText: string;
  snippet?: SnippetEntry;
  prompt?: PromptHistoryEntry;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function ActionButton({
  title,
  onClick,
  danger,
  children,
}: {
  title: string;
  onClick: (e: React.MouseEvent) => void;
  danger?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`shrink-0 opacity-0 group-hover:opacity-100 text-text-muted
                  p-0.5 rounded hover:bg-bg-secondary transition-opacity cursor-pointer
                  ${danger ? 'hover:text-red-400' : 'hover:text-text-primary'}`}
    >
      {children}
    </button>
  );
}

function SectionHeader({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted select-none">
      {label}
    </div>
  );
}

// ── Edit form (reused from PromptHistoryItems) ──────────────────────────────

function EditForm({
  entry,
  onInsert,
  onBack,
}: {
  entry: PromptHistoryEntry;
  onInsert: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const [text, setText] = useState(entry.promptText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [noSession, setNoSession] = useState(false);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.selectionStart = el.selectionEnd = el.value.length;
    }
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (insertPromptText(trimmed)) {
      onInsert();
    } else {
      setNoSession(true);
    }
  }, [text, onInsert]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && e.metaKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  return (
    <div className="px-4 py-3 text-sm" onKeyDown={handleKeyDown}>
      <div className="mb-1 font-medium text-text-primary">Edit prompt</div>
      <div className="mb-2 text-xs text-text-muted">
        {basename(entry.projectDir)} · {relativeTime(entry.messageTimestamp)}
      </div>

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(10, text.split('\n').length + 1)}
        className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2
                   border border-border-default rounded focus:border-border-focus outline-none
                   resize-y font-mono leading-relaxed"
      />

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
          Insert ⌘⏎
        </button>
      </div>
    </div>
  );
}

// ── Variable form (reused from SnippetItems) ────────────────────────────────

function VariableForm({
  snippet,
  onInsert,
  onBack,
}: {
  snippet: SnippetEntry;
  onInsert: () => void;
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
    if (insertPromptText(rendered)) {
      onInsert();
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

// ── Delete confirmation ─────────────────────────────────────────────────────

function DeleteConfirm({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  return (
    <div className="px-4 py-3 text-sm">
      <div className="mb-1 font-medium text-text-primary">Delete snippet?</div>
      <div className="mb-3 text-xs text-text-secondary">
        This will permanently delete <span className="font-medium text-text-primary">{name}</span>.
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

// ── Main Component ─────────────────────────────────────────────────────────

interface PromptLibraryItemsProps {
  query: string;
  onClose: () => void;
  escapeOverrideRef: React.MutableRefObject<(() => void) | null>;
}

export default function PromptLibraryItems({
  query,
  onClose,
  escapeOverrideRef,
}: PromptLibraryItemsProps): React.JSX.Element {
  const primaryCwd = usePrimaryCwd();

  // Data state
  const [snippets, setSnippets] = useState<SnippetEntry[]>([]);
  const [historyEntries, setHistoryEntries] = useState<PromptHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal state
  const [editing, setEditing] = useState<PromptHistoryEntry | null>(null);
  const [selectedSnippet, setSelectedSnippet] = useState<SnippetEntry | null>(null);
  const [deletingSnippet, setDeletingSnippet] = useState<SnippetEntry | null>(null);
  const [noSession, setNoSession] = useState(false);

  // Fetch both data sources on mount
  const fetchSnippets = useCallback(() => {
    if (!primaryCwd) return Promise.resolve([]);
    return window.mcode.snippets.scan(primaryCwd);
  }, [primaryCwd]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchSnippets().catch(() => []),
      window.mcode.promptHistory.recent(200).catch(() => []),
    ]).then(([snippetResults, historyResults]) => {
      setSnippets(snippetResults);
      setHistoryEntries(historyResults);
      setLoading(false);
    });
  }, [fetchSnippets]);

  // If query changes while in modal mode, go back to search
  const prevQueryRef = useRef(query);
  useEffect(() => {
    if (prevQueryRef.current !== query) {
      setEditing(null);
      setSelectedSnippet(null);
    }
    prevQueryRef.current = query;
  }, [query]);

  // Manage escape override for forms
  useEffect(() => {
    if (editing || selectedSnippet || deletingSnippet) {
      escapeOverrideRef.current = () => {
        setEditing(null);
        setSelectedSnippet(null);
        setDeletingSnippet(null);
      };
    } else {
      escapeOverrideRef.current = null;
    }
    return () => { escapeOverrideRef.current = null; };
  }, [editing, selectedSnippet, deletingSnippet, escapeOverrideRef]);

  // Split history into pinned and unpinned
  const pinnedEntries = useMemo(
    () => historyEntries.filter((e) => e.isPinned),
    [historyEntries],
  );
  const recentEntries = useMemo(
    () => historyEntries.filter((e) => !e.isPinned),
    [historyEntries],
  );

  // Build unified items list for search
  const allItems = useMemo<LibraryItem[]>(() => {
    const items: LibraryItem[] = [];
    for (const s of snippets) {
      items.push({
        type: 'snippet',
        key: `snippet:${s.source}:${s.name}`,
        searchText: `${s.name} ${s.description}`,
        snippet: s,
      });
    }
    for (const p of pinnedEntries) {
      items.push({
        type: 'pinned',
        key: `pinned:${p.id}`,
        searchText: p.promptText,
        prompt: p,
      });
    }
    for (const p of recentEntries) {
      items.push({
        type: 'history',
        key: `history:${p.id}`,
        searchText: p.promptText,
        prompt: p,
      });
    }
    return items;
  }, [snippets, pinnedEntries, recentEntries]);

  const haystack = useMemo(() => allItems.map((i) => i.searchText), [allItems]);
  const filtered = useFuzzyFilter(allItems, haystack, query);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSelectSnippet = useCallback(
    (snippet: SnippetEntry) => {
      if (snippet.variables.length === 0) {
        if (insertPromptText(snippet.body)) {
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

  const handleSelectPrompt = useCallback(
    (entry: PromptHistoryEntry) => {
      if (insertPromptText(entry.promptText)) {
        onClose();
      } else {
        setNoSession(true);
      }
    },
    [onClose],
  );

  const handleTogglePin = useCallback(
    (entry: PromptHistoryEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      window.mcode.promptHistory.togglePin(entry.id).then(() => {
        setHistoryEntries((prev) =>
          prev.map((p) => p.id === entry.id ? { ...p, isPinned: !p.isPinned } : p),
        );
      }).catch(console.error);
    },
    [],
  );

  const handleEditPrompt = useCallback(
    (entry: PromptHistoryEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      setEditing(entry);
    },
    [],
  );

  const handleCopyPrompt = useCallback(
    (entry: PromptHistoryEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(entry.promptText).catch(console.error);
    },
    [],
  );

  const handleDeletePrompt = useCallback(
    (entry: PromptHistoryEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      window.mcode.promptHistory.delete(entry.id).then(() => {
        setHistoryEntries((prev) => prev.filter((p) => p.id !== entry.id));
      }).catch(console.error);
    },
    [],
  );

  const handleSaveAsSnippet = useCallback(
    (entry: PromptHistoryEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      const cwd = resolveActiveCwd();
      window.mcode.snippets.createFromText('user', cwd, entry.promptText).then((filePath) => {
        useLayoutStore.getState().addFileViewer(filePath);
        onClose();
      }).catch(console.error);
    },
    [onClose],
  );

  const handleEditSnippet = useCallback(
    (snippet: SnippetEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      useLayoutStore.getState().addFileViewer(snippet.filePath);
      onClose();
    },
    [onClose],
  );

  const handleDeleteSnippetConfirm = useCallback(() => {
    if (!deletingSnippet) return;
    window.mcode.snippets.delete(deletingSnippet.filePath).then(() => {
      setDeletingSnippet(null);
      setSnippets((prev) => prev.filter((s) => s.filePath !== deletingSnippet.filePath));
    }).catch(console.error);
  }, [deletingSnippet]);

  const handleNewSnippet = useCallback(() => {
    const cwd = resolveActiveCwd();
    window.mcode.snippets.create('user', cwd).then((filePath) => {
      useLayoutStore.getState().addFileViewer(filePath);
      onClose();
    }).catch(console.error);
  }, [onClose]);

  // ── Render: modal states ──────────────────────────────────────────────────

  if (deletingSnippet) {
    return (
      <DeleteConfirm
        name={deletingSnippet.name}
        onConfirm={handleDeleteSnippetConfirm}
        onCancel={() => setDeletingSnippet(null)}
      />
    );
  }

  if (selectedSnippet) {
    return (
      <VariableForm
        snippet={selectedSnippet}
        onInsert={() => onClose()}
        onBack={() => setSelectedSnippet(null)}
      />
    );
  }

  if (editing) {
    return (
      <EditForm
        entry={editing}
        onInsert={() => onClose()}
        onBack={() => setEditing(null)}
      />
    );
  }

  // ── Render: loading ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
        Loading prompt library...
      </Command.Empty>
    );
  }

  // ── Render: empty state ───────────────────────────────────────────────────

  if (allItems.length === 0 && !query.trim()) {
    return (
      <div className="px-4 py-3 text-sm">
        <div className="text-center text-text-muted mb-3">
          No prompts or snippets yet. Start sending prompts to sessions, or create a snippet.
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

  // ── Render: no results ────────────────────────────────────────────────────

  if (filtered.length === 0 && query.trim()) {
    return (
      <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
        No matching prompts or snippets.
      </Command.Empty>
    );
  }

  // ── Render: item renderers ────────────────────────────────────────────────

  const renderSnippetItem = (item: LibraryItem): React.JSX.Element => {
    const snippet = item.snippet!;
    return (
      <Command.Item
        key={item.key}
        value={item.key}
        onSelect={() => handleSelectSnippet(snippet)}
        className="group flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer
                   text-text-primary data-[selected=true]:bg-accent/20"
      >
        {SnippetIcon}
        <span className="truncate min-w-0 flex-1">{snippet.name}</span>
        <span className="truncate text-text-secondary text-xs ml-auto max-w-[50%]">
          {snippet.description}
        </span>
        <span className="shrink-0 text-xs text-text-muted px-1 rounded bg-bg-secondary">
          {snippet.source === 'project' ? 'Project' : 'User'}
        </span>
        <ActionButton title="Edit snippet" onClick={(e) => handleEditSnippet(snippet, e)}>
          {EditIcon}
        </ActionButton>
        <ActionButton title="Delete snippet" danger onClick={(e) => { e.stopPropagation(); setDeletingSnippet(snippet); }}>
          {DeleteIcon}
        </ActionButton>
      </Command.Item>
    );
  };

  const renderPromptItem = (item: LibraryItem): React.JSX.Element => {
    const entry = item.prompt!;
    const isPinned = item.type === 'pinned';
    return (
      <Command.Item
        key={item.key}
        value={item.key}
        onSelect={() => handleSelectPrompt(entry)}
        className="group flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer
                   text-text-primary data-[selected=true]:bg-accent/20"
      >
        {isPinned ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-400">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
          </svg>
        ) : ClockIcon}
        <span className="truncate min-w-0 flex-1 font-mono text-xs">
          {truncate(entry.promptText.replace(/\n/g, ' '), 120)}
        </span>
        <span className="shrink-0 text-xs text-text-muted">
          {basename(entry.projectDir)}
        </span>
        <span className="shrink-0 text-xs text-text-muted">
          {relativeTime(entry.messageTimestamp)}
        </span>
        {/* Pin / Unpin */}
        <ActionButton title={isPinned ? 'Unpin' : 'Pin'} onClick={(e) => handleTogglePin(entry, e)}>
          <PinIcon filled={isPinned} />
        </ActionButton>
        {/* Edit before insert */}
        <ActionButton title="Edit and insert" onClick={(e) => handleEditPrompt(entry, e)}>
          {EditIcon}
        </ActionButton>
        {/* Copy */}
        <ActionButton title="Copy to clipboard" onClick={(e) => handleCopyPrompt(entry, e)}>
          {CopyIcon}
        </ActionButton>
        {/* Save as snippet */}
        <ActionButton title="Save as snippet" onClick={(e) => handleSaveAsSnippet(entry, e)}>
          {SaveIcon}
        </ActionButton>
        {/* Delete */}
        <ActionButton title="Remove from history" danger onClick={(e) => handleDeletePrompt(entry, e)}>
          {DeleteIcon}
        </ActionButton>
      </Command.Item>
    );
  };

  // ── Render: searching (flat mixed results) ────────────────────────────────

  if (query.trim()) {
    return (
      <>
        {noSession && (
          <div className="px-3 py-1.5 text-xs text-red-400">
            No active session — select a session first.
          </div>
        )}
        {filtered.map((item) =>
          item.type === 'snippet' ? renderSnippetItem(item) : renderPromptItem(item),
        )}
      </>
    );
  }

  // ── Render: browsing (sectioned) ──────────────────────────────────────────

  const snippetItems = filtered.filter((i) => i.type === 'snippet');
  const pinnedItems = filtered.filter((i) => i.type === 'pinned');
  const historyItems = filtered.filter((i) => i.type === 'history');

  return (
    <>
      {noSession && (
        <div className="px-3 py-1.5 text-xs text-red-400">
          No active session — select a session first.
        </div>
      )}

      {/* New Snippet action */}
      <Command.Item
        value="__new-snippet__"
        onSelect={handleNewSnippet}
        className="flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer
                   text-accent data-[selected=true]:bg-accent/20"
      >
        + New Snippet
      </Command.Item>

      {/* Snippets section */}
      {snippetItems.length > 0 && (
        <>
          <SectionHeader label="Snippets" />
          {snippetItems.map(renderSnippetItem)}
        </>
      )}

      {/* Pinned section */}
      {pinnedItems.length > 0 && (
        <>
          <SectionHeader label="Pinned" />
          {pinnedItems.map(renderPromptItem)}
        </>
      )}

      {/* Recent history section */}
      {historyItems.length > 0 && (
        <>
          <SectionHeader label="Recent" />
          {historyItems.map(renderPromptItem)}
        </>
      )}
    </>
  );
}
