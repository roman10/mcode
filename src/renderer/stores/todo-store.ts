import { create } from 'zustand';
import type { TodoItem, CreateTodoInput, UpdateTodoInput } from '@shared/types';

interface TodoState {
  todosByRepo: Record<string, TodoItem[]>;
  loadingByRepo: Record<string, boolean>;

  refreshRepo(cwd: string): Promise<void>;
  refreshAllRepos(cwds: string[]): Promise<void>;
  addTodo(cwd: string, input: CreateTodoInput): Promise<TodoItem>;
  updateTodo(cwd: string, index: number, input: UpdateTodoInput): Promise<TodoItem>;
  removeTodo(cwd: string, index: number): Promise<void>;
  reorderTodo(cwd: string, index: number, direction: 'up' | 'down'): Promise<void>;
}

export const useTodoStore = create<TodoState>((set, get) => ({
  todosByRepo: {},
  loadingByRepo: {},

  refreshRepo: async (cwd) => {
    set((s) => ({ loadingByRepo: { ...s.loadingByRepo, [cwd]: true } }));
    try {
      const todos = await window.mcode.todos.scan(cwd);
      set((s) => ({
        todosByRepo: { ...s.todosByRepo, [cwd]: todos },
        loadingByRepo: { ...s.loadingByRepo, [cwd]: false },
      }));
    } catch {
      set((s) => ({
        todosByRepo: { ...s.todosByRepo, [cwd]: [] },
        loadingByRepo: { ...s.loadingByRepo, [cwd]: false },
      }));
    }
  },

  refreshAllRepos: async (cwds) => {
    await Promise.all(cwds.map((cwd) => get().refreshRepo(cwd)));
  },

  addTodo: async (cwd, input) => {
    const item = await window.mcode.todos.create(cwd, input);
    await get().refreshRepo(cwd);
    return item;
  },

  updateTodo: async (cwd, index, input) => {
    const item = await window.mcode.todos.update(cwd, index, input);
    await get().refreshRepo(cwd);
    return item;
  },

  removeTodo: async (cwd, index) => {
    await window.mcode.todos.delete(cwd, index);
    await get().refreshRepo(cwd);
  },

  reorderTodo: async (cwd, index, direction) => {
    await window.mcode.todos.reorder(cwd, index, direction);
    await get().refreshRepo(cwd);
  },
}));
