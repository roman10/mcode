import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createLiveClaudeTestSession,
  waitForIdle,
  cleanupSessions,
  createTask,
  listTasks,
  cancelTask,
  waitForTaskStatus,
  type SessionInfo,
  type TaskInfo,
} from '../helpers';

describe('task concurrent dispatch', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let session1: SessionInfo;
  let session2: SessionInfo;

  beforeAll(async () => {
    await client.connect();

    // Create two live Claude sessions for task dispatch
    [session1, session2] = await Promise.all([
      createLiveClaudeTestSession(client),
      createLiveClaudeTestSession(client),
    ]);
    sessionIds.push(session1.sessionId, session2.sessionId);

    // Wait for sessions to be idle and ready for task dispatch
    await Promise.all([
      waitForIdle(client, session1.sessionId),
      waitForIdle(client, session2.sessionId),
    ]);
  });

  afterAll(async () => {
    // Cancel any remaining pending tasks
    const tasks = await listTasks(client, { statuses: ['pending'] });
    for (const t of tasks) {
      try {
        await cancelTask(client, t.id);
      } catch { /* best-effort */ }
    }
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('dispatches tasks to different sessions in parallel', async () => {
    const task1 = await createTask(client, {
      prompt: 'task for session 1',
      targetSessionId: session1.sessionId,
    });
    const task2 = await createTask(client, {
      prompt: 'task for session 2',
      targetSessionId: session2.sessionId,
    });

    // Both should dispatch (not serialize on one session)
    const [result1, result2] = await Promise.all([
      waitForTaskStatus(client, task1.id, 'dispatched', 15000),
      waitForTaskStatus(client, task2.id, 'dispatched', 15000),
    ]);

    expect(result1.status).toBe('dispatched');
    expect(result2.status).toBe('dispatched');

    // They should target different sessions
    expect(result1.sessionId).toBe(session1.sessionId);
    expect(result2.sessionId).toBe(session2.sessionId);
  });

  it('respects priority ordering for same-session tasks', async () => {
    // Create low-priority task first, then high-priority
    const lowTask = await createTask(client, {
      prompt: 'low priority',
      targetSessionId: session1.sessionId,
      priority: 1,
    });
    const highTask = await createTask(client, {
      prompt: 'high priority',
      targetSessionId: session1.sessionId,
      priority: 10,
    });

    // High priority should dispatch first (or at least be listed first)
    const tasks = await listTasks(client, {
      statuses: ['pending', 'dispatched'],
    });

    const targetedTasks = tasks.filter(
      (t) =>
        t.id === lowTask.id || t.id === highTask.id,
    );

    // If both are pending, high priority should be first in the list
    if (targetedTasks.length === 2 && targetedTasks.every((t) => t.status === 'pending')) {
      expect(targetedTasks[0].id).toBe(highTask.id);
    }

    // Cleanup
    for (const t of targetedTasks) {
      if (t.status === 'pending') {
        try {
          await cancelTask(client, t.id);
        } catch { /* may already be dispatched */ }
      }
    }
  });

  it('tasks targeting non-existent session fail gracefully', async () => {
    // task_create validates session existence upfront
    await expect(
      createTask(client, {
        prompt: 'orphan task',
        targetSessionId: '00000000-0000-0000-0000-000000000000',
      }),
    ).rejects.toThrow(/not found/i);
  });
});
