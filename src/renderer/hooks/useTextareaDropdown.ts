import { useEffect, useRef, useState } from 'react';

export interface UseTextareaDropdownOptions<T> {
  /** Ref to the textarea that the dropdown accompanies */
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Already-filtered items to display */
  items: T[];
  /** Whether the dropdown should be visible (caller determines trigger) */
  visible: boolean;
  /** Query string — resets selection when it changes */
  query: string;
  /** Called when the user selects an item via keyboard */
  onSelect: (item: T) => void;
}

export interface UseTextareaDropdownResult {
  /** Currently highlighted index in the items array */
  selectedIndex: number;
  /** Ref to attach to the dropdown container (for scroll-into-view) */
  listRef: React.RefObject<HTMLDivElement | null>;
  /** Effective visibility: visible && !dismissed && has items */
  isOpen: boolean;
}

/**
 * Shared hook for dropdown keyboard navigation attached to an external textarea.
 *
 * Manages: selectedIndex, navigated, dismissed state, keyboard event handling
 * (ArrowUp/Down, Tab, Enter, Escape), and scroll-into-view.
 *
 * Does NOT handle trigger detection, data fetching, or filtering — those are
 * the caller's responsibility.
 */
export function useTextareaDropdown<T>({
  textareaRef,
  items,
  visible,
  query,
  onSelect,
}: UseTextareaDropdownOptions<T>): UseTextareaDropdownResult {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const isOpen = visible && !dismissed && items.length > 0;

  // Reset selection and re-show dropdown when query changes
  useEffect(() => {
    setSelectedIndex(0);
    setNavigated(false);
    setDismissed(false);
  }, [query]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const itemEls = listRef.current.querySelectorAll('[data-index]');
    itemEls[selectedIndex]?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Keyboard handling on the textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || !isOpen) return;

    const handler = (e: KeyboardEvent): void => {
      const idx = Math.min(selectedIndex, items.length - 1);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setNavigated(true);
        setSelectedIndex((i) => (i + 1) % items.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setNavigated(true);
        setSelectedIndex((i) => (i - 1 + items.length) % items.length);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        onSelect(items[idx]);
      } else if (e.key === 'Enter' && navigated) {
        e.preventDefault();
        onSelect(items[idx]);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setDismissed(true);
      }
    };

    textarea.addEventListener('keydown', handler);
    return () => textarea.removeEventListener('keydown', handler);
  }, [isOpen, items, selectedIndex, navigated, onSelect, textareaRef]);

  return { selectedIndex, listRef, isOpen };
}
