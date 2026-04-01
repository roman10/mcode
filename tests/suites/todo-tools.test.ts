import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { McpTestClient } from '../mcp-client';
import { resetTestState } from '../helpers';
import type { TodoItem } from '../../src/shared/types-todos';

describe('todo tools', () => {
  const client = new McpTestClient();
  let repoA: string;
  let repoB: string;

  beforeAll(async () => {
    [repoA, repoB] = await Promise.all([
      mkdtemp(join(tmpdir(), 'mcode-todo-a-')),
      mkdtemp(join(tmpdir(), 'mcode-todo-b-')),
    ]);
    await client.connect();
    await resetTestState(client);
  });

  afterAll(async () => {
    await Promise.all([
      rm(repoA, { recursive: true, force: true }).catch(() => {}),
      rm(repoB, { recursive: true, force: true }).catch(() => {}),
    ]);
    await client.disconnect();
  });

  // ---------------------------------------------------------------------------
  // todo_list
  // ---------------------------------------------------------------------------

  it('todo_list returns empty array when no TODO.md exists', async () => {
    const items = await client.callToolJson<TodoItem[]>('todo_list', { cwd: repoA });
    expect(items).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // todo_create
  // ---------------------------------------------------------------------------

  it('todo_create creates TODO.md and returns item with defaults', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const item = await client.callToolJson<TodoItem>('todo_create', {
      cwd: repoA,
      text: 'Fix the flaky test',
    });

    expect(item.index).toBe(0);
    expect(item.text).toBe('Fix the flaky test');
    expect(item.completed).toBe(false);
    expect(item.priority).toBe('medium');
    expect(item.createdDate).toBe(today);
  });

  it('todo_create with explicit priority respects it', async () => {
    const item = await client.callToolJson<TodoItem>('todo_create', {
      cwd: repoA,
      text: 'Add rate limiting',
      priority: 'high',
    });

    expect(item.index).toBe(1);
    expect(item.text).toBe('Add rate limiting');
    expect(item.priority).toBe('high');
  });

  it('todo_create appends items in order', async () => {
    await client.callToolJson<TodoItem>('todo_create', {
      cwd: repoA,
      text: 'Update README',
      priority: 'low',
    });

    const items = await client.callToolJson<TodoItem[]>('todo_list', { cwd: repoA });
    expect(items).toHaveLength(3);
    expect(items[0].text).toBe('Fix the flaky test');
    expect(items[1].text).toBe('Add rate limiting');
    expect(items[2].text).toBe('Update README');
    // indexes must be sequential
    expect(items.map((t) => t.index)).toEqual([0, 1, 2]);
  });

  it('TODO.md is written in valid markdown format', async () => {
    const content = await readFile(join(repoA, '.mcode', 'TODO.md'), 'utf8');
    const lines = content.trim().split('\n');

    expect(lines[0]).toMatch(/^- \[ \] Fix the flaky test #medium \d{4}-\d{2}-\d{2}$/);
    expect(lines[1]).toMatch(/^- \[ \] Add rate limiting #high \d{4}-\d{2}-\d{2}$/);
    expect(lines[2]).toMatch(/^- \[ \] Update README #low \d{4}-\d{2}-\d{2}$/);
  });

  // ---------------------------------------------------------------------------
  // todo_update
  // ---------------------------------------------------------------------------

  it('todo_update toggles completion status', async () => {
    const updated = await client.callToolJson<TodoItem>('todo_update', {
      cwd: repoA,
      index: 0,
      completed: true,
    });

    expect(updated.completed).toBe(true);
    expect(updated.text).toBe('Fix the flaky test'); // text unchanged

    // Verify persisted
    const items = await client.callToolJson<TodoItem[]>('todo_list', { cwd: repoA });
    expect(items[0].completed).toBe(true);
  });

  it('todo_update changes text', async () => {
    const updated = await client.callToolJson<TodoItem>('todo_update', {
      cwd: repoA,
      index: 1,
      text: 'Add rate limiting to API endpoints',
    });

    expect(updated.text).toBe('Add rate limiting to API endpoints');
    expect(updated.priority).toBe('high'); // priority unchanged
    expect(updated.completed).toBe(false); // completed unchanged
  });

  it('todo_update changes priority', async () => {
    const updated = await client.callToolJson<TodoItem>('todo_update', {
      cwd: repoA,
      index: 2,
      priority: 'medium',
    });

    expect(updated.priority).toBe('medium');
    expect(updated.text).toBe('Update README'); // text unchanged
  });

  it('todo_update returns error for out-of-bounds index', async () => {
    const result = await client.callTool('todo_update', {
      cwd: repoA,
      index: 99,
      completed: true,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');
  });

  // ---------------------------------------------------------------------------
  // todo_delete
  // ---------------------------------------------------------------------------

  it('todo_delete removes the item and re-indexes remaining items', async () => {
    // State: [0: Fix the flaky test (done), 1: Add rate limiting to API endpoints, 2: Update README]
    // Delete index 1
    await client.callTool('todo_delete', { cwd: repoA, index: 1 });

    const items = await client.callToolJson<TodoItem[]>('todo_list', { cwd: repoA });
    expect(items).toHaveLength(2);
    expect(items[0].text).toBe('Fix the flaky test');
    expect(items[1].text).toBe('Update README');
    // Indexes must be re-numbered from 0
    expect(items[0].index).toBe(0);
    expect(items[1].index).toBe(1);
  });

  it('todo_delete returns error for out-of-bounds index', async () => {
    const result = await client.callTool('todo_delete', { cwd: repoA, index: 99 });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error');
  });

  // ---------------------------------------------------------------------------
  // todo_reorder
  // ---------------------------------------------------------------------------

  it('todo_reorder moves item down', async () => {
    // State: [0: Fix the flaky test, 1: Update README]
    const items = await client.callToolJson<TodoItem[]>('todo_reorder', {
      cwd: repoA,
      index: 0,
      direction: 'down',
    });

    expect(items[0].text).toBe('Update README');
    expect(items[1].text).toBe('Fix the flaky test');
  });

  it('todo_reorder moves item up', async () => {
    // State: [0: Update README, 1: Fix the flaky test]
    const items = await client.callToolJson<TodoItem[]>('todo_reorder', {
      cwd: repoA,
      index: 1,
      direction: 'up',
    });

    expect(items[0].text).toBe('Fix the flaky test');
    expect(items[1].text).toBe('Update README');
  });

  it('todo_reorder at boundary is a no-op', async () => {
    // Moving first item up — should stay put
    const items = await client.callToolJson<TodoItem[]>('todo_reorder', {
      cwd: repoA,
      index: 0,
      direction: 'up',
    });

    expect(items[0].text).toBe('Fix the flaky test');
    expect(items[1].text).toBe('Update README');
  });

  // ---------------------------------------------------------------------------
  // Repo isolation
  // ---------------------------------------------------------------------------

  it('separate cwds maintain independent TODO lists', async () => {
    await client.callToolJson<TodoItem>('todo_create', {
      cwd: repoB,
      text: 'Only in repo B',
    });

    const itemsA = await client.callToolJson<TodoItem[]>('todo_list', { cwd: repoA });
    const itemsB = await client.callToolJson<TodoItem[]>('todo_list', { cwd: repoB });

    expect(itemsA.every((t) => t.text !== 'Only in repo B')).toBe(true);
    expect(itemsB).toHaveLength(1);
    expect(itemsB[0].text).toBe('Only in repo B');
  });
});
