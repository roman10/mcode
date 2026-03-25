/**
 * Captures the currently focused element and returns a function that
 * restores focus to it. Standard modal focus-restoration pattern.
 */
export function createFocusRestorer(): () => void {
  const prev = document.activeElement;
  return () => {
    if (prev && typeof (prev as HTMLElement).focus === 'function') {
      (prev as HTMLElement).focus();
    }
  };
}
