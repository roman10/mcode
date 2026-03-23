import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ChevronDown, ChevronRight, Plus, Minus, Undo2, PlusSquare, MinusSquare, Trash2 } from 'lucide-react';
import { useChangesStore } from '../../stores/changes-store';
import { useLayoutStore } from '../../stores/layout-store';
import Tooltip from '../shared/Tooltip';
import Dialog from '../shared/Dialog';
import type { GitChangedFile, GitFileStatus } from '@shared/types';

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

interface FileRowProps {
  file: GitChangedFile;
  repoRoot: string;
  area: 'staged' | 'unstaged';
  onStage?: () => void;
  onUnstage?: () => void;
  onDiscard?: () => void;
}

function FileRow({ file, repoRoot, area, onStage, onUnstage, onDiscard }: FileRowProps): React.JSX.Element {
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
    <div className="group flex items-center w-full px-3 py-1 hover:bg-bg-elevated transition-colors gap-2">
      {/* Clickable area for diff */}
      <button
        className="flex items-center gap-2 flex-1 min-w-0 text-left"
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

      {/* Action buttons — visible on hover */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        {area === 'unstaged' && onStage && (
          <Tooltip content="Stage" side="bottom">
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-green-400 hover:bg-bg-elevated transition-colors"
              onClick={(e) => { e.stopPropagation(); onStage(); }}
            >
              <Plus size={12} />
            </button>
          </Tooltip>
        )}
        {area === 'staged' && onUnstage && (
          <Tooltip content="Unstage" side="bottom">
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-yellow-400 hover:bg-bg-elevated transition-colors"
              onClick={(e) => { e.stopPropagation(); onUnstage(); }}
            >
              <Minus size={12} />
            </button>
          </Tooltip>
        )}
        {area === 'unstaged' && onDiscard && (
          <Tooltip content="Discard Changes" side="bottom">
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-red-400 hover:bg-bg-elevated transition-colors"
              onClick={(e) => { e.stopPropagation(); onDiscard(); }}
            >
              <Undo2 size={12} />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

type DiscardConfirm =
  | { type: 'file'; file: GitChangedFile }
  | { type: 'all' };

function RepoSection({
  repoRoot,
  staged,
  unstaged,
}: {
  repoRoot: string;
  staged: GitChangedFile[];
  unstaged: GitChangedFile[];
}): React.JSX.Element {
  const [stagedCollapsed, setStagedCollapsed] = useState(false);
  const [unstagedCollapsed, setUnstagedCollapsed] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState<DiscardConfirm | null>(null);

  const stageFile = useChangesStore((s) => s.stageFile);
  const unstageFile = useChangesStore((s) => s.unstageFile);
  const discardFile = useChangesStore((s) => s.discardFile);
  const stageAll = useChangesStore((s) => s.stageAll);
  const unstageAll = useChangesStore((s) => s.unstageAll);
  const discardAll = useChangesStore((s) => s.discardAll);

  const handleDiscardConfirm = async (): Promise<void> => {
    if (!discardConfirm) return;
    if (discardConfirm.type === 'file') {
      await discardFile(repoRoot, discardConfirm.file.path, discardConfirm.file.status === 'untracked');
    } else {
      await discardAll(repoRoot);
    }
    setDiscardConfirm(null);
  };

  const discardConfirmTitle = discardConfirm?.type === 'file'
    ? `Discard changes to "${discardConfirm.file.path.includes('/') ? discardConfirm.file.path.slice(discardConfirm.file.path.lastIndexOf('/') + 1) : discardConfirm.file.path}"?`
    : `Discard all changes in "${repoBasename(repoRoot)}"?`;

  const discardConfirmDesc = discardConfirm?.type === 'all'
    ? 'This will revert all tracked file changes. This cannot be undone.'
    : 'This cannot be undone.';

  return (
    <div>
      {/* Discard confirmation dialog */}
      <Dialog
        open={discardConfirm !== null}
        onOpenChange={(open) => { if (!open) setDiscardConfirm(null); }}
        title={discardConfirmTitle}
        description={discardConfirmDesc}
        closeOnOverlayClick={false}
      >
        <div className="flex justify-end gap-2 mt-4">
          <button
            className="inline-flex items-center px-3 py-1.5 text-sm rounded border border-border-default text-text-secondary hover:bg-bg-elevated transition-colors"
            onClick={() => setDiscardConfirm(null)}
          >
            Cancel
            <kbd className="ml-2 text-xs opacity-70 font-mono">Esc</kbd>
          </button>
          <button
            className="px-3 py-1.5 text-sm rounded bg-red-600 hover:bg-red-700 text-white transition-colors"
            onClick={handleDiscardConfirm}
          >
            Discard
          </button>
        </div>
      </Dialog>

      {/* Repo header */}
      <div className="px-3 py-1.5 text-xs text-text-muted font-medium truncate border-b border-border-default">
        {repoBasename(repoRoot)}
      </div>

      {/* Staged Changes section */}
      {staged.length > 0 && (
        <div>
          <div className="flex items-center w-full px-3 py-1 text-xs text-text-secondary hover:bg-bg-elevated transition-colors">
            <button
              className="flex items-center gap-1 flex-1 min-w-0"
              onClick={() => setStagedCollapsed(!stagedCollapsed)}
            >
              {stagedCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
              <span className="font-medium uppercase tracking-wide">Staged Changes</span>
              <span className="ml-1 text-text-muted">({staged.length})</span>
            </button>
            <div className="flex items-center gap-0.5 shrink-0">
              <Tooltip content="Unstage All" side="bottom">
                <button
                  className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-yellow-400 hover:bg-bg-elevated transition-colors"
                  onClick={() => unstageAll(repoRoot)}
                >
                  <MinusSquare size={12} />
                </button>
              </Tooltip>
            </div>
          </div>
          {!stagedCollapsed && staged.map((file) => (
            <FileRow
              key={`staged-${file.path}`}
              file={file}
              repoRoot={repoRoot}
              area="staged"
              onUnstage={() => unstageFile(repoRoot, file.path)}
            />
          ))}
        </div>
      )}

      {/* Unstaged Changes section */}
      {unstaged.length > 0 && (
        <div>
          <div className="flex items-center w-full px-3 py-1 text-xs text-text-secondary hover:bg-bg-elevated transition-colors">
            <button
              className="flex items-center gap-1 flex-1 min-w-0"
              onClick={() => setUnstagedCollapsed(!unstagedCollapsed)}
            >
              {unstagedCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
              <span className="font-medium uppercase tracking-wide">Changes</span>
              <span className="ml-1 text-text-muted">({unstaged.length})</span>
            </button>
            <div className="flex items-center gap-0.5 shrink-0">
              <Tooltip content="Stage All" side="bottom">
                <button
                  className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-green-400 hover:bg-bg-elevated transition-colors"
                  onClick={() => stageAll(repoRoot)}
                >
                  <PlusSquare size={12} />
                </button>
              </Tooltip>
              <Tooltip content="Discard All" side="bottom">
                <button
                  className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-red-400 hover:bg-bg-elevated transition-colors"
                  onClick={() => setDiscardConfirm({ type: 'all' })}
                >
                  <Trash2 size={12} />
                </button>
              </Tooltip>
            </div>
          </div>
          {!unstagedCollapsed && unstaged.map((file) => (
            <FileRow
              key={`unstaged-${file.path}`}
              file={file}
              repoRoot={repoRoot}
              area="unstaged"
              onStage={() => stageFile(repoRoot, file.path)}
              onDiscard={() => setDiscardConfirm({ type: 'file', file })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ChangesPanel(): React.JSX.Element {
  const statuses = useChangesStore((s) => s.statuses);
  const loading = useChangesStore((s) => s.loading);
  const refreshAll = useChangesStore((s) => s.refreshAll);
  const activeSidebarTab = useLayoutStore((s) => s.activeSidebarTab);

  const totalFiles = statuses.reduce((sum, s) => sum + s.staged.length + s.unstaged.length, 0);

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
            staged={status.staged}
            unstaged={status.unstaged}
          />
        ))}
      </div>
    </div>
  );
}

export default ChangesPanel;
