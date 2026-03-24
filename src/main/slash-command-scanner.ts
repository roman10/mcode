import { readdir, readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { SlashCommandEntry } from '../shared/types';
import { typedHandle } from './ipc-helpers';

const BUILTIN_COMMANDS: ReadonlyMap<string, string> = new Map([
  ['compact', 'Compact conversation history to reduce context'],
  ['clear', 'Clear conversation and start fresh'],
  ['help', 'Show available commands and help'],
  ['init', 'Initialize Claude Code project settings'],
  ['cost', 'Show token usage and cost for this session'],
  ['doctor', 'Check Claude Code installation health'],
  ['login', 'Log in to your Anthropic account'],
  ['logout', 'Log out of your Anthropic account'],
  ['bug', 'Report a bug to Anthropic'],
  ['review', 'Review a pull request'],
  ['memory', 'Edit CLAUDE.md memory files'],
  ['model', 'Switch the AI model'],
  ['config', 'Edit Claude Code configuration'],
  ['vim', 'Toggle vim mode for the input'],
  ['terminal-setup', 'Set up terminal integration'],
  ['permissions', 'Manage tool permissions'],
]);

async function scanDirectory(
  dir: string,
  source: 'user' | 'project',
): Promise<SlashCommandEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const results: SlashCommandEntry[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const name = basename(entry, '.md');
    let description = name;
    try {
      const content = await readFile(join(dir, entry), 'utf-8');
      const firstLine = content.split('\n').find((l) => l.trim().length > 0);
      if (firstLine) {
        description = firstLine.replace(/^#+\s*/, '').trim();
        // Truncate long descriptions
        if (description.length > 80) {
          description = description.slice(0, 77) + '...';
        }
      }
    } catch {
      // Use filename as description if read fails
    }
    results.push({ name, description, source });
  }
  return results;
}

export async function scanSlashCommands(cwd: string): Promise<SlashCommandEntry[]> {
  const userDir = join(homedir(), '.claude', 'commands');
  const projectDir = cwd ? join(cwd, '.claude', 'commands') : '';

  const [userCommands, projectCommands] = await Promise.all([
    scanDirectory(userDir, 'user'),
    projectDir ? scanDirectory(projectDir, 'project') : Promise.resolve([]),
  ]);

  // Build deduped map: project > user > builtin
  const map = new Map<string, SlashCommandEntry>();

  for (const [name, description] of BUILTIN_COMMANDS) {
    map.set(name, { name, description, source: 'builtin' });
  }
  for (const cmd of userCommands) {
    map.set(cmd.name, cmd);
  }
  for (const cmd of projectCommands) {
    map.set(cmd.name, cmd);
  }

  // Sort: project first, then user, then builtin; alphabetically within each group
  const sourceOrder = { project: 0, user: 1, builtin: 2 };
  return Array.from(map.values()).sort(
    (a, b) => sourceOrder[a.source] - sourceOrder[b.source] || a.name.localeCompare(b.name),
  );
}

export function registerSlashCommandIpc(): void {
  typedHandle('slash-commands:scan', (cwd) => {
    return scanSlashCommands(cwd);
  });
}
