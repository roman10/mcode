import { create } from 'zustand';
import type { TodoItem, CreateTodoInput, UpdateTodoInput } from '@shared/types';

interface TodoState {
  todos: TodoItem[];
  loading: boolean;

  refreshTodos(cwd: string): Promise<void>;
  addTodo(cwd: string, input: CreateTodoInput): Promise<TodoItem>;
  updateTodo(cwd: string, index: number, input: UpdateTodoInput): Promise<TodoItem>;
  removeTodo(cwd: string, index: number): Promise<void>;
  reorderTodo(cwd: string, index: number, direction: 'up' | 'down'): Promise<void>;
}

export const useTodoStore = create<TodoState>((set) => ({
  todos: [],
  loading: false,

  refreshTodos: async (cwd) => {
    set({ loading: true });
    try {
      const todos = await window.mcode.todos.scan(cwd);
      set({ todos, loading: false });
    } catch {
      set({ todos: [], loading: false });
    }
  },

  addTodo: async (cwd, input) => {
    const item = await window.mcode.todos.create(cwd, input);
    const todos = await window.mcode.todos.scan(cwd);
    set({ todos });
    return item;
  },

  updateTodo: async (cwd, index, input) => {
    const item = await window.mcode.todos.update(cwd, index, input);
    const todos = await window.mcode.todos.scan(cwd);
    set({ todos });
    return item;
  },

  removeTodo: async (cwd, index) => {
    await window.mcode.todos.delete(cwd, index);
    const todos = await window.mcode.todos.scan(cwd);
    set({ todos });
  },

  reorderTodo: async (cwd, index, direction) => {
    await window.mcode.todos.reorder(cwd, index, direction);
    const todos = await window.mcode.todos.scan(cwd);
    set({ todos });
  },
}));
