import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Command } from 'cmdk';
import uFuzzy from '@leeoniya/ufuzzy';
import { useLayoutStore } from '../../stores/layout-store';
import { useSessionStore } from '../../stores/session-store';
import { normalizeCwd } from '../../utils/path-utils';
import { getFileIcon } from '../../utils/file-icons';
import HighlightedText from './HighlightedText';
import { dedupeFileEntries, type FileEntry } from './file-entry-dedup';

const uf = new uFuzzy({ intraMode: 1 });

interface FilteredEntry extends FileEntry {
  ranges: number[] | null;
}

interface FileSearchItemsProps {
  query: string;
  onClose: () => void;
}

function FileSearchItems({ query, onClose }: FileSearchItemsProps): React.JSX.Element {
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [repoCount, setRepoCount] = useState(0);

  // Only consider sessions the user could plausibly want to search files for.
  // Ended sessions linger in the store (session-repository.listSessions returns
  // them all so kanban / activity views can show them) but their cwds shouldn't
  // pollute Quick Open.
  const aliveSessions = useMemo(
    () => Object.values(sessions).filter((s) => s.status !== 'ended'),
    [sessions],
  );

  // Determine primary cwd (selected session or most recent alive session)
  const primaryCwd = useMemo(() => {
    const selected = selectedSessionId ? sessions[selectedSessionId] : null;
    if (selected && selected.status !== 'ended') return normalizeCwd(selected.cwd);
    const sorted = [...aliveSessions].sort(
      (a, b) => b.startedAt.localeCompare(a.startedAt),
    );
    const cwd = sorted[0]?.cwd;
    return cwd ? normalizeCwd(cwd) : null;
  }, [sessions, selectedSessionId, aliveSessions]);

  // Collect unique cwds, normalized so trailing-slash variants collapse to a
  // single root. Stabilized to avoid re-fetching when unrelated session fields
  // change (status transitions among alive states, lastEventAt, etc.)
  const uniqueCwdsRaw = useMemo(() => {
    const cwds = new Set(aliveSessions.map((s) => normalizeCwd(s.cwd)));
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
  }, [aliveSessions, primaryCwd]);

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
      const fulfilled = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
      setEntries(dedupeFileEntries(fulfilled, primaryCwd));
      setRepoCount(uniqueCwds.length);
      setLoading(false);
    });
  }, [uniqueCwds, primaryCwd]);

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

export default FileSearchItems;
