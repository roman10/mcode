import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createGeminiTestSession,
  waitForIdle,
  killAndWaitEnded,
  cleanupSessions,
  injectHookEvent,
  createTask,
  waitForTaskStatus,
  resetTestState,
  type SessionInfo,
} from '../helpers';

/**
 * Create a live Gemini test session and transition it to idle.
 * The fixture binary is named `gemini`, matching isGeminiCommand().
 * If the Gemini hook bridge is configured, the session gets hookMode='live'.
 */
async function createIdleLiveGeminiSession(
  client: McpTestClient,
): Promise<SessionInfo> {
  const session = await createGeminiTestSession(client);
  if (session.hookMode !== 'live') {
    throw new Error(
      `Expected Gemini session to have hookMode='live', got '${session.hookMode}'. ` +
      'Ensure the dev instance has the Gemini hook bridge configured.',
    );
  }

  // Inject SessionStart to transition starting → active
  await injectHookEvent(client, session.sessionId, 'SessionStart');
  // Inject Stop (AfterAgent equivalent) to transition active → idle
  return injectHookEvent(client, session.sessionId, 'Stop');
}

describe('gemini task queue', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('dispatches a task to a live Gemini session', async () => {
    const session = await createIdleLiveGeminiSession(client);
    sessionIds.push(session.sessionId);
    expect(session.hookMode).toBe('live');
    expect(session.status).toBe('idle');

    const task = await createTask(client, {
      prompt: 'inspect tests',
      targetSessionId: session.sessionId,
    });

    // Task should dispatch
    const dispatched = await waitForTaskStatus(client, task.id, 'dispatched', 10000);
    expect(dispatched.sessionId).toBe(session.sessionId);

    // Simulate Gemini working then completing
    await injectHookEvent(client, session.sessionId, 'PreToolUse', { toolName: 'Bash' });
    await injectHookEvent(client, session.sessionId, 'Stop');

    const completed = await waitForTaskStatus(client, task.id, 'completed', 10000);
    expect(completed.completedAt).not.toBeNull();

    await killAndWaitEnded(client, session.sessionId);
  });

  it('dispatches tasks sequentially on a Gemini session', async () => {
    const session = await createIdleLiveGeminiSession(client);
    sessionIds.push(session.sessionId);

    const t1 = await createTask(client, { prompt: 'task 1', targetSessionId: session.sessionId });
    const t2 = await createTask(client, { prompt: 'task 2', targetSessionId: session.sessionId });

    // First task dispatches
    await waitForTaskStatus(client, t1.id, 'dispatched', 10000);

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

    await killAndWaitEnded(client, session.sessionId);
  });

  it('rejects permission-mode tasks for Gemini sessions', async () => {
    const session = await createIdleLiveGeminiSession(client);
    sessionIds.push(session.sessionId);

    await expect(
      createTask(client, {
        prompt: 'test',
        targetSessionId: session.sessionId,
        permissionMode: 'auto',
      }),
    ).rejects.toThrow(/permission mode/i);

    await killAndWaitEnded(client, session.sessionId);
  });

  it('rejects plan-mode tasks for Gemini sessions', async () => {
    const session = await createIdleLiveGeminiSession(client);
    sessionIds.push(session.sessionId);

    await expect(
      createTask(client, {
        prompt: 'test',
        targetSessionId: session.sessionId,
        planModeAction: { exitPlanMode: false },
      }),
    ).rejects.toThrow(/plan mode/i);

    await killAndWaitEnded(client, session.sessionId);
  });

  it('rejects task targeting a fallback Gemini session', async () => {
    // Create a Gemini session with a non-gemini command to force fallback mode
    const session = await createGeminiTestSession(client, {
      command: 'bash',
    });
    sessionIds.push(session.sessionId);
    await waitForIdle(client, session.sessionId);
    expect(session.hookMode).toBe('fallback');

    await expect(
      createTask(client, {
        prompt: 'test',
        targetSessionId: session.sessionId,
      }),
    ).rejects.toThrow(/live hook mode/i);

    await killAndWaitEnded(client, session.sessionId);
  });

  it('fails Gemini tasks when session ends', async () => {
    const session = await createIdleLiveGeminiSession(client);
    sessionIds.push(session.sessionId);

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
});
