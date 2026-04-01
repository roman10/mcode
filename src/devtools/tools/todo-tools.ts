import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readTodos, createTodo, updateTodo, deleteTodo, reorderTodo } from '../../main/todo-scanner';

const PRIORITIES = ['high', 'medium', 'low'] as const;

export function registerTodoTools(server: McpServer): void {
  server.registerTool('todo_list', {
    description: 'List all TODO items for a repository. Reads from {cwd}/.mcode/TODO.md.',
    inputSchema: {
      cwd: z.string().describe('Repository working directory'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ cwd }) => {
    const items = await readTodos(cwd);
    return {
      content: [{ type: 'text', text: JSON.stringify(items, null, 2) }],
    };
  });

  server.registerTool('todo_create', {
    description: 'Create a new TODO item. Appends to {cwd}/.mcode/TODO.md.',
    inputSchema: {
      cwd: z.string().describe('Repository working directory'),
      text: z.string().describe('TODO text'),
      priority: z.enum(PRIORITIES).optional().describe('Priority level (default: medium)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ cwd, text, priority }) => {
    const item = await createTodo(cwd, { text, priority });
    return {
      content: [{ type: 'text', text: JSON.stringify(item, null, 2) }],
    };
  });

  server.registerTool('todo_update', {
    description: 'Update a TODO item by index. Can change text, completion status, or priority.',
    inputSchema: {
      cwd: z.string().describe('Repository working directory'),
      index: z.number().int().min(0).describe('0-based index of the TODO item'),
      text: z.string().optional().describe('New text'),
      completed: z.boolean().optional().describe('New completion status'),
      priority: z.enum([...PRIORITIES]).nullable().optional().describe('New priority (null to clear)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ cwd, index, text, completed, priority }) => {
    try {
      const item = await updateTodo(cwd, index, { text, completed, priority });
      return {
        content: [{ type: 'text', text: JSON.stringify(item, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  server.registerTool('todo_delete', {
    description: 'Delete a TODO item by index.',
    inputSchema: {
      cwd: z.string().describe('Repository working directory'),
      index: z.number().int().min(0).describe('0-based index of the TODO item to delete'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ cwd, index }) => {
    try {
      await deleteTodo(cwd, index);
      return {
        content: [{ type: 'text', text: 'Deleted successfully' }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }],
        isError: true,
      };
    }
  });

  server.registerTool('todo_reorder', {
    description: 'Move a TODO item up or down by one position.',
    inputSchema: {
      cwd: z.string().describe('Repository working directory'),
      index: z.number().int().min(0).describe('0-based index of the TODO item to move'),
      direction: z.enum(['up', 'down']).describe('Direction to move'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ cwd, index, direction }) => {
    await reorderTodo(cwd, index, direction);
    const items = await readTodos(cwd);
    return {
      content: [{ type: 'text', text: JSON.stringify(items, null, 2) }],
    };
  });
}
