import { useEffect, useState, useMemo, useCallback, useRef, useLayoutEffect, forwardRef } from 'react';
import { basename } from '../../utils/path-utils';
import { runShellCommand, resolveActiveCwd } from '../../utils/session-actions';

const SHELL_HISTORY_KEY = 'shell-history';
const MAX_HISTORY_ITEMS = 20;
const MAX_TEXTAREA_ROWS = 6;

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
  const filtered = history.filter((h) => h !== command);
  filtered.unshift(command);
  const trimmed = filtered.slice(0, MAX_HISTORY_ITEMS);
  await window.mcode.preferences.set(SHELL_HISTORY_KEY, JSON.stringify(trimmed));
}

interface ShellModeContentProps {
  input: string;
  setInput: (value: string) => void;
  onClose: () => void;
}

function mergeHistory(palette: string[], shellFile: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cmd of palette) {
    if (!seen.has(cmd)) { seen.add(cmd); out.push(cmd); }
  }
  for (const cmd of shellFile) {
    if (!seen.has(cmd)) { seen.add(cmd); out.push(cmd); }
  }
  return out;
}

interface HistoryRowProps {
  cmd: string;
  selected: boolean;
  onSelect: () => void;
  onRun: () => void;
}

const HistoryRow = forwardRef<HTMLButtonElement, HistoryRowProps>(
  function HistoryRow({ cmd, selected, onSelect, onRun }, ref) {
    const [first, ...rest] = cmd.split('\n');
    const extraLines = rest.length;
    return (
      <button
        ref={ref}
        type="button"
        title={cmd}
        className={`
          flex w-full items-center text-left px-4 py-1.5 text-xs font-mono cursor-pointer
          ${selected ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-secondary'}
        `}
        onClick={onRun}
        onMouseEnter={onSelect}
      >
        <span className="truncate flex-1 min-w-0">{first}</span>
        {extraLines > 0 && (
          <span className="ml-2 shrink-0 text-text-muted text-[10px]">↵ {extraLines + 1} lines</span>
        )}
      </button>
    );
  },
);

function ShellModeContent({ input, setInput, onClose }: ShellModeContentProps): React.JSX.Element {
  const cwd = useMemo(() => resolveActiveCwd(), []);
  const cwdBasename = useMemo(() => basename(cwd), [cwd]);
  const [paletteHistory, setPaletteHistory] = useState<string[]>([]);
  const [shellFileHistory, setShellFileHistory] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const query = input.startsWith('!') ? input.slice(1).trimStart() : input.trimStart();

  const history = useMemo(
    () => mergeHistory(paletteHistory, shellFileHistory),
    [paletteHistory, shellFileHistory],
  );

  useEffect(() => {
    loadShellHistory().then(setPaletteHistory).catch(() => {});
    window.mcode.shellHistory
      .recent(500)
      .then((entries) => setShellFileHistory(entries.map((e) => e.command)))
      .catch(() => {});
  }, []);

  // Autofocus textarea — Electron + xterm.js can reclaim focus, so defer to next tick.
  useEffect(() => {
    const id = setTimeout(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      const end = ta.value.length;
      ta.setSelectionRange(end, end);
    }, 0);
    return () => clearTimeout(id);
  }, []);

  // Reposition caret after a history-nav write so the cursor lands at end.
  useLayoutEffect(() => {
    const ta = textareaRef.current;
    if (!ta || pendingCaretRef.current === null) return;
    const pos = pendingCaretRef.current;
    pendingCaretRef.current = null;
    ta.setSelectionRange(pos, pos);
    // Scroll to bottom of textarea so end is visible for tall multi-line entries.
    ta.scrollTop = ta.scrollHeight;
  }, [input]);

  // Scroll the highlighted row into view when navigating with arrow keys.
  useEffect(() => {
    if (selectedIndex < 0) return;
    rowRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleRun = useCallback((cmd?: string) => {
    const raw = cmd ?? query;
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (!normalized.trim()) return;
    saveToShellHistory(normalized).catch(console.error);
    runShellCommand(normalized, cwd).catch(console.error);
    onClose();
  }, [query, cwd, onClose]);

  const filteredHistory = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return history;
    return history.filter((h) => h.toLowerCase().includes(q));
  }, [history, query]);

  const loadIntoInput = useCallback((cmd: string) => {
    const next = `! ${cmd}`;
    setInput(next);
    pendingCaretRef.current = next.length;
  }, [setInput]);

  const navigateUp = useCallback(() => {
    if (filteredHistory.length === 0) return;
    const next = Math.min(selectedIndex + 1, filteredHistory.length - 1);
    setSelectedIndex(next);
    const entry = filteredHistory[next];
    if (entry !== undefined) loadIntoInput(entry);
  }, [filteredHistory, selectedIndex, loadIntoInput]);

  const navigateDown = useCallback(() => {
    // Nothing armed — Down is a no-op (don't wipe whatever the user typed).
    if (selectedIndex < 0) return;
    if (selectedIndex === 0) {
      // Past newest — exit recall, clear back to the empty shell prompt.
      setSelectedIndex(-1);
      setInput('! ');
      pendingCaretRef.current = 2;
      return;
    }
    const next = selectedIndex - 1;
    setSelectedIndex(next);
    const entry = filteredHistory[next];
    if (entry !== undefined) loadIntoInput(entry);
  }, [filteredHistory, selectedIndex, loadIntoInput, setInput]);

  // When the user types or edits, clear the armed selection so highlights don't lie.
  // We detect "user editing" as any input change that isn't a programmatic history-nav write.
  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    if (selectedIndex !== -1) setSelectedIndex(-1);
  }, [setInput, selectedIndex]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;

    const ta = e.currentTarget;
    const selStart = ta.selectionStart ?? 0;
    const selEnd = ta.selectionEnd ?? 0;
    const value = ta.value;

    if (e.key === 'Enter') {
      // Shift / Alt: insert newline (default).
      if (e.shiftKey || e.altKey) return;
      // Cmd/Ctrl+Enter: also submit.
      e.preventDefault();
      e.stopPropagation();
      handleRun();
      return;
    }

    if (e.key === 'ArrowUp') {
      const beforeCaret = value.slice(0, selStart);
      const onFirstLine = !beforeCaret.includes('\n');
      if (!onFirstLine) return;
      e.preventDefault();
      e.stopPropagation();
      navigateUp();
      return;
    }

    if (e.key === 'ArrowDown') {
      const afterCaret = value.slice(selEnd);
      const onLastLine = !afterCaret.includes('\n');
      if (!onLastLine) return;
      e.preventDefault();
      e.stopPropagation();
      navigateDown();
      return;
    }
  }, [handleRun, navigateUp, navigateDown]);

  const lineCount = useMemo(() => Math.max(1, input.split('\n').length), [input]);
  const rows = Math.min(lineCount, MAX_TEXTAREA_ROWS);

  return (
    <div className="text-sm">
      <textarea
        ref={textareaRef}
        data-testid="shell-mode-textarea"
        value={input}
        onChange={handleTextareaChange}
        onKeyDown={handleKeyDown}
        rows={rows}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="! Type or paste a shell command (Shift+Enter for newline)…"
        className="w-full px-4 py-3 bg-transparent text-text-primary text-sm font-mono
                   outline-none resize-none whitespace-pre-wrap placeholder:text-text-muted
                   leading-snug overflow-y-auto"
      />
      <div className="flex items-center justify-between px-4 pt-2 pb-1 border-t border-border-subtle">
        <span className="text-text-muted text-xs">
          Run in <span className="text-text-secondary font-mono">{cwdBasename}</span>
        </span>
        <span className="text-text-muted text-xs">
          <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default text-xs font-mono">Enter</kbd> run
          {' · '}
          <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default text-xs font-mono">Shift+Enter</kbd> newline
          {' · '}
          <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default text-xs font-mono">↑↓</kbd> history
        </span>
      </div>
      {filteredHistory.length > 0 && (
        <div className="border-t border-border-subtle max-h-[40vh] overflow-y-auto">
          {!query.trim() && (
            <div className="px-4 py-1.5 text-xs text-text-muted uppercase tracking-wide font-medium">
              Recent
            </div>
          )}
          {filteredHistory.map((cmd, i) => (
            <HistoryRow
              key={cmd}
              ref={(el) => { rowRefs.current[i] = el; }}
              cmd={cmd}
              selected={i === selectedIndex}
              onSelect={() => setSelectedIndex(i)}
              onRun={() => handleRun(cmd)}
            />
          ))}
        </div>
      )}
      {filteredHistory.length === 0 && (
        <div className="px-4 pb-3 pt-1 text-text-muted text-xs">
          {query.trim() ? 'No matching history.' : 'Type a shell command…'}
        </div>
      )}
    </div>
  );
}

export default ShellModeContent;
