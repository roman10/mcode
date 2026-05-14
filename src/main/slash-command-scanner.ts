import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import type { SlashCommandEntry } from '../shared/types';
import type { AgentSessionType, SlashCommandFileSource } from '../shared/session-agents';
import { getAgentDefinition } from '../shared/session-agents';

async function scanDirectory(
  dir: string,
  source: 'user' | 'project',
  config: SlashCommandFileSource,
  rootDir = dir,
): Promise<SlashCommandEntry[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: SlashCommandEntry[] = [];
  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (config.recursive) {
        results.push(...await scanDirectory(entryPath, source, config, rootDir));
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(config.extension)) continue;

    const relPath = relative(rootDir, entryPath);
    const baseName = basename(entry.name, config.extension);
    const name = config.pathStyle === 'colon'
      ? relPath.slice(0, -config.extension.length).split(sep).join(':')
      : baseName;
    const description = await readCommandDescription(entryPath, name, config);
    results.push({ name, description, source });
  }
  return results;
}

async function readCommandDescription(
  filePath: string,
  fallback: string,
  config: SlashCommandFileSource,
): Promise<string> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const description = config.descriptionFormat === 'toml-description'
      ? extractTomlDescription(content) ?? fallback
      : extractMarkdownDescription(content) ?? fallback;
    return description.length > 80 ? `${description.slice(0, 77)}...` : description;
  } catch {
    return fallback;
  }
}

function extractMarkdownDescription(content: string): string | null {
  const firstLine = content.split('\n').find((line) => line.trim().length > 0);
  if (!firstLine) return null;
  return firstLine.replace(/^#+\s*/, '').trim();
}

function extractTomlDescription(content: string): string | null {
  const match = content.match(/^\s*description\s*=\s*["']([^"']+)["']/m);
  return match?.[1]?.trim() || null;
}

export async function scanSlashCommands(sessionType: AgentSessionType, cwd: string): Promise<SlashCommandEntry[]> {
  const slashCommands = getAgentDefinition(sessionType)?.slashCommands;
  if (!slashCommands) return [];

  const userDir = slashCommands.userCommandFiles
    ? join(homedir(), ...slashCommands.userCommandFiles.dirSegments)
    : '';
  const projectDir = slashCommands.projectCommandFiles && cwd
    ? join(cwd, ...slashCommands.projectCommandFiles.dirSegments)
    : '';

  const [userCommands, projectCommands] = await Promise.all([
    userDir && slashCommands.userCommandFiles
      ? scanDirectory(userDir, 'user', slashCommands.userCommandFiles)
      : Promise.resolve([]),
    projectDir && slashCommands.projectCommandFiles
      ? scanDirectory(projectDir, 'project', slashCommands.projectCommandFiles)
      : Promise.resolve([]),
  ]);

  // Build deduped map: project > user > builtin
  const map = new Map<string, SlashCommandEntry>();

  for (const [name, description] of slashCommands.builtins) {
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
