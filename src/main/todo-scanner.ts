import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { TodoItem, TodoPriority, CreateTodoInput, UpdateTodoInput } from '../shared/types-todos';
import { typedHandle } from './ipc-helpers';

const TODO_FILENAME = 'TODO.md';
const TODO_DIR = '.mcode';

/**
 * Parse a single markdown checkbox line into a TodoItem.
 *
 * Recognises:
 *   - [ ] text                          → no metadata
 *   - [x] text #high                    → priority only
 *   - [ ] text #medium 2026-04-01       → priority + date
 *
 * Priority tag anchors metadata extraction: a trailing date is only
 * recognised when preceded by a known priority tag. This prevents
 * dates inside the text (e.g. "deploy by 2026-04-01") from being
 * falsely extracted.
 */
const LINE_RE = /^- \[([ xX])\] (.+?)(?:\s+#(high|medium|low)(?:\s+(\d{4}-\d{2}-\d{2}))?)?\s*$/;

export function parseTodoLine(line: string, index: number): TodoItem | null {
  const m = line.match(LINE_RE);
  if (!m) return null;
  return {
    index,
    text: m[2].trim(),
    completed: m[1] !== ' ',
    priority: (m[3] as TodoPriority) ?? null,
    createdDate: m[4] ?? null,
  };
}

export function serializeTodoItem(item: TodoItem): string {
  const checkbox = item.completed ? '[x]' : '[ ]';
  let line = `- ${checkbox} ${item.text}`;
  if (item.priority) {
    line += ` #${item.priority}`;
    if (item.createdDate) {
      line += ` ${item.createdDate}`;
    }
  }
  return line;
}

function todoFilePath(cwd: string): string {
  return join(cwd, TODO_DIR, TODO_FILENAME);
}

export async function readTodos(cwd: string): Promise<TodoItem[]> {
  let content: string;
  try {
    content = await readFile(todoFilePath(cwd), 'utf-8');
  } catch {
    return [];
  }
  const items: TodoItem[] = [];
  let idx = 0;
  for (const line of content.split('\n')) {
    const item = parseTodoLine(line, idx);
    if (item) {
      items.push(item);
      idx++;
    }
  }
  return items;
}

async function writeTodos(cwd: string, items: TodoItem[]): Promise<void> {
  const dir = join(cwd, TODO_DIR);
  await mkdir(dir, { recursive: true });
  const content = items.map(serializeTodoItem).join('\n') + '\n';
  await writeFile(todoFilePath(cwd), content, 'utf-8');
}

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function createTodo(cwd: string, input: CreateTodoInput): Promise<TodoItem> {
  const items = await readTodos(cwd);
  const priority = input.priority ?? 'medium';
  const newItem: TodoItem = {
    index: items.length,
    text: input.text,
    completed: false,
    priority,
    createdDate: todayDate(),
  };
  items.push(newItem);
  await writeTodos(cwd, items);
  return newItem;
}

export async function updateTodo(cwd: string, index: number, input: UpdateTodoInput): Promise<TodoItem> {
  const items = await readTodos(cwd);
  if (index < 0 || index >= items.length) {
    throw new Error(`Todo index ${index} out of range`);
  }
  const item = items[index];
  if (input.text !== undefined) item.text = input.text;
  if (input.completed !== undefined) item.completed = input.completed;
  if (input.priority !== undefined) item.priority = input.priority;
  await writeTodos(cwd, items);
  return { ...item, index };
}

export async function deleteTodo(cwd: string, index: number): Promise<void> {
  const items = await readTodos(cwd);
  if (index < 0 || index >= items.length) {
    throw new Error(`Todo index ${index} out of range`);
  }
  items.splice(index, 1);
  // Re-index
  for (let i = 0; i < items.length; i++) items[i].index = i;
  await writeTodos(cwd, items);
}

export async function reorderTodo(cwd: string, index: number, direction: 'up' | 'down'): Promise<void> {
  const items = await readTodos(cwd);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return; // Silently ignore out-of-bounds reorder
  }
  [items[index], items[target]] = [items[target], items[index]];
  // Re-index
  for (let i = 0; i < items.length; i++) items[i].index = i;
  await writeTodos(cwd, items);
}

export function registerTodoIpc(): void {
  typedHandle('todos:scan', (cwd) => readTodos(cwd));
  typedHandle('todos:create', (cwd, input) => createTodo(cwd, input));
  typedHandle('todos:update', (cwd, index, input) => updateTodo(cwd, index, input));
  typedHandle('todos:delete', (cwd, index) => deleteTodo(cwd, index));
  typedHandle('todos:reorder', (cwd, index, direction) => reorderTodo(cwd, index, direction));
}
