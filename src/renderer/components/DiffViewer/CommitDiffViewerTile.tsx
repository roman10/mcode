import { useEffect, useState, useMemo, useCallback } from 'react';
import { X, GitCommitHorizontal } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView, keymap } from '@codemirror/view';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { unifiedMergeView } from '@codemirror/merge';
import type { Extension } from '@codemirror/state';
import { useLayoutStore } from '../../stores/layout-store';
import Tooltip from '../shared/Tooltip';
import { mcodeEditorExtension, hideCursorExtension, diffTheme } from '../../styles/editor-theme';
import type { GitDiffContent } from '../../../shared/types';

const STATUS_COLORS: Record<string, string> = {
  modified: 'text-yellow-400',
  added: 'text-green-400',
  deleted: 'text-red-400',
};

interface CommitDiffViewerTileProps {
  absolutePath: string;
  commitHash: string;
}

function CommitDiffViewerTile({ absolutePath, commitHash }: CommitDiffViewerTileProps): React.JSX.Element {
  const [diffContent, setDiffContent] = useState<GitDiffContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [langExtension, setLangExtension] = useState<Extension | null>(null);
  const removeAnyTile = useLayoutStore((s) => s.removeAnyTile);
  const persist = useLayoutStore((s) => s.persist);

  const filename = useMemo(() => {
    const lastSlash = absolutePath.lastIndexOf('/');
    return lastSlash >= 0 ? absolutePath.slice(lastSlash + 1) : absolutePath;
  }, [absolutePath]);

  const directory = useMemo(() => {
    const lastSlash = absolutePath.lastIndexOf('/');
    return lastSlash >= 0 ? absolutePath.slice(0, lastSlash) : '';
  }, [absolutePath]);

  // Load diff content for this specific commit
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Extract repo root: walk up from the file path to find git root
    // For commit diffs, we use the directory portion as cwd
    const dir = absolutePath.slice(0, absolutePath.lastIndexOf('/'));

    // First resolve the repo root, then get the commit diff
    window.mcode.git.getStatus(dir).then((status) => {
      if (cancelled) return;
      const repoRoot = status.repoRoot;
      const relPath = absolutePath.startsWith(repoRoot + '/')
        ? absolutePath.slice(repoRoot.length + 1)
        : absolutePath;

      return window.mcode.git.getCommitFileDiff(repoRoot, commitHash, relPath);
    }).then((result) => {
      if (cancelled || !result) return;
      setDiffContent(result);
      setLoading(false);
    }).catch((err) => {
      if (cancelled) return;
      setError(String(err));
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [absolutePath, commitHash]);

  // Load language extension for syntax highlighting
  useEffect(() => {
    const desc = LanguageDescription.matchFilename(languages, filename);
    if (desc) {
      desc.load().then((support) => {
        setLangExtension(support);
      }).catch(() => {});
    }
  }, [filename]);

  const tileId = `commit-diff:${commitHash}:${absolutePath}`;

  const handleClose = useCallback((): void => {
    removeAnyTile(tileId);
    persist();
  }, [removeAnyTile, tileId, persist]);

  const status = useMemo(() => {
    if (!diffContent || diffContent.binary) return 'modified';
    if (!diffContent.originalContent) return 'added';
    if (!diffContent.modifiedContent) return 'deleted';
    return 'modified';
  }, [diffContent]);

  const extensions = useMemo(() => {
    if (!diffContent || diffContent.binary) return [];

    const exts: Extension[] = [
      ...mcodeEditorExtension,
      diffTheme,
      hideCursorExtension,
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      keymap.of([{
        key: 'Mod-w',
        run: () => { handleClose(); return true; },
      }]),
      unifiedMergeView({
        original: diffContent.originalContent,
        highlightChanges: true,
        gutter: true,
        mergeControls: false,
      }),
    ];
    if (langExtension) exts.push(langExtension);
    return exts;
  }, [diffContent, langExtension, handleClose]);

  const toolbar = (
    <div className="flex items-center px-3 py-1 border-b border-border-default shrink-0 gap-2">
      <GitCommitHorizontal size={14} className="text-text-muted shrink-0" />
      <span className="text-sm text-text-primary truncate">{filename}</span>
      <span className={`text-xs font-mono shrink-0 ${STATUS_COLORS[status] ?? 'text-text-muted'}`}>
        {status === 'added' ? 'A' : status === 'deleted' ? 'D' : 'M'}
      </span>
      <span className="text-xs text-text-muted font-mono shrink-0">{commitHash.slice(0, 7)}</span>
      {directory && (
        <span className="text-xs text-text-muted truncate">{directory}</span>
      )}
      <div className="ml-auto shrink-0">
        <Tooltip content="Close (⌘W)" side="bottom">
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
            onClick={handleClose}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </Tooltip>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex flex-col h-full bg-bg-primary">
        {toolbar}
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          Loading diff...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col h-full bg-bg-primary">
        {toolbar}
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm px-4 text-center">
          {error}
        </div>
      </div>
    );
  }

  if (diffContent?.binary) {
    return (
      <div className="flex flex-col h-full bg-bg-primary">
        {toolbar}
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          Binary file — diff not available
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {toolbar}
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeMirror
          value={diffContent && !diffContent.binary ? diffContent.modifiedContent : ''}
          theme="none"
          extensions={extensions}
          editable={false}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: false,
            highlightSelectionMatches: false,
          }}
          className="h-full text-[13px] [&_.cm-editor]:h-full"
        />
      </div>
    </div>
  );
}

export default CommitDiffViewerTile;
