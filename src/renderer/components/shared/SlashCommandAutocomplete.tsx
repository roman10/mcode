import { useEffect, useMemo, useState } from 'react';
import type { SlashCommandEntry } from '@shared/types';
import { useTextareaDropdown } from '../../hooks/useTextareaDropdown';
import { filterByPrefixThenIncludes } from '../../utils/autocomplete-utils';

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

  // Visible only when prompt is "/" followed by non-whitespace chars (no spaces)
  const matchesSlash = /^\/\S*$/.test(prompt);
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
    if (!matchesSlash) return [];
    return filterByPrefixThenIncludes(commands, query, (c) => c.name);
  }, [matchesSlash, query, commands]);

  const { selectedIndex, listRef, isOpen } = useTextareaDropdown({
    textareaRef,
    items: filtered,
    visible: matchesSlash,
    query,
    onSelect: (cmd) => onSelect('/' + cmd.name + ' '),
  });

  if (!isOpen) return null;

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
