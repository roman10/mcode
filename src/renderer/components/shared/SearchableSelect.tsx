import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface SearchableSelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  options: SearchableSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'All',
}: SearchableSelectProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Resolve display label for the trigger button
  const selectedLabel = value
    ? options.find((o) => o.value === value)?.label ?? value
    : placeholder;

  // Filter options by query (prefix first, then includes)
  const filtered = (() => {
    if (!query) return options;
    const q = query.toLowerCase();
    const prefixed = options.filter((o) => o.label.toLowerCase().startsWith(q));
    if (prefixed.length > 0) return prefixed;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  })();

  // Reset selection when query or open state changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Focus the search input after render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Click-outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const items = listRef.current.querySelectorAll('[data-index]');
    items[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const select = (val: string): void => {
    onChange(val);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    // Total items = placeholder + filtered options
    const totalItems = 1 + filtered.length;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (i + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => (i - 1 + totalItems) % totalItems);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex === 0) {
        select('');
      } else {
        const opt = filtered[selectedIndex - 1];
        if (opt) select(opt.value);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        className="flex items-center gap-1 min-w-[120px] text-xs bg-bg-elevated border border-border-default rounded px-1.5 py-0.5 text-text-secondary hover:border-border-focus transition-colors"
        onClick={() => setOpen((prev) => !prev)}
      >
        <span className="truncate flex-1 text-left">{selectedLabel}</span>
        <ChevronDown size={12} className="shrink-0 text-text-muted" />
      </button>

      {open && (
        <div
          ref={listRef}
          className="absolute left-0 top-full mt-1 z-10 min-w-[180px] max-h-[240px] overflow-y-auto rounded-md border border-border-default bg-bg-elevated shadow-lg"
        >
          {/* Search input */}
          <div className="sticky top-0 bg-bg-elevated border-b border-border-default p-1">
            <input
              ref={inputRef}
              type="text"
              className="w-full text-xs bg-bg-primary border border-border-default rounded px-1.5 py-1 text-text-primary placeholder:text-text-muted outline-none focus:border-border-focus"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
            />
          </div>

          {/* Placeholder / "All" option */}
          <button
            type="button"
            data-index={0}
            className={`flex w-full px-2.5 py-1.5 text-left text-xs ${
              selectedIndex === 0
                ? 'bg-accent/15 text-text-primary'
                : 'text-text-secondary hover:bg-bg-secondary'
            }`}
            onPointerDown={(e) => {
              e.preventDefault();
              select('');
            }}
          >
            {placeholder}
          </button>

          {/* Filtered options */}
          {filtered.map((opt, i) => (
            <button
              key={opt.value}
              type="button"
              data-index={i + 1}
              className={`flex w-full px-2.5 py-1.5 text-left text-xs truncate ${
                selectedIndex === i + 1
                  ? 'bg-accent/15 text-text-primary'
                  : 'text-text-primary hover:bg-bg-secondary'
              }`}
              onPointerDown={(e) => {
                e.preventDefault();
                select(opt.value);
              }}
            >
              {opt.label}
            </button>
          ))}

          {filtered.length === 0 && query && (
            <div className="px-2.5 py-2 text-xs text-text-muted">No matches</div>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchableSelect;
