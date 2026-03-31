const ANSI_CSI_PATTERN = new RegExp(String.raw`\u001b\[[0-?]*[ -/]*[@-~]`, 'g');
const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001b.`, 'g');

export function parseSlashCommandName(input: string): string | null {
  const trimmed = input.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const token = trimmed.split(/\s+/, 1)[0];
  const name = token.slice(1).trim().toLowerCase();
  return name.length > 0 ? name : null;
}

export function stripTerminalInputControlSequences(input: string): string {
  return input
    .replace(ANSI_CSI_PATTERN, '')
    .replace(ANSI_ESCAPE_PATTERN, '');
}

export function buildUnsupportedSlashCommandWarning(
  input: string,
  knownCommands: Iterable<string>,
  agentDisplayName: string,
): string | null {
  const commandName = parseSlashCommandName(input);
  if (!commandName) return null;

  const known = new Set(Array.from(knownCommands, (name) => name.toLowerCase()));
  if (known.has(commandName)) return null;

  return `/${commandName} is not in mcode's known ${agentDisplayName} slash commands. It may still work if your CLI, extensions, or plugins add it.`;
}
