/**
 * Split a session label into an optional leading emoji icon and the text body.
 * The icon (e.g. ✨ from Claude Code) is displayed separately so it survives renames.
 */
export function splitLabelIcon(label: string): [icon: string, text: string] {
  const match = label.match(/^(✨)\s*/);
  if (match) {
    return [match[1], label.slice(match[0].length)];
  }
  return ['', label];
}
