import { useEffect, useState, useMemo, useCallback } from 'react';
import { Command } from 'cmdk';
import uFuzzy from '@leeoniya/ufuzzy';
import { FileText } from 'lucide-react';
import { useSessionStore } from '../stores/session-store';
import { useLayoutStore } from '../stores/layout-store';
import { getCommands } from '../command-palette/command-registry';

const uf = new uFuzzy({ intraMode: 1 });

interface CommandPaletteProps {
  initialMode: 'files' | 'commands';
  onClose(): void;
}

// --- File search items ---

function FileSearchItems({
  query,
  onClose,
}: {
  query: string;
  onClose: () => void;
}): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [cwd, setCwd] = useState<string | null>(null);

  // Determine cwd from selected session or most recent session
  useEffect(() => {
    const selected = selectedSessionId ? sessions[selectedSessionId] : null;
    if (selected) {
      setCwd(selected.cwd);
      return;
    }
    // Fall back to most recently created session
    const sorted = Object.values(sessions).sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt),
    );
    setCwd(sorted[0]?.cwd ?? null);
  }, [sessions, selectedSessionId]);

  // Fetch file list when cwd changes
  useEffect(() => {
    if (!cwd) {
      setLoading(false);
      return;
    }
    setLoading(true);
    window.mcode.files.list(cwd).then((result) => {
      setFiles(result.files);
      setLoading(false);
    }).catch(() => {
      setFiles([]);
      setLoading(false);
    });
  }, [cwd]);

  // Fuzzy filter
  const filtered = useMemo(() => {
    if (!query.trim()) {
      // Show first 50 files when no query
      return files.slice(0, 50).map((f) => ({ path: f, ranges: null }));
    }

    const idxs = uf.filter(files, query);
    if (!idxs || idxs.length === 0) return [];

    const info = uf.info(idxs, files, query);
    const order = uf.sort(info, files, query);

    return order.slice(0, 50).map((sortIdx) => {
      const fileIdx = info.idx[sortIdx];
      return {
        path: files[fileIdx],
        ranges: (info.ranges[sortIdx] ?? null) as number[] | null,
      };
    });
  }, [files, query]);

  const handleSelect = useCallback(
    (relativePath: string) => {
      if (!cwd) return;
      const absolutePath = cwd.endsWith('/') ? cwd + relativePath : `${cwd}/${relativePath}`;
      useLayoutStore.getState().addFileViewer(absolutePath);
      useLayoutStore.getState().persist();
      onClose();
    },
    [cwd, onClose],
  );

  if (loading) {
    return (
      <Command.Empty className="px-4 py-6 text-center text-sm text-text-muted">
        Loading files...
      </Command.Empty>
    );
  }

  if (!cwd) {
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
            key={item.path}
            value={item.path}
            onSelect={() => handleSelect(item.path)}
            className="flex items-center gap-2 px-4 py-2 text-sm cursor-pointer
                       text-text-primary data-[selected=true]:bg-accent/15"
          >
            <FileText size={14} className="shrink-0 text-text-muted" />
            <span className="truncate">
              {item.ranges ? (
                <HighlightedText text={item.path} ranges={item.ranges} />
              ) : (
                <>
                  <span className="font-medium">{filename}</span>
                  {directory && (
                    <span className="text-text-muted ml-2">{directory}</span>
                  )}
                </>
              )}
            </span>
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
                className="flex items-center justify-between px-4 py-2 text-sm cursor-pointer
                           text-text-primary data-[selected=true]:bg-accent/15
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

// --- Main palette ---

function CommandPalette({ initialMode, onClose }: CommandPaletteProps): React.JSX.Element {
  const [input, setInput] = useState(initialMode === 'commands' ? '> ' : '');

  // Derive mode from input value
  const mode = input.startsWith('>') ? 'commands' : 'files';
  const searchQuery = mode === 'commands' ? input.slice(1).trimStart() : input;

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Show cwd in the header for file mode
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const cwdLabel = useMemo(() => {
    if (mode !== 'files') return null;
    const selected = selectedSessionId ? sessions[selectedSessionId] : null;
    if (selected) return selected.cwd;
    const sorted = Object.values(sessions).sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt),
    );
    return sorted[0]?.cwd ?? null;
  }, [mode, sessions, selectedSessionId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-[520px] bg-bg-elevated border border-border-default rounded-lg shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {cwdLabel && (
          <div className="px-4 pt-2 pb-0">
            <span className="text-xs text-text-muted truncate block">{cwdLabel}</span>
          </div>
        )}
        <Command
          loop
          className="[&>label]:hidden"
          shouldFilter={mode === 'commands'}
        >
          <Command.Input
            autoFocus
            value={input}
            onValueChange={setInput}
            placeholder={
              mode === 'files'
                ? 'Search files by name...'
                : '> Type a command...'
            }
            className="w-full px-4 py-3 bg-transparent text-text-primary text-sm
                       border-b border-border-default outline-none placeholder:text-text-muted"
          />
          <Command.List className="max-h-[50vh] overflow-y-auto py-1">
            {mode === 'files' ? (
              <FileSearchItems query={searchQuery} onClose={onClose} />
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
