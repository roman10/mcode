import { useCallback, useEffect, useRef, useState } from 'react';

interface SearchBarProps {
  onFindNext: (query: string) => void;
  onFindPrevious: (query: string) => void;
  onClose: () => void;
  resultIndex: number;
  resultCount: number;
}

function SearchBar({
  onFindNext,
  onFindPrevious,
  onClose,
  resultIndex,
  resultCount,
}: SearchBarProps): React.JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setQuery(value);
      onFindNext(value);
    },
    [onFindNext],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.stopPropagation();

      if (e.key === 'Escape') {
        onClose();
        return;
      }

      if (e.key === 'Enter') {
        if (e.shiftKey) {
          onFindPrevious(query);
        } else {
          onFindNext(query);
        }
        e.preventDefault();
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 'g') {
        if (e.shiftKey) {
          onFindPrevious(query);
        } else {
          onFindNext(query);
        }
        e.preventDefault();
      }
    },
    [query, onFindNext, onFindPrevious, onClose],
  );

  return (
    <div
      className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-md border border-border-default bg-bg-elevated px-2 py-1 shadow-lg"
      onKeyDown={handleKeyDown}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={handleChange}
        placeholder="Find…"
        className="w-48 bg-transparent text-[13px] text-text-primary placeholder:text-text-muted outline-none"
      />
      {query && (
        <span className="text-[11px] text-text-secondary tabular-nums whitespace-nowrap">
          {resultCount > 0 ? `${resultIndex + 1} of ${resultCount}` : 'No results'}
        </span>
      )}
      <button
        type="button"
        onClick={() => onFindPrevious(query)}
        className="flex items-center justify-center w-5 h-5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors"
        title="Previous (Shift+Enter)"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 7.5L6 4L9.5 7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onFindNext(query)}
        className="flex items-center justify-center w-5 h-5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors"
        title="Next (Enter)"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onClose}
        className="flex items-center justify-center w-5 h-5 rounded text-text-secondary hover:text-text-primary hover:bg-bg-secondary transition-colors"
        title="Close (Esc)"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

export default SearchBar;
