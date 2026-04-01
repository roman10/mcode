import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  parseTodoLine,
  serializeTodoItem,
  readTodos,
  createTodo,
  updateTodo,
  deleteTodo,
  reorderTodo,
} from '../../../src/main/todo-scanner';
import type { TodoItem } from '../../../src/shared/types-todos';

describe('parseTodoLine', () => {
  it('parses unchecked item with priority and date', () => {
    const item = parseTodoLine('- [ ] Fix the flaky test #high 2026-04-01', 0);
    expect(item).toEqual({
      index: 0,
      text: 'Fix the flaky test',
      completed: false,
      priority: 'high',
      createdDate: '2026-04-01',
    });
  });

  it('parses checked item', () => {
    const item = parseTodoLine('- [x] Update README #low 2026-03-30', 2);
    expect(item).toEqual({
      index: 2,
      text: 'Update README',
      completed: true,
      priority: 'low',
      createdDate: '2026-03-30',
    });
  });

  it('parses item with priority only (no date)', () => {
    const item = parseTodoLine('- [ ] Add tests #medium', 0);
    expect(item).toEqual({
      index: 0,
      text: 'Add tests',
      completed: false,
      priority: 'medium',
      createdDate: null,
    });
  });

  it('parses bare item (no metadata)', () => {
    const item = parseTodoLine('- [ ] Simple task', 0);
    expect(item).toEqual({
      index: 0,
      text: 'Simple task',
      completed: false,
      priority: null,
      createdDate: null,
    });
  });

  it('does not extract date without priority anchor', () => {
    const item = parseTodoLine('- [ ] Deploy by 2026-04-01', 0);
    expect(item).toEqual({
      index: 0,
      text: 'Deploy by 2026-04-01',
      completed: false,
      priority: null,
      createdDate: null,
    });
  });

  it('does not match partial priority tags like #highlight', () => {
    const item = parseTodoLine('- [ ] Fix #highlight issue', 0);
    expect(item).toEqual({
      index: 0,
      text: 'Fix #highlight issue',
      completed: false,
      priority: null,
      createdDate: null,
    });
  });

  it('returns null for non-todo lines', () => {
    expect(parseTodoLine('# Heading', 0)).toBeNull();
    expect(parseTodoLine('Some text', 0)).toBeNull();
    expect(parseTodoLine('', 0)).toBeNull();
    expect(parseTodoLine('- Not a checkbox', 0)).toBeNull();
  });

  it('parses uppercase X as completed', () => {
    const item = parseTodoLine('- [X] Done task', 0);
    expect(item?.completed).toBe(true);
  });
});

describe('serializeTodoItem', () => {
  it('serializes unchecked item with priority and date', () => {
    const item: TodoItem = {
      index: 0,
      text: 'Fix bug',
      completed: false,
      priority: 'high',
      createdDate: '2026-04-01',
    };
    expect(serializeTodoItem(item)).toBe('- [ ] Fix bug #high 2026-04-01');
  });

  it('serializes checked item', () => {
    const item: TodoItem = {
      index: 0,
      text: 'Done',
      completed: true,
      priority: 'low',
      createdDate: '2026-03-30',
    };
    expect(serializeTodoItem(item)).toBe('- [x] Done #low 2026-03-30');
  });

  it('serializes item with priority only', () => {
    const item: TodoItem = {
      index: 0,
      text: 'Do it',
      completed: false,
      priority: 'medium',
      createdDate: null,
    };
    expect(serializeTodoItem(item)).toBe('- [ ] Do it #medium');
  });

  it('serializes bare item', () => {
    const item: TodoItem = {
      index: 0,
      text: 'Simple',
      completed: false,
      priority: null,
      createdDate: null,
    };
    expect(serializeTodoItem(item)).toBe('- [ ] Simple');
  });
});

describe('round-trip parsing', () => {
  it('parse then serialize is identity for all variants', () => {
    const lines = [
      '- [ ] Fix bug #high 2026-04-01',
      '- [x] Done #low 2026-03-30',
      '- [ ] No date #medium',
      '- [ ] Bare task',
    ];
    for (const line of lines) {
      const parsed = parseTodoLine(line, 0);
      expect(parsed).not.toBeNull();
      expect(serializeTodoItem(parsed!)).toBe(line);
    }
  });
});

describe('CRUD operations', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'mcode-todo-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('readTodos returns empty array when file does not exist', async () => {
    const items = await readTodos(tempDir);
    expect(items).toEqual([]);
  });

  it('createTodo creates .mcode/TODO.md and returns the item', async () => {
    const item = await createTodo(tempDir, { text: 'First todo' });
    expect(item.text).toBe('First todo');
    expect(item.completed).toBe(false);
    expect(item.priority).toBe('medium');
    expect(item.createdDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const content = await readFile(join(tempDir, '.mcode', 'TODO.md'), 'utf-8');
    expect(content).toContain('- [ ] First todo #medium');
  });

  it('createTodo respects custom priority', async () => {
    const item = await createTodo(tempDir, { text: 'Urgent', priority: 'high' });
    expect(item.priority).toBe('high');

    const content = await readFile(join(tempDir, '.mcode', 'TODO.md'), 'utf-8');
    expect(content).toContain('#high');
  });

  it('updateTodo toggles completion', async () => {
    await createTodo(tempDir, { text: 'Toggle me' });
    const updated = await updateTodo(tempDir, 0, { completed: true });
    expect(updated.completed).toBe(true);

    const items = await readTodos(tempDir);
    expect(items[0].completed).toBe(true);
  });

  it('updateTodo changes text', async () => {
    await createTodo(tempDir, { text: 'Original' });
    const updated = await updateTodo(tempDir, 0, { text: 'Modified' });
    expect(updated.text).toBe('Modified');
  });

  it('updateTodo throws for out-of-range index', async () => {
    await createTodo(tempDir, { text: 'Only one' });
    await expect(updateTodo(tempDir, 5, { text: 'Nope' })).rejects.toThrow('out of range');
  });

  it('deleteTodo removes an item and re-indexes', async () => {
    await createTodo(tempDir, { text: 'First' });
    await createTodo(tempDir, { text: 'Second' });
    await createTodo(tempDir, { text: 'Third' });

    await deleteTodo(tempDir, 1);

    const items = await readTodos(tempDir);
    expect(items).toHaveLength(2);
    expect(items[0].text).toBe('First');
    expect(items[0].index).toBe(0);
    expect(items[1].text).toBe('Third');
    expect(items[1].index).toBe(1);
  });

  it('reorderTodo swaps items', async () => {
    await createTodo(tempDir, { text: 'A' });
    await createTodo(tempDir, { text: 'B' });
    await createTodo(tempDir, { text: 'C' });

    await reorderTodo(tempDir, 0, 'down');

    const items = await readTodos(tempDir);
    expect(items[0].text).toBe('B');
    expect(items[1].text).toBe('A');
    expect(items[2].text).toBe('C');
  });

  it('reorderTodo silently ignores out-of-bounds', async () => {
    await createTodo(tempDir, { text: 'Only' });
    await reorderTodo(tempDir, 0, 'up'); // can't go up from 0
    const items = await readTodos(tempDir);
    expect(items[0].text).toBe('Only');
  });

  it('multiple creates append sequentially', async () => {
    await createTodo(tempDir, { text: 'One' });
    await createTodo(tempDir, { text: 'Two' });
    await createTodo(tempDir, { text: 'Three' });

    const items = await readTodos(tempDir);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.text)).toEqual(['One', 'Two', 'Three']);
  });
});
