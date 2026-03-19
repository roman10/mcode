import { useEffect, useState, useMemo } from 'react';
import { X, FileText } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Extension } from '@codemirror/state';
import { useLayoutStore } from '../../stores/layout-store';
import Tooltip from '../shared/Tooltip';
import type { FileReadResult } from '../../../shared/types';

interface FileViewerTileProps {
  absolutePath: string;
}

// Dark theme matching mcode's UI
const darkTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    height: '100%',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--color-bg-secondary)',
    borderRight: '1px solid var(--color-border-default)',
    color: 'var(--color-text-muted)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--color-bg-elevated)',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgba(139, 148, 158, 0.2)',
  },
  '.cm-cursor': {
    display: 'none',
  },
});

function FileViewerTile({ absolutePath }: FileViewerTileProps): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [langExtension, setLangExtension] = useState<Extension | null>(null);

  const filename = useMemo(() => {
    const lastSlash = absolutePath.lastIndexOf('/');
    return lastSlash >= 0 ? absolutePath.slice(lastSlash + 1) : absolutePath;
  }, [absolutePath]);

  const directory = useMemo(() => {
    const lastSlash = absolutePath.lastIndexOf('/');
    return lastSlash >= 0 ? absolutePath.slice(0, lastSlash) : '';
  }, [absolutePath]);

  // Load file content
  useEffect(() => {
    setLoading(true);
    setError(null);
    setContent(null);

    // Infer cwd — use the directory of the file itself for the read call
    // The file-lister validates the path stays within cwd
    const cwd = directory || '/';
    const relativePath = filename;

    window.mcode.files
      .read(cwd, relativePath)
      .then((result: FileReadResult) => {
        if ('isBinary' in result) {
          setError('Binary file — cannot display.');
        } else if ('isTooLarge' in result) {
          setError('File too large to display (>1 MB).');
        } else {
          setContent(result.content);
        }
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to read file.');
        setLoading(false);
      });
  }, [absolutePath, directory, filename]);

  // Load language extension dynamically
  useEffect(() => {
    const desc = LanguageDescription.matchFilename(languages, filename);
    if (desc) {
      desc.load().then((lang) => {
        setLangExtension(lang);
      }).catch(() => {
        // Language loading failed — render without highlighting
      });
    }
  }, [filename]);

  const handleClose = (): void => {
    useLayoutStore.getState().removeFileTile(absolutePath);
    useLayoutStore.getState().persist();
  };

  const extensions = useMemo(() => {
    const exts: Extension[] = [
      EditorView.lineWrapping,
      darkTheme,
    ];
    if (langExtension) exts.push(langExtension);
    return exts;
  }, [langExtension]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center h-8 px-3 bg-bg-secondary border-b border-border-default shrink-0 [-webkit-app-region:no-drag]">
        <FileText size={14} className="text-text-muted shrink-0 mr-2" />
        <span className="text-xs text-text-primary font-medium truncate">
          {filename}
        </span>
        <span className="text-xs text-text-muted ml-2 truncate flex-1" title={absolutePath}>
          {directory}
        </span>
        <div className="flex items-center gap-1 ml-2">
          <Tooltip content="Close file" side="bottom">
            <button
              aria-label="Close file"
              className="text-text-muted hover:text-text-primary text-xs px-1 transition-colors"
              onClick={handleClose}
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden bg-bg-primary">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm text-text-muted">Loading...</span>
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full">
            <span className="text-sm text-text-muted">{error}</span>
          </div>
        )}
        {content !== null && (
          <CodeMirror
            value={content}
            extensions={extensions}
            readOnly
            editable={false}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: false,
              highlightActiveLine: false,
              foldGutter: true,
              bracketMatching: true,
              closeBrackets: false,
              autocompletion: false,
              highlightSelectionMatches: true,
            }}
            className="h-full text-[13px] [&_.cm-editor]:h-full"
          />
        )}
      </div>
    </div>
  );
}

export default FileViewerTile;
