import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerContext } from '../types';
import { queryRenderer } from '../ipc';

export function registerTestTools(
  server: McpServer,
  ctx: McpServerContext,
): void {
  server.registerTool('app_reset_test_state', {
    description:
      'Reset app to clean state for test isolation. Kills active sessions, deletes all ended sessions, removes all tiles, resets view mode to tiles, clears sidebar selection, clears attention, clears hook events, cancels pending tasks.',
    annotations: { readOnlyHint: false },
  }, async () => {
    const summary: string[] = [];

    // 1. Kill all active/starting sessions
    const sessions = ctx.sessionManager.list({ includeEphemeral: true });
    const toKill = sessions.filter((s) => s.status !== 'ended');
    for (const s of toKill) {
      try {
        await ctx.sessionManager.kill(s.sessionId);
      } catch {
        // Best-effort — session may have already exited
      }
    }
    if (toKill.length > 0) {
      // Give processes time to exit so deleteAllEnded picks them up
      await new Promise((r) => setTimeout(r, 500));
      summary.push(`Killed ${toKill.length} session(s)`);
    }

    // 2. Delete all ended sessions from DB
    const deleted = ctx.sessionManager.deleteAllEnded();
    if (deleted.length > 0) {
      summary.push(`Deleted ${deleted.length} ended session(s)`);
    }

    // 3. Remove all tiles from layout
    try {
      await queryRenderer<void>(ctx.mainWindow, 'layout-remove-all-tiles', {});
      summary.push('Removed all tiles');
    } catch {
      // Renderer may not have tiles
    }

    // 4. Reset view mode to tiles
    try {
      await queryRenderer<void>(ctx.mainWindow, 'layout-set-view-mode', { mode: 'tiles' });
      summary.push('Reset view mode to tiles');
    } catch {
      // Best-effort
    }

    // 5. Clear sidebar selection
    try {
      await queryRenderer<void>(ctx.mainWindow, 'session-select', { sessionId: null });
      summary.push('Cleared sidebar selection');
    } catch {
      // Best-effort
    }

    // 6. Clear all attention
    ctx.sessionManager.clearAllAttention();
    summary.push('Cleared all attention');

    // 7. Clear all hook events
    ctx.sessionManager.clearAllEvents();
    summary.push('Cleared hook events');

    // 8. Cancel all pending tasks
    const cancelledCount = ctx.taskQueue.cancelAllPending();
    if (cancelledCount > 0) {
      summary.push(`Cancelled ${cancelledCount} pending task(s)`);
    }

    return {
      content: [{
        type: 'text',
        text: summary.length > 0 ? summary.join('; ') : 'Nothing to reset',
      }],
    };
  });

  server.registerTool('app_detach_all', {
    description:
      'Mark all running sessions as detached, simulating app window close. Preserves pre-detach status for later restoration.',
    annotations: { readOnlyHint: false },
  }, async () => {
    ctx.sessionManager.detachAllActive();
    const sessions = ctx.sessionManager.list({ includeEphemeral: true });
    const detached = sessions.filter((s) => s.status === 'detached');
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ detachedCount: detached.length, sessions: detached }, null, 2),
      }],
    };
  });

  server.registerTool('app_reconcile_detached', {
    description:
      'Reconcile detached sessions against a list of alive session IDs, simulating app window reopen. Restores pre-detach status for alive sessions, marks the rest as ended.',
    inputSchema: {
      aliveSessionIds: z.array(z.string()).describe('Session IDs that are still alive (running in PTY broker)'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ aliveSessionIds }) => {
    ctx.sessionManager.reconcileDetachedSessions(aliveSessionIds);
    const sessions = ctx.sessionManager.list({ includeEphemeral: true });
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(sessions, null, 2),
      }],
    };
  });
}
