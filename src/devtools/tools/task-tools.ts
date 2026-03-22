import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';

const TASK_STATUSES = ['pending', 'dispatched', 'completed', 'failed'] as const;

export function registerTaskTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('task_create', {
    description: 'Create a new task in the task queue. Returns the created task.',
    inputSchema: {
      prompt: z.string().describe('The prompt to dispatch to a Claude session'),
      cwd: z.string().describe('Working directory for the task'),
      targetSessionId: z.string().optional().describe('Target an existing session (null = spawn new session)'),
      priority: z.number().int().optional().describe('Priority (higher = more urgent, default: 0)'),
      scheduledAt: z.string().optional().describe('ISO 8601 time to schedule dispatch (null = ASAP)'),
      maxRetries: z.number().int().optional().describe('Max retries on failure (default: 3)'),
      planModeAction: z.object({
        exitPlanMode: z.boolean().describe('UI hint: true = proceed with plan, false = revise plan'),
      }).optional().describe(
        'If set, this is a plan mode response task. When the target session enters plan mode, ' +
        'the task queue navigates to the "Type here" option and types the prompt as feedback. ' +
        'Requires targetSessionId. The prompt should express intent, e.g. "proceed with implementation" or "add error handling first".',
      ),
    },
    annotations: { readOnlyHint: false },
  }, async ({ prompt, cwd, targetSessionId, priority, scheduledAt, maxRetries, planModeAction }) => {
    try {
      const task = ctx.taskQueue.create({
        prompt,
        cwd,
        targetSessionId,
        priority,
        scheduledAt,
        maxRetries,
        planModeAction,
      });
      return {
        content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Failed to create task: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  });

  server.registerTool('task_list', {
    description: 'List tasks in the queue with optional filters',
    inputSchema: {
      statuses: z.array(z.enum(TASK_STATUSES)).optional().describe('Filter by task statuses'),
      targetSessionId: z.string().optional().describe('Filter by target session ID'),
      limit: z.number().int().positive().optional().describe('Max number of tasks to return'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ statuses, targetSessionId, limit }) => {
    const tasks = ctx.taskQueue.list({ statuses, targetSessionId, limit });
    return {
      content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }],
    };
  });

  server.registerTool('task_cancel', {
    description: 'Cancel a pending task. Only pending tasks can be cancelled.',
    inputSchema: {
      taskId: z.number().int().describe('The task ID to cancel'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ taskId }) => {
    try {
      ctx.taskQueue.cancel(taskId);
      return {
        content: [{ type: 'text', text: `Task ${taskId} cancelled` }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Failed to cancel task: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  });

  server.registerTool('task_update', {
    description: 'Update a pending task. Only pending tasks can be edited.',
    inputSchema: {
      taskId: z.number().int().describe('The task ID to update'),
      prompt: z.string().optional().describe('New prompt text'),
      priority: z.number().int().optional().describe('New priority value'),
      scheduledAt: z.string().nullable().optional().describe('New scheduled time (ISO 8601, or null to clear)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ taskId, prompt, priority, scheduledAt }) => {
    try {
      const task = ctx.taskQueue.update(taskId, { prompt, priority, scheduledAt });
      return {
        content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{
          type: 'text',
          text: `Failed to update task: ${err instanceof Error ? err.message : String(err)}`,
        }],
        isError: true,
      };
    }
  });

  server.registerTool('task_wait_for_status', {
    description: 'Wait until a task reaches the specified status. Polls every 250ms.',
    inputSchema: {
      taskId: z.number().int().describe('The task ID'),
      status: z.enum(TASK_STATUSES).describe('Target status to wait for'),
      timeout_ms: z.number().int().positive().optional().describe('Timeout in milliseconds (default: 30000)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ taskId, status, timeout_ms }) => {
    const timeout = timeout_ms ?? 30000;
    const pollInterval = 250;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const task = ctx.taskQueue.getById(taskId);
      if (!task) {
        return {
          content: [{ type: 'text', text: `Task ${taskId} not found` }],
          isError: true,
        };
      }
      if (task.status === status) {
        return {
          content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
        };
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    const task = ctx.taskQueue.getById(taskId);
    if (task?.status === status) {
      return {
        content: [{ type: 'text', text: JSON.stringify(task, null, 2) }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: `Timeout after ${timeout}ms waiting for task status "${status}". Current status: ${task?.status ?? 'not found'}`,
      }],
      isError: true,
    };
  });

  server.registerTool('sidebar_get_tasks', {
    description: 'Get tasks as they appear in the sidebar task queue panel',
    annotations: { readOnlyHint: true },
  }, async () => {
    const tasks = ctx.taskQueue.list();
    return {
      content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }],
    };
  });
}
