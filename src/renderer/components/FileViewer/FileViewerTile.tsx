import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { X, FileText } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { EditorView } from '@codemirror/view';
import { LanguageDescription } from '@codemirror/language';
import { languages } from '@codemirror/language-data';
import type { Extension } from '@codemirror/state';
import { vim, Vim } from '@replit/codemirror-vim';
import { useLayoutStore } from '../../stores/layout-store';
import { useEditorStore } from '../../stores/editor-store';
import Tooltip from '../shared/Tooltip';
import { mcodeEditorExtension, hideCursorExtension, vimPanelTheme } from '../../styles/editor-theme';
import type { FileReadResult } from '@shared/types';

// --- Global ex command routing via WeakMap ---

interface TileHandlers {
  save(): Promise<void>;
  close(): void;
}

const viewHandlers = new WeakMap<EditorView, TileHandlers>();

let exCommandsRegistered = false;
function ensureExCommands(): void {
  if (exCommandsRegistered) return;
  exCommandsRegistered = true;

  Vim.defineEx('write', 'w', (cm: { cm6: EditorView }) => {
    const handlers = viewHandlers.get(cm.cm6);
    if (handlers) handlers.save();
  });

  Vim.defineEx('quit', 'q', (cm: { cm6: EditorView }) => {
    const handlers = viewHandlers.get(cm.cm6);
    if (handlers) handlers.close();
  });

  Vim.defineEx('wquit', 'wq', (cm: { cm6: EditorView }) => {
    const handlers = viewHandlers.get(cm.cm6);
    if (handlers) handlers.save().then(() => handlers.close());
  });
}

// ---

interface FileViewerTileProps {
  absolutePath: string;
}

function FileViewerTile({ absolutePath }: FileViewerTileProps): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [langExtension, setLangExtension] = useState<Extension | null>(null);
  const vimEnabled = useEditorStore((s) => s.vimEnabled);
  const editorViewRef = useRef<EditorView | null>(null);

  // Refs to avoid per-keystroke handler churn in WeakMap
  const contentRef = useRef(content);
  const editedContentRef = useRef(editedContent);
  contentRef.current = content;
  editedContentRef.current = editedContent;

  const filename = useMemo(() => {
    const lastSlash = absolutePath.lastIndexOf('/');
    return lastSlash >= 0 ? absolutePath.slice(lastSlash + 1) : absolutePath;
  }, [absolutePath]);

  const directory = useMemo(() => {
    const lastSlash = absolutePath.lastIndexOf('/');
    return lastSlash >= 0 ? absolutePath.slice(0, lastSlash) : '';
  }, [absolutePath]);

  const isDirty = content !== null && editedContent !== null && editedContent !== content;

  // Load file content
  useEffect(() => {
    setLoading(true);
    setError(null);
    setSaveError(null);
    setContent(null);
    setEditedContent(null);

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
          setEditedContent(result.content);
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

  // Stable handlers that read from refs — avoids re-creating on every keystroke
  const handleClose = useCallback((): void => {
    const c = contentRef.current;
    const ec = editedContentRef.current;
    if (c !== null && ec !== null && ec !== c) {
      if (!window.confirm(`"${filename}" has unsaved changes. Close anyway?`)) {
        return;
      }
    }
    useLayoutStore.getState().removeFileTile(absolutePath);
    useLayoutStore.getState().persist();
  }, [absolutePath, filename]);

  const handleSave = useCallback(async (): Promise<void> => {
    const ec = editedContentRef.current;
    if (ec === null) return;
    const cwd = directory || '/';
    try {
      await window.mcode.files.write(cwd, filename, ec);
      setContent(ec);
      setSaveError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setSaveError(msg);
    }
  }, [directory, filename]);

  // Register view handlers once when the editor is created
  const handleCreateEditor = useCallback((view: EditorView): void => {
    editorViewRef.current = view;
    if (vimEnabled) {
      ensureExCommands();
      viewHandlers.set(view, { save: handleSave, close: handleClose });
    }

    // Scroll to pending line target from search results
    const targetLine = useLayoutStore.getState().consumePendingFileLine(absolutePath);
    if (targetLine) {
      requestAnimationFrame(() => {
        try {
          const lineInfo = view.state.doc.line(Math.min(targetLine, view.state.doc.lines));
          view.dispatch({
            selection: { anchor: lineInfo.from },
            effects: EditorView.scrollIntoView(lineInfo.from, { y: 'center' }),
          });
        } catch {
          // Line out of range — ignore
        }
      });
    }
  }, [vimEnabled, handleSave, handleClose, absolutePath]);

  // Scroll to line when a search result is clicked for an already-open file
  const pendingFileLine = useLayoutStore((s) => s.pendingFileLine);
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !pendingFileLine || pendingFileLine.path !== absolutePath) return;
    const targetLine = useLayoutStore.getState().consumePendingFileLine(absolutePath);
    if (!targetLine) return;
    try {
      const lineInfo = view.state.doc.line(Math.min(targetLine, view.state.doc.lines));
      view.dispatch({
        selection: { anchor: lineInfo.from },
        effects: EditorView.scrollIntoView(lineInfo.from, { y: 'center' }),
      });
    } catch {
      // Line out of range — ignore
    }
  }, [pendingFileLine, absolutePath]);

  // Sync WeakMap when vimEnabled changes (handlers are stable so this rarely fires)
  useEffect(() => {
    const view = editorViewRef.current;
    if (view && vimEnabled) {
      ensureExCommands();
      viewHandlers.set(view, { save: handleSave, close: handleClose });
    }
    return () => {
      if (view) viewHandlers.delete(view);
    };
  }, [vimEnabled, handleSave, handleClose]);

  const handleChange = useCallback((value: string): void => {
    setEditedContent(value);
  }, []);

  const extensions = useMemo(() => {
    const exts: Extension[] = [];
    if (vimEnabled) {
      exts.push(vim({ status: true }));
      exts.push(vimPanelTheme);
    }
    exts.push(EditorView.lineWrapping);
    exts.push(...mcodeEditorExtension);
    if (!vimEnabled) {
      exts.push(hideCursorExtension);
    }
    if (langExtension) exts.push(langExtension);
    return exts;
  }, [langExtension, vimEnabled]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center h-8 px-3 bg-bg-secondary border-b border-border-default shrink-0 [-webkit-app-region:no-drag]">
        <FileText size={14} className="text-text-muted shrink-0 mr-2" />
        <span className="text-xs text-text-primary font-medium truncate">
          {filename}
        </span>
        {isDirty && (
          <span className="w-2 h-2 rounded-full bg-accent shrink-0 ml-1.5" title="Unsaved changes" />
        )}
        {saveError && (
          <span className="text-xs text-red-400 ml-2 truncate" title={saveError}>
            Save failed
          </span>
        )}
        <span className="text-xs text-text-muted ml-2 truncate flex-1" title={absolutePath}>
          {directory}
        </span>
        <div className="flex items-center gap-1 ml-2">
          <Tooltip content="Close file (⌘W)" side="bottom">
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
            theme="none"
            extensions={extensions}
            readOnly={!vimEnabled}
            editable={vimEnabled}
            onChange={vimEnabled ? handleChange : undefined}
            onCreateEditor={handleCreateEditor}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: vimEnabled,
              highlightActiveLine: vimEnabled,
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
