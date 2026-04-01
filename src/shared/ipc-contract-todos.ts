import type { TodoItem, CreateTodoInput, UpdateTodoInput } from './types-todos';

// ---------------------------------------------------------------------------
// Todos IPC channels
// ---------------------------------------------------------------------------

export interface TodosInvokeContract {
  'todos:scan':     { params: [cwd: string]; result: TodoItem[] };
  'todos:create':   { params: [cwd: string, input: CreateTodoInput]; result: TodoItem };
  'todos:update':   { params: [cwd: string, index: number, input: UpdateTodoInput]; result: TodoItem };
  'todos:delete':   { params: [cwd: string, index: number]; result: void };
  'todos:reorder':  { params: [cwd: string, index: number, direction: 'up' | 'down']; result: void };
}
