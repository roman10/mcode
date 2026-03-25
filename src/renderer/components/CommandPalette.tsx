import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Command, defaultFilter } from 'cmdk';
import uFuzzy from '@leeoniya/ufuzzy';
import { useSessionStore } from '../stores/session-store';
import { useLayoutStore } from '../stores/layout-store';
import { getCommands } from '../command-palette/command-registry';
import { basename } from '../utils/path-utils';
import { getFileIcon } from '../utils/file-icons';
import { runShellCommand, resolveActiveCwd } from '../utils/session-actions';
import { createFocusRestorer } from '../utils/focus-utils';
import SnippetItems from './SnippetItems';

const uf = new uFuzzy({ intraMode: 1 });

interface CommandPaletteProps {
  initialMode: 'files' | 'commands' | 'shell' | 'snippets';
  onClose(): void;
}

// --- File search items ---

interface FileEntry {
  path: string;
  cwd: string;
  repo: string;
}

interface FilteredEntry extends FileEntry {
  ranges: number[] | null;
}

function FileSearchItems({
  query,
  onClose,
}: {
  query: string;
  onClose: () => void;
}): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [repoCount, setRepoCount] = useState(0);

  // Determine primary cwd (selected session or most recent)
  const primaryCwd = useMemo(() => {
    const selected = selectedSessionId ? sessions[selectedSessionId] : null;
    if (selected) return selected.cwd;
    const sorted = Object.values(sessions).sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt),
    );
    return sorted[0]?.cwd ?? null;
  }, [sessions, selectedSessionId]);

  // Collect unique cwds from all sessions, stabilized to avoid re-fetching
  // when unrelated session fields change (status, lastEventAt, etc.)
  const uniqueCwdsRaw = useMemo(() => {
    const cwds = new Set(Object.values(sessions).map((s) => s.cwd));
    if (cwds.size === 0) return [];
    const arr = [...cwds];
    if (primaryCwd) {
      const idx = arr.indexOf(primaryCwd);
      if (idx > 0) {
        arr.splice(idx, 1);
        arr.unshift(primaryCwd);
      }
    }
    return arr;
  }, [sessions, primaryCwd]);

  const prevCwdsKeyRef = useRef('');
  const uniqueCwdsRef = useRef<string[]>([]);
  const cwdsKey = uniqueCwdsRaw.join('\0');
  if (cwdsKey !== prevCwdsKeyRef.current) {
    prevCwdsKeyRef.current = cwdsKey;
    uniqueCwdsRef.current = uniqueCwdsRaw;
  }
  const uniqueCwds = uniqueCwdsRef.current;

  // Fetch file lists from all repos in parallel
  useEffect(() => {
    if (uniqueCwds.length === 0) {
      setEntries([]);
      setRepoCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    Promise.allSettled(
      uniqueCwds.map((cwd) => window.mcode.files.list(cwd).then((r) => ({ cwd, files: r.files }))),
    ).then((results) => {
      const combined: FileEntry[] = [];
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const { cwd, files } = result.value;
        const repo = basename(cwd);
        for (const path of files) {
          combined.push({ path, cwd, repo });
        }
      }
      setEntries(combined);
      setRepoCount(uniqueCwds.length);
      setLoading(false);
    });
  }, [uniqueCwds]);

  // Build path array for uFuzzy (parallel to entries)
  const paths = useMemo(() => entries.map((e) => e.path), [entries]);

  // Fuzzy filter
  const filtered = useMemo((): FilteredEntry[] => {
    if (!query.trim()) {
      // Show first 50 files, primary repo first (already ordered by uniqueCwds)
      return entries.slice(0, 50).map((e) => ({ ...e, ranges: null }));
    }

    const idxs = uf.filter(paths, query);
    if (!idxs || idxs.length === 0) return [];

    const info = uf.info(idxs, paths, query);
    const order = uf.sort(info, paths, query);

    return order.slice(0, 50).map((sortIdx) => {
      const fileIdx = info.idx[sortIdx];
      const entry = entries[fileIdx];
      return {
        ...entry,
        ranges: (info.ranges[sortIdx] ?? null) as number[] | null,
      };
    });
  }, [entries, paths, query]);

  const multiRepo = repoCount > 1;

  const handleSelect = useCallback(
    (entry: FilteredEntry) => {
      const absolutePath = entry.cwd.endsWith('/')
        ? entry.cwd + entry.path
        : `${entry.cwd}/${entry.path}`;
      useLayoutStore.getState().addFileViewer(absolutePath);
      useLayoutStore.getState().persist();
      onClose();
    },
    [onClose],
  );

  if (loading) {
    return (
      <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
        Loading files...
      </Command.Empty>
    );
  }

  if (uniqueCwds.length === 0) {
    return (
      <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
        No session open — create a session first.
      </Command.Empty>
    );
  }

  if (filtered.length === 0 && query.trim()) {
    return (
      <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
        No files found.
      </Command.Empty>
    );
  }

  return (
    <>
      {filtered.map((item) => {
        const lastSlash = item.path.lastIndexOf('/');
        const filename = lastSlash >= 0 ? item.path.slice(lastSlash + 1) : item.path;
        const directory = lastSlash >= 0 ? item.path.slice(0, lastSlash) : '';

        return (
          <Command.Item
            key={`${item.cwd}:${item.path}`}
            value={`${item.cwd}:${item.path}`}
            onSelect={() => handleSelect(item)}
            className="flex items-center gap-2.5 px-3 py-1.5 text-sm cursor-pointer
                       text-text-primary data-[selected=true]:bg-accent/20"
          >
            {getFileIcon(filename)}
            {item.ranges ? (
              <span className="truncate min-w-0 flex-1">
                <HighlightedText text={item.path} ranges={item.ranges} />
              </span>
            ) : (
              <>
                <span className="truncate min-w-0">{filename}</span>
                {directory && (
                  <span className="truncate text-text-secondary text-xs ml-auto">{directory}</span>
                )}
              </>
            )}
            {multiRepo && (
              <span className="shrink-0 text-xs text-text-muted ml-1 px-1 rounded bg-bg-secondary">{item.repo}</span>
            )}
          </Command.Item>
        );
      })}
    </>
  );
}

function HighlightedText({
  text,
  ranges,
}: {
  text: string;
  ranges: number[];
}): React.JSX.Element {
  if (ranges.length === 0) return <>{text}</>;

  const parts: React.JSX.Element[] = [];
  let cursor = 0;

  for (let i = 0; i < ranges.length; i += 2) {
    const start = ranges[i];
    const end = ranges[i + 1];

    if (cursor < start) {
      parts.push(<span key={`t${cursor}`}>{text.slice(cursor, start)}</span>);
    }
    parts.push(
      <span key={`h${start}`} className="text-accent font-medium">
        {text.slice(start, end + 1)}
      </span>,
    );
    cursor = end + 1;
  }

  if (cursor < text.length) {
    parts.push(<span key={`t${cursor}`}>{text.slice(cursor)}</span>);
  }

  return <>{parts}</>;
}

// --- Command items ---

function CommandItems({
  onClose,
}: {
  onClose: () => void;
}): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const mosaicTree = useLayoutStore((s) => s.mosaicTree);

  const commands = getCommands({ sessions, selectedSessionId, mosaicTree });
  const categories = ['General', 'Layout', 'Session'] as const;

  return (
    <>
      <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
        No results found.
      </Command.Empty>
      {categories.map((cat) => {
        const items = commands.filter((c) => c.category === cat);
        if (items.length === 0) return null;
        return (
          <Command.Group
            key={cat}
            heading={cat}
            className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5
                       [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium
                       [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wide
                       [&_[cmdk-group-heading]]:text-text-muted"
          >
            {items.map((cmd) => (
              <Command.Item
                key={cmd.id}
                value={cmd.id}
                keywords={[cmd.label, ...(cmd.keywords ?? [])]}
                disabled={!cmd.enabled}
                onSelect={() => {
                  cmd.execute();
                  onClose();
                }}
                className="flex items-center justify-between px-3 py-1.5 text-sm cursor-pointer
                           text-text-primary data-[selected=true]:bg-accent/20
                           data-[disabled=true]:text-text-muted data-[disabled=true]:cursor-not-allowed"
              >
                <span>{cmd.label}</span>
                {cmd.shortcut && (
                  <kbd
                    className="ml-4 shrink-0 bg-bg-primary text-text-secondary text-xs
                               px-1.5 py-0.5 rounded border border-border-default font-mono"
                  >
                    {cmd.shortcut}
                  </kbd>
                )}
              </Command.Item>
            ))}
          </Command.Group>
        );
      })}
    </>
  );
}

// --- Shell command history ---

const SHELL_HISTORY_KEY = 'shell-history';
const MAX_HISTORY_ITEMS = 20;

async function loadShellHistory(): Promise<string[]> {
  try {
    const raw = await window.mcode.preferences.get(SHELL_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function saveToShellHistory(command: string): Promise<void> {
  const history = await loadShellHistory();
  // Remove duplicate if exists, then prepend
  const filtered = history.filter((h) => h !== command);
  filtered.unshift(command);
  const trimmed = filtered.slice(0, MAX_HISTORY_ITEMS);
  await window.mcode.preferences.set(SHELL_HISTORY_KEY, JSON.stringify(trimmed));
}

// --- Shell mode content ---

function ShellModeContent({
  query,
  onClose,
  onSetInput,
}: {
  query: string;
  onClose: () => void;
  onSetInput: (value: string) => void;
}): React.JSX.Element {
  const cwd = useMemo(() => resolveActiveCwd(), []);
  const cwdBasename = useMemo(() => basename(cwd), [cwd]);
  const [history, setHistory] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Load history on mount
  useEffect(() => {
    loadShellHistory().then(setHistory).catch(() => {});
  }, []);

  const handleRun = useCallback((cmd?: string) => {
    const toRun = cmd ?? query.trim();
    if (!toRun) return;
    saveToShellHistory(toRun).catch(console.error);
    runShellCommand(toRun, cwd).catch(console.error);
    onClose();
  }, [query, cwd, onClose]);

  // Listen for Enter to run, Up/Down to navigate history
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleRun();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.min(selectedIndexRef.current + 1, history.length - 1);
        setSelectedIndex(next);
        if (next >= 0 && history[next]) {
          onSetInput(`! ${history[next]}`);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = selectedIndexRef.current - 1;
        if (next < 0) {
          setSelectedIndex(-1);
          onSetInput('! ');
        } else {
          setSelectedIndex(next);
          if (history[next]) {
            onSetInput(`! ${history[next]}`);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRun, history, onSetInput]);

  // Filter history by query for display
  const filteredHistory = useMemo(() => {
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      return history.filter((h) => h.toLowerCase().includes(q));
    }
    return history;
  }, [history, query]);

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-text-muted text-xs">
          Run in <span className="text-text-secondary font-mono">{cwdBasename}</span>
        </span>
        {query ? (
          <span className="text-text-muted text-xs">
            <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default text-xs font-mono">Enter</kbd> to run
            {' · '}
            <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default text-xs font-mono">↑↓</kbd> history
          </span>
        ) : (
          <span className="text-text-muted text-xs">
            <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default text-xs font-mono">↑↓</kbd> history
          </span>
        )}
      </div>
      {/* History list */}
      {filteredHistory.length > 0 && !query.trim() && (
        <div className="border-t border-border-subtle mt-1">
          <div className="px-4 py-1.5 text-xs text-text-muted uppercase tracking-wide font-medium">
            Recent
          </div>
          {filteredHistory.map((cmd, i) => (
            <button
              key={cmd}
              type="button"
              className={`
                w-full text-left px-4 py-1.5 text-xs font-mono cursor-pointer
                ${i === selectedIndex ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-secondary'}
              `}
              onClick={() => handleRun(cmd)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              {cmd}
            </button>
          ))}
        </div>
      )}
      {/* Filtered history when typing */}
      {filteredHistory.length > 0 && query.trim() && (
        <div className="border-t border-border-subtle mt-1">
          {filteredHistory.map((cmd) => (
            <button
              key={cmd}
              type="button"
              className="w-full text-left px-4 py-1.5 text-xs font-mono text-text-secondary hover:bg-bg-secondary cursor-pointer"
              onClick={() => handleRun(cmd)}
            >
              {cmd}
            </button>
          ))}
        </div>
      )}
      {!query.trim() && filteredHistory.length === 0 && (
        <div className="px-4 pb-3 pt-1 text-text-muted text-xs">
          Type a shell command...
        </div>
      )}
    </div>
  );
}

// --- Main palette ---

function CommandPalette({ initialMode, onClose }: CommandPaletteProps): React.JSX.Element {
  const [input, setInput] = useState(
    initialMode === 'commands' ? '> '
    : initialMode === 'shell' ? '! '
    : initialMode === 'snippets' ? '@ '
    : '',
  );

  // Derive mode from input value
  const mode = input.startsWith('!')
    ? 'shell'
    : input.startsWith('>')
      ? 'commands'
      : input.startsWith('@')
        ? 'snippets'
        : 'files';
  const searchQuery = mode === 'commands' || mode === 'shell' || mode === 'snippets'
    ? input.slice(1).trimStart()
    : input;

  // Save focus target before autoFocus steals it; restore on unmount
  const restoreFocusRef = useRef(createFocusRestorer());
  useEffect(() => () => restoreFocusRef.current(), []);

  // Escape override for snippet variable form (back to search instead of closing)
  const escapeOverrideRef = useRef<(() => void) | null>(null);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (escapeOverrideRef.current) {
          escapeOverrideRef.current();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-[600px] max-w-[90vw] bg-bg-elevated border border-border-subtle rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <Command
          loop
          className="[&>label]:hidden"
          shouldFilter={mode === 'commands'}
          filter={(value, search, keywords) => {
            const q = search.startsWith('>') ? search.slice(1).trimStart() : search;
            if (!q) return 1;
            return defaultFilter(value, q, keywords);
          }}
        >
          <Command.Input
            autoFocus
            value={input}
            onValueChange={setInput}
            placeholder={
              mode === 'shell'
                ? '! Type a shell command...'
                : mode === 'commands'
                  ? '> Type a command...'
                  : mode === 'snippets'
                    ? '@ Search snippets...'
                    : 'Search files by name...'
            }
            className="w-full px-4 py-3 bg-transparent text-text-primary text-sm
                       outline-none placeholder:text-text-muted"
          />
          <Command.List className="max-h-[50vh] overflow-y-auto py-1 border-t border-border-subtle">
            {mode === 'snippets' ? (
              <SnippetItems query={searchQuery} onClose={onClose} escapeOverrideRef={escapeOverrideRef} />
            ) : mode === 'shell' ? (
              <ShellModeContent query={searchQuery} onClose={onClose} onSetInput={setInput} />
            ) : mode === 'files' ? (
              <>
                <FileSearchItems query={searchQuery} onClose={onClose} />
                {/* Hints for other modes */}
                {!searchQuery && (
                  <div className="px-4 py-1.5 text-xs text-text-muted border-t border-border-subtle mt-1">
                    Type <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default font-mono">!</kbd> to run a shell command
                    {' · '}
                    Type <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default font-mono">@</kbd> to insert a snippet
                  </div>
                )}
              </>
            ) : (
              <CommandItems onClose={onClose} />
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

export default CommandPalette;
