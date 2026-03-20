import { useEffect, useState, useMemo } from 'react';
import { X, FileDiff } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import { unifiedMergeView } from '@codemirror/merge';
import type { Extension } from '@codemirror/state';
import { useLayoutStore } from '../../stores/layout-store';
import Tooltip from '../shared/Tooltip';
import { mcodeEditorExtension, hideCursorExtension, diffTheme } from '../../styles/editor-theme';
import type { GitDiffContent } from '../../../shared/types';

interface DiffViewerTileProps {
  absolutePath: string;
}

const STATUS_COLORS: Record<string, string> = {
  modified: 'text-yellow-400',
  added: 'text-green-400',
  deleted: 'text-red-400',
  untracked: 'text-text-muted',
};

function DiffViewerTile({ absolutePath }: DiffViewerTileProps): React.JSX.Element {
  const [diffContent, setDiffContent] = useState<GitDiffContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [langExtension, setLangExtension] = useState<Extension | null>(null);
  const removeDiffTile = useLayoutStore((s) => s.removeDiffTile);
  const persist = useLayoutStore((s) => s.persist);

  const filename = useMemo(() => {
    const lastSlash = absolutePath.lastIndexOf('/');
    return lastSlash >= 0 ? absolutePath.slice(lastSlash + 1) : absolutePath;
  }, [absolutePath]);

  const directory = useMemo(() => {
    const lastSlash = absolutePath.lastIndexOf('/');
    return lastSlash >= 0 ? absolutePath.slice(0, lastSlash) : '';
  }, [absolutePath]);

  // Determine diff status from content
  const status = useMemo(() => {
    if (!diffContent || diffContent.binary) return 'modified';
    if (!diffContent.originalContent) return 'added';
    if (!diffContent.modifiedContent) return 'deleted';
    return 'modified';
  }, [diffContent]);

  // Load diff content
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    // Pass the file's directory as cwd; backend resolves repo root from it
    const dir = absolutePath.slice(0, absolutePath.lastIndexOf('/'));

    window.mcode.git.getDiffContent(dir, absolutePath)
      .then((result) => {
        if (cancelled) return;
        setDiffContent(result);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [absolutePath]);

  // Load language extension for syntax highlighting
  useEffect(() => {
    const desc = LanguageDescription.matchFilename(languages, filename);
    if (desc) {
      desc.load().then((support) => {
        setLangExtension(support);
      }).catch(() => {
        // Language loading failed — render without highlighting
      });
    }
  }, [filename]);

  const handleClose = (): void => {
    removeDiffTile(absolutePath);
    persist();
  };

  const extensions = useMemo(() => {
    if (!diffContent || diffContent.binary) return [];

    const exts: Extension[] = [
      ...mcodeEditorExtension,
      diffTheme,
      hideCursorExtension,
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      unifiedMergeView({
        original: diffContent.originalContent,
        highlightChanges: true,
        gutter: true,
        mergeControls: false,
      }),
    ];
    if (langExtension) exts.push(langExtension);
    return exts;
  }, [diffContent, langExtension]);

  // Show loading state
  if (loading) {
    return (
      <div className="flex flex-col h-full bg-bg-primary">
        <TileToolbar
          filename={filename}
          directory={directory}
          status={status}
          onClose={handleClose}
        />
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          Loading diff...
        </div>
      </div>
    );
  }

  // Show error
  if (error) {
    return (
      <div className="flex flex-col h-full bg-bg-primary">
        <TileToolbar
          filename={filename}
          directory={directory}
          status={status}
          onClose={handleClose}
        />
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm px-4 text-center">
          {error}
        </div>
      </div>
    );
  }

  // Binary file
  if (diffContent?.binary) {
    return (
      <div className="flex flex-col h-full bg-bg-primary">
        <TileToolbar
          filename={filename}
          directory={directory}
          status={status}
          onClose={handleClose}
        />
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          Binary file — diff not available
        </div>
      </div>
    );
  }

  // No changes (stale tile)
  if (diffContent && !diffContent.binary &&
      diffContent.originalContent === diffContent.modifiedContent) {
    return (
      <div className="flex flex-col h-full bg-bg-primary">
        <TileToolbar
          filename={filename}
          directory={directory}
          status={status}
          onClose={handleClose}
        />
        <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
          No changes
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      <TileToolbar
        filename={filename}
        directory={directory}
        status={status}
        onClose={handleClose}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        <CodeMirror
          value={diffContent && !diffContent.binary ? diffContent.modifiedContent : ''}
          extensions={extensions}
          editable={false}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: false,
            highlightSelectionMatches: false,
          }}
          style={{ height: '100%', fontSize: '13px' }}
        />
      </div>
    </div>
  );
}

function TileToolbar({ filename, directory, status, onClose }: {
  filename: string;
  directory: string;
  status: string;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center px-3 py-1 border-b border-border-default shrink-0 gap-2">
      <FileDiff size={14} className="text-text-muted shrink-0" />
      <span className="text-sm text-text-primary truncate">{filename}</span>
      <span className={`text-xs font-mono shrink-0 ${STATUS_COLORS[status] ?? 'text-text-muted'}`}>
        {status === 'added' ? 'A' : status === 'deleted' ? 'D' : 'M'}
      </span>
      {directory && (
        <span className="text-xs text-text-muted truncate">{directory}</span>
      )}
      <div className="ml-auto shrink-0">
        <Tooltip content="Close" side="bottom">
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-text-secondary hover:bg-bg-elevated transition-colors"
            onClick={onClose}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

export default DiffViewerTile;
