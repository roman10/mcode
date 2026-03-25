import { readdir, readFile, writeFile, unlink, mkdir, access } from 'node:fs/promises';
import { join, basename, normalize } from 'node:path';
import { homedir } from 'node:os';
import { shell } from 'electron';
import { parse as parseYaml } from 'yaml';
import type { SnippetEntry, SnippetVariable } from '../shared/types';
import { typedHandle } from './ipc-helpers';

/** Extract unique {{var}} placeholders from a template body. */
function extractVariablesFromBody(body: string): SnippetVariable[] {
  const seen = new Set<string>();
  const vars: SnippetVariable[] = [];
  for (const match of body.matchAll(/\{\{([^}]+)\}\}/g)) {
    const name = match[1].trim();
    if (!seen.has(name)) {
      seen.add(name);
      vars.push({ name });
    }
  }
  return vars;
}

/** Parse a snippet .md file with optional YAML frontmatter. */
function parseSnippetFile(
  filename: string,
  content: string,
  source: 'user' | 'project',
  filePath: string,
): SnippetEntry | null {
  const fallbackName = basename(filename, '.md');
  let frontmatter: Record<string, unknown> = {};
  let body: string;

  // Detect frontmatter (must start with ---)
  if (content.startsWith('---')) {
    const firstNewline = content.indexOf('\n');
    const endIdx = firstNewline >= 0 ? content.indexOf('\n---', firstNewline) : -1;
    if (endIdx >= 0) {
      const yamlStr = content.slice(firstNewline + 1, endIdx);
      const closingLineEnd = content.indexOf('\n', endIdx + 1);
      body = (closingLineEnd >= 0 ? content.slice(closingLineEnd + 1) : '').trim();
      try {
        const parsed = parseYaml(yamlStr);
        if (parsed && typeof parsed === 'object') {
          frontmatter = parsed as Record<string, unknown>;
        }
      } catch {
        // Malformed YAML — treat entire content as body
        body = content.trim();
      }
    } else {
      // No closing --- found
      body = content.trim();
    }
  } else {
    body = content.trim();
  }

  if (!body && !frontmatter['name']) return null;

  const name = typeof frontmatter['name'] === 'string'
    ? frontmatter['name']
    : fallbackName;

  let description = '';
  if (typeof frontmatter['description'] === 'string') {
    description = frontmatter['description'];
  } else {
    // Use first non-empty line of body
    const firstLine = body.split('\n').find((l) => l.trim().length > 0);
    if (firstLine) {
      description = firstLine.replace(/^#+\s*/, '').trim();
      if (description.length > 80) {
        description = description.slice(0, 77) + '...';
      }
    }
  }

  // Variables: frontmatter takes precedence, otherwise auto-extract from body
  let variables: SnippetVariable[];
  if (Array.isArray(frontmatter['variables'])) {
    variables = (frontmatter['variables'] as Record<string, unknown>[])
      .filter((v) => v && typeof v === 'object' && typeof v['name'] === 'string')
      .map((v) => ({
        name: v['name'] as string,
        description: typeof v['description'] === 'string' ? v['description'] : undefined,
        default: typeof v['default'] === 'string' ? v['default'] : undefined,
      }));
  } else {
    variables = extractVariablesFromBody(body);
  }

  return { name, description, source, variables, body, filePath };
}

async function scanDirectory(
  dir: string,
  source: 'user' | 'project',
): Promise<SnippetEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const results: SnippetEntry[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    try {
      const fullPath = join(dir, entry);
      const content = await readFile(fullPath, 'utf-8');
      const snippet = parseSnippetFile(entry, content, source, fullPath);
      if (snippet) results.push(snippet);
    } catch {
      // Skip unreadable files
    }
  }
  return results;
}

export async function scanSnippets(cwd: string): Promise<SnippetEntry[]> {
  const userDir = join(homedir(), '.mcode', 'snippets');
  const projectDir = cwd ? join(cwd, '.mcode', 'snippets') : '';

  const [userSnippets, projectSnippets] = await Promise.all([
    scanDirectory(userDir, 'user'),
    projectDir ? scanDirectory(projectDir, 'project') : Promise.resolve([]),
  ]);

  // Deduplicate: project overrides user
  const map = new Map<string, SnippetEntry>();
  for (const s of userSnippets) map.set(s.name, s);
  for (const s of projectSnippets) map.set(s.name, s);

  // Sort: project first, then user; alphabetically within each group
  const sourceOrder = { project: 0, user: 1 };
  return Array.from(map.values()).sort(
    (a, b) => sourceOrder[a.source] - sourceOrder[b.source] || a.name.localeCompare(b.name),
  );
}

function snippetsDir(scope: 'user' | 'project', cwd: string): string {
  return scope === 'user'
    ? join(homedir(), '.mcode', 'snippets')
    : join(cwd, '.mcode', 'snippets');
}

const SNIPPET_TEMPLATE = `---
name: New Snippet          # Display name in the snippet picker
description:               # Short summary shown next to the name
# variables:               # Optional — define input fields for dynamic parts
#   - name: varname        # Must match a {{varname}} placeholder in the body
#     description: Label   # Label shown on the input field
#     default: value       # Pre-filled value (user can override)
---
Your snippet text here. Use {{varname}} for dynamic parts.
`;

export async function createSnippet(scope: 'user' | 'project', cwd: string): Promise<string> {
  const dir = snippetsDir(scope, cwd);
  await mkdir(dir, { recursive: true });

  // Find a unique filename
  let filename = 'new-snippet.md';
  let counter = 2;
  while (true) {
    try {
      await access(join(dir, filename));
      filename = `new-snippet-${counter}.md`;
      counter++;
    } catch {
      break; // File doesn't exist — use this name
    }
  }

  const fullPath = join(dir, filename);
  await writeFile(fullPath, SNIPPET_TEMPLATE, 'utf-8');
  return fullPath;
}

export async function deleteSnippet(filePath: string): Promise<void> {
  // Validate the path is inside a snippets directory and is a .md file
  const normalized = normalize(filePath);
  if (!normalized.endsWith('.md')) {
    throw new Error('Can only delete .md snippet files');
  }
  const userDir = normalize(join(homedir(), '.mcode', 'snippets'));
  const isInSnippetsDir = normalized.startsWith(userDir + '/') ||
    normalized.includes('/.mcode/snippets/');
  if (!isInSnippetsDir) {
    throw new Error('Cannot delete file outside of a snippets directory');
  }
  await unlink(normalized);
}

export async function openSnippetsFolder(scope: 'user' | 'project', cwd: string): Promise<void> {
  const dir = snippetsDir(scope, cwd);
  await mkdir(dir, { recursive: true });
  await shell.openPath(dir);
}

export function registerSnippetIpc(): void {
  typedHandle('snippets:scan', (cwd) => {
    return scanSnippets(cwd);
  });
  typedHandle('snippets:create', (scope, cwd) => {
    return createSnippet(scope, cwd);
  });
  typedHandle('snippets:delete', (filePath) => {
    return deleteSnippet(filePath);
  });
  typedHandle('snippets:open-folder', (scope, cwd) => {
    return openSnippetsFolder(scope, cwd);
  });
}
