/** Strip ANSI escape sequences and terminal control characters from a string.
 *  Cursor-right sequences (CSI n C) are replaced with spaces rather than
 *  removed, because the terminal renders them as visible gaps — preserving
 *  them keeps downstream text matching (prompt detection, menu parsing) correct.
 */
export function stripAnsi(str: string): string {
  // First pass: convert cursor-right (CSI <n> C) to the equivalent spaces.
  const withSpaces = str.replace(
    // eslint-disable-next-line no-control-regex
    /\x1b\[(\d*)C/g,
    (_, n: string) => ' '.repeat(parseInt(n || '1', 10)),
  );
  // Second pass: strip all remaining escape sequences and control characters.
  return withSpaces.replace(
    // eslint-disable-next-line no-control-regex -- intentionally matches ANSI escape sequences
    /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[P^_].*?(?:\x1b\\|\x07)|\x1b[^[\]P^_]|\r|\x07|\x0f|\x0e/g,
    '',
  );
}
