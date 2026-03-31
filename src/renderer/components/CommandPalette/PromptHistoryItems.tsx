import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Command } from 'cmdk';
import uFuzzy from '@leeoniya/ufuzzy';
import { useSessionStore } from '../../stores/session-store';
import { useDialogStore } from '../../stores/dialog-store';
import { basename } from '../../utils/path-utils';
import type { PromptHistoryEntry } from '@shared/types';

const uf = new uFuzzy({ intraMode: 1 });

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Truncate text to a max length, appending ellipsis if needed. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '\u2026';
}

function insertPromptText(text: string): boolean {
  const target = useDialogStore.getState().textInsertTarget;
  if (target) {
    target(text);
    return true;
  }
  const sessionId = useSessionStore.getState().selectedSessionId;
  if (!sessionId) return false;
  window.mcode.pty.write(sessionId, text);
  return true;
}

interface PromptHistoryItemsProps {
  query: string;
  onClose: () => void;
  escapeOverrideRef: React.MutableRefObject<(() => void) | null>;
}

// --- Edit form ---

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

// --- Main component ---

export default function PromptHistoryItems({
  query,
  onClose,
  escapeOverrideRef,
}: PromptHistoryItemsProps): React.JSX.Element {
  const [entries, setEntries] = useState<PromptHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PromptHistoryEntry | null>(null);
  const [noSession, setNoSession] = useState(false);

  // Fetch entries on mount
  useEffect(() => {
    setLoading(true);
    window.mcode.promptHistory.recent(200).then((results) => {
      setEntries(results);
      setLoading(false);
    }).catch(() => {
      setEntries([]);
      setLoading(false);
    });
  }, []);

  // If query changes while editing, go back to search
  const prevQueryRef = useRef(query);
  useEffect(() => {
    if (prevQueryRef.current !== query && editing) {
      setEditing(null);
    }
    prevQueryRef.current = query;
  }, [query, editing]);

  // Manage escape override for edit form
  useEffect(() => {
    if (editing) {
      escapeOverrideRef.current = () => setEditing(null);
    } else {
      escapeOverrideRef.current = null;
    }
    return () => { escapeOverrideRef.current = null; };
  }, [editing, escapeOverrideRef]);

  // Build search haystack from prompt text
  const haystack = useMemo(
    () => entries.map((e) => e.promptText),
    [entries],
  );

  // Fuzzy filter
  const filtered = useMemo(() => {
    if (!query.trim()) return entries;

    const idxs = uf.filter(haystack, query);
    if (!idxs || idxs.length === 0) return [];

    const info = uf.info(idxs, haystack, query);
    const order = uf.sort(info, haystack, query);

    return order.map((sortIdx) => entries[info.idx[sortIdx]]);
  }, [entries, haystack, query]);

  const handleSelect = useCallback(
    (entry: PromptHistoryEntry) => {
      if (insertPromptText(entry.promptText)) {
        onClose();
      } else {
        setNoSession(true);
      }
    },
    [onClose],
  );

  const handleEdit = useCallback(
    (entry: PromptHistoryEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      setEditing(entry);
    },
    [],
  );

  const handleCopy = useCallback(
    (entry: PromptHistoryEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      navigator.clipboard.writeText(entry.promptText).catch(console.error);
    },
    [],
  );

  const handleDelete = useCallback(
    (entry: PromptHistoryEntry, e: React.MouseEvent) => {
      e.stopPropagation();
      window.mcode.promptHistory.delete(entry.id).then(() => {
        setEntries((prev) => prev.filter((p) => p.id !== entry.id));
      }).catch(console.error);
    },
    [],
  );

  // --- Edit mode ---
  if (editing) {
    return (
      <EditForm
        entry={editing}
        onInsert={() => onClose()}
        onBack={() => setEditing(null)}
      />
    );
  }

  // --- Search/browse mode ---
  if (loading) {
    return (
      <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
        Loading prompt history...
      </Command.Empty>
    );
  }

  if (entries.length === 0) {
    return (
      <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
        No prompt history yet. Start sending prompts to Claude Code sessions.
      </Command.Empty>
    );
  }

  if (filtered.length === 0 && query.trim()) {
    return (
      <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
        No matching prompts.
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
      {filtered.map((entry) => (
        <Command.Item
          key={entry.id}
          value={`prompt-${entry.id}`}
          onSelect={() => handleSelect(entry)}
          className="group flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer
                     text-text-primary data-[selected=true]:bg-accent/20"
        >
          <span className="truncate min-w-0 flex-1 font-mono text-xs">
            {truncate(entry.promptText.replace(/\n/g, ' '), 120)}
          </span>
          <span className="shrink-0 text-xs text-text-muted">
            {basename(entry.projectDir)}
          </span>
          <span className="shrink-0 text-xs text-text-muted">
            {relativeTime(entry.messageTimestamp)}
          </span>
          {/* Edit button */}
          <button
            type="button"
            title="Edit and insert"
            onClick={(e) => handleEdit(entry, e)}
            className="shrink-0 opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary
                       p-0.5 rounded hover:bg-bg-secondary transition-opacity cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              <path d="m15 5 4 4" />
            </svg>
          </button>
          {/* Copy button */}
          <button
            type="button"
            title="Copy to clipboard"
            onClick={(e) => handleCopy(entry, e)}
            className="shrink-0 opacity-0 group-hover:opacity-100 text-text-muted hover:text-text-primary
                       p-0.5 rounded hover:bg-bg-secondary transition-opacity cursor-pointer"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
          {/* Delete button */}
          <button
            type="button"
            title="Remove from history"
            onClick={(e) => handleDelete(entry, e)}
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
