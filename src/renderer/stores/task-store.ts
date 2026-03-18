import { create } from 'zustand';
import type { Task, CreateTaskInput, TaskFilter } from '../../shared/types';

interface TaskState {
  tasks: Record<number, Task>;

  setTasks(tasks: Task[]): void;
  upsertTask(task: Task): void;
  removeTask(taskId: number): void;
  addTask(input: CreateTaskInput): Promise<number>;
  cancelTask(taskId: number): Promise<void>;
  refreshTasks(filter?: TaskFilter): Promise<void>;
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: {},

  setTasks: (tasks) =>
    set({
      tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    }),

  upsertTask: (task) =>
    set((state) => ({
      tasks: { ...state.tasks, [task.id]: task },
    })),

  removeTask: (taskId) =>
    set((state) => {
      const { [taskId]: _, ...rest } = state.tasks;
      return { tasks: rest };
    }),

  addTask: async (input) => {
    const taskId = await window.mcode.tasks.create(input);
    return taskId;
  },

  cancelTask: async (taskId) => {
    await window.mcode.tasks.cancel(taskId);
  },

  refreshTasks: async (filter) => {
    const tasks = await window.mcode.tasks.list(filter);
    set({
      tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
    });
  },
}));
