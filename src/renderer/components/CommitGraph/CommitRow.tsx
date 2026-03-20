import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { CommitGraphRow } from '../../utils/lane-algorithm';
import type { CommitFileEntry } from '../../../shared/types';
import { useLayoutStore } from '../../stores/layout-store';

const ROW_HEIGHT = 24;

const FILE_STATUS_COLORS: Record<string, string> = {
  M: 'text-yellow-400',
  A: 'text-green-400',
  D: 'text-red-400',
  R: 'text-blue-400',
};

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function CommitFileRow({
  file,
  repoRoot,
  commitHash,
}: {
  file: CommitFileEntry;
  repoRoot: string;
  commitHash: string;
}): React.JSX.Element {
  const addDiffViewer = useLayoutStore((s) => s.addDiffViewer);
  const persist = useLayoutStore((s) => s.persist);

  const filename = file.path.includes('/')
    ? file.path.slice(file.path.lastIndexOf('/') + 1)
    : file.path;

  const handleClick = (): void => {
    const absolutePath = `${repoRoot}/${file.path}`;
    addDiffViewer(absolutePath, commitHash);
    persist();
  };

  return (
    <button
      className="flex items-center w-full px-2 py-0.5 hover:bg-bg-elevated transition-colors text-left gap-1.5 group"
      onClick={handleClick}
    >
      <span className={`text-xs font-mono w-3 shrink-0 ${FILE_STATUS_COLORS[file.status] ?? 'text-text-muted'}`}>
        {file.status}
      </span>
      <span className="text-xs text-text-primary truncate">{filename}</span>
      {file.insertions > 0 && (
        <span className="text-xs text-green-400 shrink-0">+{file.insertions}</span>
      )}
      {file.deletions > 0 && (
        <span className="text-xs text-red-400 shrink-0">-{file.deletions}</span>
      )}
    </button>
  );
}

function CommitRow({
  row,
  repoRoot,
}: {
  row: CommitGraphRow;
  repoRoot: string;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [files, setFiles] = useState<CommitFileEntry[] | null>(null);
  const [loading, setLoading] = useState(false);

  const handleToggle = async (): Promise<void> => {
    if (expanded) {
      setExpanded(false);
      return;
    }

    setExpanded(true);

    if (files === null) {
      setLoading(true);
      try {
        const result = await window.mcode.git.getCommitFiles(repoRoot, row.node.hash);
        setFiles(result);
      } catch (err) {
        console.error('Failed to fetch commit files:', err);
        setFiles([]);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div>
      <button
        className="flex items-center w-full px-1.5 hover:bg-bg-elevated/50 transition-colors text-left gap-1"
        style={{ height: ROW_HEIGHT }}
        onClick={handleToggle}
      >
        {expanded
          ? <ChevronDown size={10} className="text-text-muted shrink-0" />
          : <ChevronRight size={10} className="text-text-muted shrink-0" />}
        <span className="text-xs font-mono text-text-muted shrink-0">{row.node.shortHash}</span>
        <span className="text-xs text-text-primary truncate flex-1">{row.node.message}</span>
        {row.node.refs.length > 0 && row.node.refs.map((ref) => (
          <span
            key={ref}
            className="text-xs px-1 rounded bg-accent/20 text-accent shrink-0"
          >
            {ref}
          </span>
        ))}
        {row.node.isClaudeAssisted && (
          <span className="text-xs text-purple-400 shrink-0">●</span>
        )}
        <span className="text-xs text-text-muted shrink-0">{relativeTime(row.node.committedAt)}</span>
      </button>
      {expanded && (
        <div className="ml-4 border-l border-border-default/50 pl-1">
          {loading && (
            <div className="px-2 py-1 text-xs text-text-muted">Loading...</div>
          )}
          {files && files.length === 0 && !loading && (
            <div className="px-2 py-1 text-xs text-text-muted">No files changed</div>
          )}
          {files?.map((file) => (
            <CommitFileRow
              key={file.path}
              file={file}
              repoRoot={repoRoot}
              commitHash={row.node.hash}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default CommitRow;
