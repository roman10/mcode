import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { useChangesStore } from '../../stores/changes-store';
import { useLayoutStore } from '../../stores/layout-store';
import Tooltip from '../shared/Tooltip';
import type { GitChangedFile, GitFileStatus } from '../../../shared/types';

const STATUS_LABELS: Record<GitFileStatus, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: '?',
};

const STATUS_COLORS: Record<GitFileStatus, string> = {
  modified: 'text-yellow-400',
  added: 'text-green-400',
  deleted: 'text-red-400',
  renamed: 'text-blue-400',
  untracked: 'text-text-muted',
};

function repoBasename(repoRoot: string): string {
  const last = repoRoot.lastIndexOf('/');
  return last >= 0 ? repoRoot.slice(last + 1) : repoRoot;
}

function FileRow({ file, repoRoot }: { file: GitChangedFile; repoRoot: string }): React.JSX.Element {
  const addDiffViewer = useLayoutStore((s) => s.addDiffViewer);
  const persist = useLayoutStore((s) => s.persist);

  const handleClick = (): void => {
    const absolutePath = `${repoRoot}/${file.path}`;
    addDiffViewer(absolutePath);
    persist();
  };

  const filename = file.path.includes('/')
    ? file.path.slice(file.path.lastIndexOf('/') + 1)
    : file.path;
  const directory = file.path.includes('/')
    ? file.path.slice(0, file.path.lastIndexOf('/'))
    : '';

  return (
    <button
      className="flex items-center w-full px-3 py-1 hover:bg-bg-elevated transition-colors text-left gap-2 group"
      onClick={handleClick}
    >
      <span className={`text-xs font-mono w-4 shrink-0 ${STATUS_COLORS[file.status]}`}>
        {STATUS_LABELS[file.status]}
      </span>
      <span className="text-sm text-text-primary truncate">{filename}</span>
      {directory && (
        <span className="text-xs text-text-muted truncate ml-auto shrink-0">{directory}</span>
      )}
    </button>
  );
}

function RepoSection({ repoRoot, files }: { repoRoot: string; files: GitChangedFile[] }): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <button
        className="flex items-center w-full px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-elevated transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        <span className="ml-1 font-medium truncate">{repoBasename(repoRoot)}</span>
        <span className="ml-auto text-text-muted">{files.length}</span>
      </button>
      {!collapsed && files.map((file) => (
        <FileRow key={file.path} file={file} repoRoot={repoRoot} />
      ))}
    </div>
  );
}

function ChangesPanel(): React.JSX.Element {
  const statuses = useChangesStore((s) => s.statuses);
  const loading = useChangesStore((s) => s.loading);
  const refreshAll = useChangesStore((s) => s.refreshAll);
  const activeSidebarTab = useLayoutStore((s) => s.activeSidebarTab);

  const totalFiles = statuses.reduce((sum, s) => sum + s.files.length, 0);

  // Refresh on mount and when tab becomes active
  useEffect(() => {
    if (activeSidebarTab === 'changes') {
      refreshAll();
    }
  }, [activeSidebarTab, refreshAll]);

  // Refresh on window focus
  const handleVisibilityChange = useCallback(() => {
    if (!document.hidden && activeSidebarTab === 'changes') {
      refreshAll();
    }
  }, [activeSidebarTab, refreshAll]);

  useEffect(() => {
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [handleVisibilityChange]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-default shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-text-secondary uppercase tracking-wide">Changes</span>
          {totalFiles > 0 && (
            <span className="text-xs text-text-muted">({totalFiles})</span>
          )}
        </div>
        <Tooltip content="Refresh" side="bottom">
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
            onClick={() => refreshAll()}
            disabled={loading}
          >
            <RefreshCw size={14} strokeWidth={1.5} className={loading ? 'animate-spin' : ''} />
          </button>
        </Tooltip>
      </div>

      {/* File list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {statuses.length === 0 && !loading && (
          <div className="px-3 py-8 text-center text-sm text-text-muted">
            No uncommitted changes
          </div>
        )}
        {statuses.map((status) => (
          <RepoSection
            key={status.repoRoot}
            repoRoot={status.repoRoot}
            files={status.files}
          />
        ))}
      </div>
    </div>
  );
}

export default ChangesPanel;
