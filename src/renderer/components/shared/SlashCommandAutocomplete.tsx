import { useEffect, useMemo, useRef, useState } from 'react';
import type { SlashCommandEntry } from '../../../shared/types';

interface SlashCommandAutocompleteProps {
  prompt: string;
  cwd: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onSelect: (commandText: string) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  project: 'Project',
  user: 'Custom',
  builtin: 'Built-in',
};

function SlashCommandAutocomplete({
  prompt,
  cwd,
  textareaRef,
  onSelect,
}: SlashCommandAutocompleteProps): React.JSX.Element | null {
  const [commands, setCommands] = useState<SlashCommandEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Visible only when prompt is "/" followed by non-whitespace chars (no spaces)
  const matchesSlash = /^\/\S*$/.test(prompt);
  const visible = matchesSlash && !dismissed;
  const query = matchesSlash ? prompt.slice(1).toLowerCase() : '';

  // Fetch commands when cwd changes
  useEffect(() => {
    if (!cwd) return;
    let stale = false;
    window.mcode.slashCommands.scan(cwd).then((result) => {
      if (!stale) setCommands(result);
    });
    return () => { stale = true; };
  }, [cwd]);

  // Filter commands
  const filtered = useMemo(() => {
    if (!visible) return [];
    if (!query) return commands;
    // Try prefix match first
    const prefixed = commands.filter((c) =>
      c.name.toLowerCase().startsWith(query),
    );
    if (prefixed.length > 0) return prefixed;
    // Fall back to includes
    return commands.filter((c) => c.name.toLowerCase().includes(query));
  }, [visible, query, commands]);

  // Reset selection and re-show dropdown when query changes
  useEffect(() => {
    setSelectedIndex(0);
    setNavigated(false);
    setDismissed(false);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-index]');
    items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Keyboard handling on the textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !visible || filtered.length === 0) return;

    const handler = (e: KeyboardEvent): void => {
      const idx = Math.min(selectedIndex, filtered.length - 1);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setNavigated(true);
        setSelectedIndex((i) => (i + 1) % filtered.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setNavigated(true);
        setSelectedIndex((i) => (i - 1 + filtered.length) % filtered.length);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        onSelect('/' + filtered[idx].name + ' ');
      } else if (e.key === 'Enter' && navigated) {
        e.preventDefault();
        onSelect('/' + filtered[idx].name + ' ');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
      }
    };

    textarea.addEventListener('keydown', handler);
    return () => textarea.removeEventListener('keydown', handler);
  }, [visible, filtered, selectedIndex, navigated, onSelect, textareaRef]);

  if (!visible || filtered.length === 0) return null;

  // Group items by source for section headers
  let lastSource = '';

  return (
    <div
      ref={listRef}
      className="absolute left-0 right-0 top-full mt-1 z-10 max-h-[240px] overflow-y-auto rounded-md border border-border-default bg-bg-elevated shadow-lg"
    >
      {filtered.map((cmd, i) => {
        const showHeader = cmd.source !== lastSource;
        lastSource = cmd.source;
        return (
          <div key={cmd.name}>
            {showHeader && (
              <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                {SOURCE_LABELS[cmd.source] ?? cmd.source}
              </div>
            )}
            <button
              type="button"
              data-index={i}
              className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm ${
                i === selectedIndex ? 'bg-accent/15 text-text-primary' : 'text-text-primary hover:bg-bg-secondary'
              }`}
              onPointerDown={(e) => {
                e.preventDefault(); // keep focus on textarea
                onSelect('/' + cmd.name + ' ');
              }}
            >
              <span className="shrink-0 font-mono text-accent">/{cmd.name}</span>
              <span className="truncate text-text-secondary text-xs">{cmd.description}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default SlashCommandAutocomplete;
