// --- Todos ---

export type TodoPriority = 'high' | 'medium' | 'low';

export interface TodoItem {
  index: number;
  text: string;
  completed: boolean;
  priority: TodoPriority | null;
  createdDate: string | null; // YYYY-MM-DD
}

export interface CreateTodoInput {
  text: string;
  priority?: TodoPriority;
}

export interface UpdateTodoInput {
  text?: string;
  completed?: boolean;
  priority?: TodoPriority | null;
}
