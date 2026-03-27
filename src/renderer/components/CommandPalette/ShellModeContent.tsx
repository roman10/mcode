import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { basename } from '../../utils/path-utils';
import { runShellCommand, resolveActiveCwd } from '../../utils/session-actions';

const SHELL_HISTORY_KEY = 'shell-history';
const MAX_HISTORY_ITEMS = 20;

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
  // Remove duplicate if exists, then prepend
  const filtered = history.filter((h) => h !== command);
  filtered.unshift(command);
  const trimmed = filtered.slice(0, MAX_HISTORY_ITEMS);
  await window.mcode.preferences.set(SHELL_HISTORY_KEY, JSON.stringify(trimmed));
}

interface ShellModeContentProps {
  query: string;
  onClose: () => void;
  onSetInput: (value: string) => void;
}

function ShellModeContent({ query, onClose, onSetInput }: ShellModeContentProps): React.JSX.Element {
  const cwd = useMemo(() => resolveActiveCwd(), []);
  const cwdBasename = useMemo(() => basename(cwd), [cwd]);
  const [history, setHistory] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // Load history on mount
  useEffect(() => {
    loadShellHistory().then(setHistory).catch(() => {});
  }, []);

  const handleRun = useCallback((cmd?: string) => {
    const toRun = cmd ?? query.trim();
    if (!toRun) return;
    saveToShellHistory(toRun).catch(console.error);
    runShellCommand(toRun, cwd).catch(console.error);
    onClose();
  }, [query, cwd, onClose]);

  // Listen for Enter to run, Up/Down to navigate history
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleRun();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.min(selectedIndexRef.current + 1, history.length - 1);
        setSelectedIndex(next);
        if (next >= 0 && history[next]) {
          onSetInput(`! ${history[next]}`);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        const next = selectedIndexRef.current - 1;
        if (next < 0) {
          setSelectedIndex(-1);
          onSetInput('! ');
        } else {
          setSelectedIndex(next);
          if (history[next]) {
            onSetInput(`! ${history[next]}`);
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRun, history, onSetInput]);

  // Filter history by query for display
  const filteredHistory = useMemo(() => {
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      return history.filter((h) => h.toLowerCase().includes(q));
    }
    return history;
  }, [history, query]);

  return (
    <div className="text-sm">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className="text-text-muted text-xs">
          Run in <span className="text-text-secondary font-mono">{cwdBasename}</span>
        </span>
        {query ? (
          <span className="text-text-muted text-xs">
            <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default text-xs font-mono">Enter</kbd> to run
            {' · '}
            <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default text-xs font-mono">↑↓</kbd> history
          </span>
        ) : (
          <span className="text-text-muted text-xs">
            <kbd className="px-1 py-0.5 bg-bg-primary rounded border border-border-default text-xs font-mono">↑↓</kbd> history
          </span>
        )}
      </div>
      {/* History list */}
      {filteredHistory.length > 0 && !query.trim() && (
        <div className="border-t border-border-subtle mt-1">
          <div className="px-4 py-1.5 text-xs text-text-muted uppercase tracking-wide font-medium">
            Recent
          </div>
          {filteredHistory.map((cmd, i) => (
            <button
              key={cmd}
              type="button"
              className={`
                w-full text-left px-4 py-1.5 text-xs font-mono cursor-pointer
                ${i === selectedIndex ? 'bg-accent/20 text-accent' : 'text-text-secondary hover:bg-bg-secondary'}
              `}
              onClick={() => handleRun(cmd)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              {cmd}
            </button>
          ))}
        </div>
      )}
      {/* Filtered history when typing */}
      {filteredHistory.length > 0 && query.trim() && (
        <div className="border-t border-border-subtle mt-1">
          {filteredHistory.map((cmd) => (
            <button
              key={cmd}
              type="button"
              className="w-full text-left px-4 py-1.5 text-xs font-mono text-text-secondary hover:bg-bg-secondary cursor-pointer"
              onClick={() => handleRun(cmd)}
            >
              {cmd}
            </button>
          ))}
        </div>
      )}
      {!query.trim() && filteredHistory.length === 0 && (
        <div className="px-4 pb-3 pt-1 text-text-muted text-xs">
          Type a shell command...
        </div>
      )}
    </div>
  );
}

export default ShellModeContent;
