/**
 * Shell-escape a file path for safe pasting into a terminal.
 * Paths with only safe characters pass through unchanged;
 * others are wrapped in single quotes with embedded quotes escaped.
 */
export function shellEscapePath(filePath: string): string {
  if (/^[a-zA-Z0-9_./:@-]+$/.test(filePath)) return filePath;
  return "'" + filePath.replace(/'/g, "'\"'\"'") + "'";
}
