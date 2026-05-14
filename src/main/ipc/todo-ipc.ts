import { readTodos, createTodo, updateTodo, deleteTodo, reorderTodo } from '../todo-scanner';
import { typedHandle } from '../ipc-helpers';

export function registerTodoIpc(): void {
  typedHandle('todos:scan', (cwd) => readTodos(cwd));
  typedHandle('todos:create', (cwd, input) => createTodo(cwd, input));
  typedHandle('todos:update', (cwd, index, input) => updateTodo(cwd, index, input));
  typedHandle('todos:delete', (cwd, index) => deleteTodo(cwd, index));
  typedHandle('todos:reorder', (cwd, index, direction) => reorderTodo(cwd, index, direction));
}
