/**
 * Token found at the cursor position, starting with a trigger character.
 */
export interface TokenAtCursor {
  /** The trigger character, e.g. '@' or '/' */
  trigger: string;
  /** The query text after the trigger (may be empty string) */
  query: string;
  /** Start index of the trigger character in the full text */
  startIndex: number;
  /** End index (exclusive) — equals the cursor position */
  endIndex: number;
}

/**
 * Extract the token at the cursor position that starts with the given trigger.
 *
 * Rules:
 * - The trigger character must be preceded by whitespace, newline, or be at position 0.
 * - The query portion (after trigger) contains no whitespace.
 * - The cursor must be within or immediately after the token (endIndex = cursorPos).
 *
 * Returns null if no matching token is active at the cursor.
 */
export function getTokenAtCursor(
  text: string,
  cursorPos: number,
  trigger: string,
): TokenAtCursor | null {
  if (cursorPos <= 0 || cursorPos > text.length) return null;

  // Walk backwards from cursor through non-whitespace to find token start
  let start = cursorPos;
  while (start > 0 && !/\s/.test(text[start - 1])) {
    start--;
  }

  const token = text.slice(start, cursorPos);
  if (!token.startsWith(trigger)) return null;

  return {
    trigger,
    query: token.slice(trigger.length),
    startIndex: start,
    endIndex: cursorPos,
  };
}

/**
 * Filter items by query using prefix-first strategy, falling back to includes.
 * Case-insensitive. Returns the matching subset in original order.
 */
export function filterByPrefixThenIncludes<T>(
  items: T[],
  query: string,
  getText: (item: T) => string,
): T[] {
  if (!query) return items;
  const q = query.toLowerCase();
  const prefixed = items.filter((item) =>
    getText(item).toLowerCase().startsWith(q),
  );
  if (prefixed.length > 0) return prefixed;
  return items.filter((item) => getText(item).toLowerCase().includes(q));
}
