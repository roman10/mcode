import { useCallback, useRef, useState } from 'react';
import { SearchAddon } from '@xterm/addon-search';
import type { Terminal } from '@xterm/xterm';

interface SearchResults {
  resultIndex: number;
  resultCount: number;
}

export interface UseTerminalSearchReturn {
  attach(term: Terminal): void;
  isOpen: boolean;
  open(): void;
  close(): void;
  findNext(query: string): void;
  findPrevious(query: string): void;
  resultIndex: number;
  resultCount: number;
}

export function useTerminalSearch(): UseTerminalSearchReturn {
  const addonRef = useRef<SearchAddon | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<SearchResults>({ resultIndex: 0, resultCount: 0 });

  const attach = useCallback((term: Terminal) => {
    const addon = new SearchAddon();
    term.loadAddon(addon);
    addonRef.current = addon;
    addon.onDidChangeResults((e) => {
      setResults({ resultIndex: e.resultIndex, resultCount: e.resultCount });
    });
  }, []);

  const open = useCallback(() => setIsOpen(true), []);

  const close = useCallback(() => {
    addonRef.current?.clearDecorations();
    setIsOpen(false);
    setResults({ resultIndex: 0, resultCount: 0 });
  }, []);

  const findNext = useCallback((query: string) => {
    if (query) {
      addonRef.current?.findNext(query);
    } else {
      addonRef.current?.clearDecorations();
      setResults({ resultIndex: 0, resultCount: 0 });
    }
  }, []);

  const findPrevious = useCallback((query: string) => {
    if (query) {
      addonRef.current?.findPrevious(query);
    } else {
      addonRef.current?.clearDecorations();
      setResults({ resultIndex: 0, resultCount: 0 });
    }
  }, []);

  return {
    attach,
    isOpen,
    open,
    close,
    findNext,
    findPrevious,
    resultIndex: results.resultIndex,
    resultCount: results.resultCount,
  };
}
