import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpTestClient } from '../mcp-client';
import type { SnippetEntry } from '../../src/shared/types';

describe('snippet tools', () => {
  const client = new McpTestClient();
  const tmpDir = join(tmpdir(), `mcode-snippet-test-${Date.now()}`);
  const snippetsDir = join(tmpDir, '.mcode', 'snippets');

  beforeAll(async () => {
    await client.connect();

    // Create temp snippet files
    await mkdir(snippetsDir, { recursive: true });

    // Snippet with full frontmatter + variables
    await writeFile(
      join(snippetsDir, 'review-pr.md'),
      `---
name: Review PR
description: Review a pull request with focus areas
variables:
  - name: branch
    description: Branch to review
    default: main
  - name: focus
    description: Focus area
---
Review the changes in {{branch}} branch. Focus on {{focus}}.
`,
    );

    // Snippet with no variables
    await writeFile(
      join(snippetsDir, 'quick-fix.md'),
      `---
name: Quick Fix
description: Fix the current issue
---
Look at the error and fix it. Run tests after.
`,
    );

    // Snippet with no frontmatter — auto-extract variables from body
    await writeFile(
      join(snippetsDir, 'deploy.md'),
      `Deploy {{service}} to {{environment}} and verify health checks.
`,
    );
  });

  afterAll(async () => {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch { /* best-effort */ }
    await client.disconnect();
  });

  it('snippet_list returns parsed entries for project snippets', async () => {
    const entries = await client.callToolJson<SnippetEntry[]>('snippet_list', {
      cwd: tmpDir,
    });

    expect(Array.isArray(entries)).toBe(true);
    // Should find at least the 3 project-level snippets we created
    const projectEntries = entries.filter((e) => e.source === 'project');
    expect(projectEntries.length).toBe(3);
  });

  it('parses frontmatter with variables correctly', async () => {
    const entries = await client.callToolJson<SnippetEntry[]>('snippet_list', {
      cwd: tmpDir,
    });

    const reviewPr = entries.find((e) => e.name === 'Review PR');
    expect(reviewPr).toBeDefined();
    expect(reviewPr!.description).toBe('Review a pull request with focus areas');
    expect(reviewPr!.variables).toHaveLength(2);
    expect(reviewPr!.variables[0].name).toBe('branch');
    expect(reviewPr!.variables[0].default).toBe('main');
    expect(reviewPr!.variables[1].name).toBe('focus');
    expect(reviewPr!.body).toContain('{{branch}}');
  });

  it('parses snippet with no variables', async () => {
    const entries = await client.callToolJson<SnippetEntry[]>('snippet_list', {
      cwd: tmpDir,
    });

    const quickFix = entries.find((e) => e.name === 'Quick Fix');
    expect(quickFix).toBeDefined();
    expect(quickFix!.variables).toHaveLength(0);
    expect(quickFix!.body).toContain('Look at the error');
  });

  it('auto-extracts variables from body when no frontmatter variables', async () => {
    const entries = await client.callToolJson<SnippetEntry[]>('snippet_list', {
      cwd: tmpDir,
    });

    const deploy = entries.find((e) => e.name === 'deploy');
    expect(deploy).toBeDefined();
    expect(deploy!.variables).toHaveLength(2);
    const varNames = deploy!.variables.map((v) => v.name);
    expect(varNames).toContain('service');
    expect(varNames).toContain('environment');
  });

  it('returns empty array for directory with no snippets', async () => {
    const emptyDir = join(tmpdir(), `mcode-empty-${Date.now()}`);
    await mkdir(emptyDir, { recursive: true });

    const entries = await client.callToolJson<SnippetEntry[]>('snippet_list', {
      cwd: emptyDir,
    });

    // May include user-level snippets from ~/.mcode/snippets/ if they exist,
    // but should not error
    expect(Array.isArray(entries)).toBe(true);

    await rm(emptyDir, { recursive: true, force: true }).catch(() => {});
  });
});
