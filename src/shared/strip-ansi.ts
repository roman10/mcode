/** Strip ANSI escape sequences and terminal control characters from a string. */
export function stripAnsi(str: string): string {
  return str.replace(
    /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[P^_].*?(?:\x1b\\|\x07)|\x1b[^[\]P^_]|\r|\x07|\x0f|\x0e/g,
    '',
  );
}
