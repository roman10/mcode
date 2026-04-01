/** Extract command string from hook tool input, handling different CLI field names. */
export function extractCommandString(toolInput: Record<string, unknown> | null): string {
  if (!toolInput) return '';
  if (typeof toolInput.command === 'string') return toolInput.command;
  if (typeof toolInput.input === 'string') return toolInput.input;
  return '';
}
