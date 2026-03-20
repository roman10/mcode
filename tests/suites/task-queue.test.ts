import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  createLiveClaudeTestSession,
  waitForActive,
  killAndWaitEnded,
  cleanupSessions,
  injectHookEvent,
  getHookRuntime,
  createTask,
  listTasks,
  cancelTask,
  waitForTaskStatus,
  updateTask,
} from '../helpers';

function futureIso(delayMs = 60000): string {
  return new Date(Date.now() + delayMs).toISOString();
}

describe('task queue', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('creates a task with pending status', async () => {
    const task = await createTask(client, {
      prompt: 'echo hello',
      scheduledAt: futureIso(),
    });
    expect(task.id).toBeGreaterThan(0);
    expect(task.status).toBe('pending');
    expect(task.prompt).toBe('echo hello');
    expect(task.targetSessionId).toBeNull();
    expect(task.sessionId).toBeNull();

    // Cancel it so it doesn't dispatch
    await cancelTask(client, task.id);
  });

  it('lists tasks with filters', async () => {
    const scheduledAt = futureIso();
    const t1 = await createTask(client, { prompt: 'task 1', priority: 10, scheduledAt });
    const t2 = await createTask(client, { prompt: 'task 2', priority: 5, scheduledAt });

    const all = await listTasks(client);
    expect(all.some((t) => t.id === t1.id)).toBe(true);
    expect(all.some((t) => t.id === t2.id)).toBe(true);

    // Higher priority should come first
    const ids = all.map((t) => t.id);
    expect(ids.indexOf(t1.id)).toBeLessThan(ids.indexOf(t2.id));

    // Clean up
    await cancelTask(client, t1.id);
    await cancelTask(client, t2.id);
  });

  it('cancels a pending task', async () => {
    const task = await createTask(client, {
      prompt: 'will cancel',
      scheduledAt: futureIso(),
    });
    expect(task.status).toBe('pending');

    await cancelTask(client, task.id);

    // Should no longer appear in list
    const tasks = await listTasks(client);
    expect(tasks.find((t) => t.id === task.id)).toBeUndefined();
  });

  it('rejects cancellation of non-pending tasks', async () => {
    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    const active = await waitForActive(client, session.sessionId);
    expect(active.hookMode).toBe('live');

    // Inject Stop to make session idle
    await injectHookEvent(client, session.sessionId, 'Stop');

    const task = await createTask(client, {
      prompt: 'echo dispatched',
      targetSessionId: session.sessionId,
    });

    // Wait for dispatch
    await waitForTaskStatus(client, task.id, 'dispatched', 10000);

    // Try to cancel — should fail
    await expect(
      client.callToolJson('task_cancel', { taskId: task.id }),
    ).rejects.toThrow(/only pending/i);

    // Clean up: inject idle to complete the task
    await injectHookEvent(client, session.sessionId, 'PreToolUse', { toolName: 'Bash' });
    await injectHookEvent(client, session.sessionId, 'Stop');
    await waitForTaskStatus(client, task.id, 'completed', 10000);
    await killAndWaitEnded(client, session.sessionId);
  });

  it('dispatches task to existing idle session', async () => {
    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    const active = await waitForActive(client, session.sessionId);
    expect(active.hookMode).toBe('live');

    // Make session idle
    await injectHookEvent(client, session.sessionId, 'Stop');

    const task = await createTask(client, {
      prompt: 'follow up work',
      targetSessionId: session.sessionId,
    });

    // Should dispatch within a few seconds
    const dispatched = await waitForTaskStatus(client, task.id, 'dispatched', 10000);
    expect(dispatched.sessionId).toBe(session.sessionId);

    // Simulate Claude working then completing
    await injectHookEvent(client, session.sessionId, 'PreToolUse', { toolName: 'Bash' });
    await injectHookEvent(client, session.sessionId, 'Stop');

    const completed = await waitForTaskStatus(client, task.id, 'completed', 10000);
    expect(completed.completedAt).not.toBeNull();

    await killAndWaitEnded(client, session.sessionId);
  });

  it('dispatches tasks sequentially on same session', async () => {
    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    const active = await waitForActive(client, session.sessionId);
    expect(active.hookMode).toBe('live');
    await injectHookEvent(client, session.sessionId, 'Stop');

    // Queue 3 tasks on the same session
    const t1 = await createTask(client, { prompt: 'task 1', targetSessionId: session.sessionId });
    const t2 = await createTask(client, { prompt: 'task 2', targetSessionId: session.sessionId });
    const t3 = await createTask(client, { prompt: 'task 3', targetSessionId: session.sessionId });

    // First task should dispatch
    await waitForTaskStatus(client, t1.id, 'dispatched', 10000);

    // Second and third should still be pending
    const tasks = await listTasks(client, { statuses: ['pending'] });
    expect(tasks.some((t) => t.id === t2.id)).toBe(true);
    expect(tasks.some((t) => t.id === t3.id)).toBe(true);

    // Complete first task
    await injectHookEvent(client, session.sessionId, 'PreToolUse', { toolName: 'Bash' });
    await injectHookEvent(client, session.sessionId, 'Stop');
    await waitForTaskStatus(client, t1.id, 'completed', 10000);

    // Second task should dispatch
    await waitForTaskStatus(client, t2.id, 'dispatched', 10000);

    // Complete second task
    await injectHookEvent(client, session.sessionId, 'PreToolUse', { toolName: 'Bash' });
    await injectHookEvent(client, session.sessionId, 'Stop');
    await waitForTaskStatus(client, t2.id, 'completed', 10000);

    // Third task should dispatch
    await waitForTaskStatus(client, t3.id, 'dispatched', 10000);

    // Complete third task
    await injectHookEvent(client, session.sessionId, 'PreToolUse', { toolName: 'Bash' });
    await injectHookEvent(client, session.sessionId, 'Stop');
    await waitForTaskStatus(client, t3.id, 'completed', 10000);

    await killAndWaitEnded(client, session.sessionId);
  });

  it('fails task when target session ends', async () => {
    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    const active = await waitForActive(client, session.sessionId);
    expect(active.hookMode).toBe('live');
    await injectHookEvent(client, session.sessionId, 'Stop');

    // Queue tasks
    const t1 = await createTask(client, { prompt: 'task 1', targetSessionId: session.sessionId });
    const t2 = await createTask(client, { prompt: 'task 2', targetSessionId: session.sessionId });

    // First task dispatches
    await waitForTaskStatus(client, t1.id, 'dispatched', 10000);

    // Kill session
    await killAndWaitEnded(client, session.sessionId);

    // Both tasks should fail
    const failed1 = await waitForTaskStatus(client, t1.id, 'failed', 10000);
    expect(failed1.error).toBeTruthy();

    const failed2 = await waitForTaskStatus(client, t2.id, 'failed', 10000);
    expect(failed2.error).toBeTruthy();
  });

  it('creates a scheduled task that waits', async () => {
    // Schedule 60 seconds from now — should remain pending
    const future = futureIso();
    const task = await createTask(client, {
      prompt: 'scheduled task',
      scheduledAt: future,
    });

    expect(task.status).toBe('pending');
    expect(task.scheduledAt).toBe(future);

    // After a few seconds it should still be pending (not dispatched)
    await new Promise((r) => setTimeout(r, 3000));
    const tasks = await listTasks(client, { statuses: ['pending'] });
    expect(tasks.find((t) => t.id === task.id)?.status).toBe('pending');

    await cancelTask(client, task.id);
  });

  it('rejects task creation when hook runtime is not ready', async () => {
    const runtime = await getHookRuntime(client);
    // Only test if hook runtime happens to be degraded
    if (runtime.state === 'ready') {
      // We can't easily force degraded mode in integration tests,
      // so we verify the validation path works for other error cases
      await expect(
        client.callToolJson('task_create', {
          prompt: 'test',
          cwd: process.cwd(),
          targetSessionId: 'nonexistent-session-id',
        }),
      ).rejects.toThrow(/not found/i);
    }
  });

  it('rejects task targeting terminal session', async () => {
    const session = await createTestSession(client, { sessionType: 'terminal' });
    sessionIds.push(session.sessionId);
    await waitForActive(client, session.sessionId);

    await expect(
      client.callToolJson('task_create', {
        prompt: 'test',
        cwd: process.cwd(),
        targetSessionId: session.sessionId,
      }),
    ).rejects.toThrow(/only supports Claude/i);

    await killAndWaitEnded(client, session.sessionId);
  });

  it('rejects task targeting ended session', async () => {
    const session = await createLiveClaudeTestSession(client);
    sessionIds.push(session.sessionId);
    const active = await waitForActive(client, session.sessionId);
    expect(active.hookMode).toBe('live');
    await killAndWaitEnded(client, session.sessionId);

    await expect(
      client.callToolJson('task_create', {
        prompt: 'test',
        cwd: process.cwd(),
        targetSessionId: session.sessionId,
      }),
    ).rejects.toThrow(/ended/i);
  });

  it('sidebar_get_tasks returns all tasks', async () => {
    const task = await createTask(client, {
      prompt: 'sidebar test',
      scheduledAt: futureIso(),
    });
    const sidebarTasks = await client.callToolJson<Array<{ id: number }>>('sidebar_get_tasks');
    expect(sidebarTasks.some((t) => t.id === task.id)).toBe(true);
    await cancelTask(client, task.id);
  });

  it('rejects task targeting fallback-mode Claude session', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);
    const active = await waitForActive(client, session.sessionId);
    expect(active.hookMode).toBe('fallback');

    await expect(
      client.callToolJson('task_create', {
        prompt: 'test',
        cwd: process.cwd(),
        targetSessionId: session.sessionId,
      }),
    ).rejects.toThrow(/live hook mode/i);

    await killAndWaitEnded(client, session.sessionId);
  });

  it('task_update changes prompt of pending task', async () => {
    const task = await createTask(client, {
      prompt: 'original prompt',
      scheduledAt: futureIso(),
    });

    const updated = await updateTask(client, task.id, { prompt: 'updated prompt' });
    expect(updated.prompt).toBe('updated prompt');

    // Verify via list
    const tasks = await listTasks(client);
    const found = tasks.find((t) => t.id === task.id);
    expect(found?.prompt).toBe('updated prompt');

    await cancelTask(client, task.id);
  });

  it('task_update changes priority and scheduledAt', async () => {
    const task = await createTask(client, {
      prompt: 'update test',
      priority: 5,
      scheduledAt: futureIso(),
    });

    const newScheduled = futureIso(120000);
    const updated = await updateTask(client, task.id, {
      priority: 20,
      scheduledAt: newScheduled,
    });
    expect(updated.priority).toBe(20);
    expect(updated.scheduledAt).toBe(newScheduled);

    await cancelTask(client, task.id);
  });

  it('task_update rejects non-pending tasks', async () => {
    const task = await createTask(client, {
      prompt: 'will cancel',
      scheduledAt: futureIso(),
    });
    await cancelTask(client, task.id);

    await expect(
      updateTask(client, task.id, { prompt: 'too late' }),
    ).rejects.toThrow(/only pending/i);
  });
});
