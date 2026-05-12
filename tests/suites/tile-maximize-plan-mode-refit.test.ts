import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createLiveClaudeTestSession,
  waitForActive,
  cleanupSessions,
  resetTestState,
  waitForTileCount,
  getTileCount,
  injectHookEvent,
  sleep,
} from '../helpers';

// Verifies that the terminal refits when TileTaskPanel's plan-mode banner
// toggles on a maximized tile.
//
// Bug: when Claude Code presents a plan for review (ExitPlanMode tool ->
// session-state-machine transitions to status='waiting' +
// attentionReason='Waiting for your response'), TileTaskPanel inserts the
// "Needs response" banner above the terminal. The sibling flex-1 div hosting
// TerminalInstance shrinks, but the only path that picked up that reflow was
// the ResizeObserver, single-pass via setTimeout(safeFit, 0) - the same
// transient-dimension failure mode b1773fd documented for the maximize fit.
// With no rAF / 100ms backstop, the terminal could lock at stale rows, the
// xterm grid extending below the visible area, and wheel events on the .xterm
// element no longer producing visible output (user-reported "unscrollable").
//
// Fix: TerminalInstance now exposes a shared multi-pass scheduleRefit (setTimeout(0)
// + rAF safeFit+verifyAndCorrectFit + setTimeout(100, verifyAndCorrectFit)) and
// subscribes to this session's status + attentionReason. ResizeObserver and
// MutationObserver also route through scheduleRefit, so any layout-affecting
// state change converges on the same backstop the maximize path already had.
describe('tile maximize plan-mode banner refit', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let baselineTileCount: number;
  let sessionId: string;

  beforeAll(async () => {
    await client.connect();

    // Reload so the freshly-built TerminalInstance code is the module instance
    // that mounts new sessions.
    try {
      await client.callToolJson<null>('window_execute_js', {
        code: 'location.reload(); null',
      });
    } catch {
      // Expected: renderer reloads, breaking the executeJavaScript response
    }
    await sleep(3000);

    await resetTestState(client);
    baselineTileCount = await getTileCount(client);

    const s1 = await createLiveClaudeTestSession(client);
    sessionId = s1.sessionId;
    sessionIds.push(sessionId);
    await waitForActive(client, sessionId);
    await waitForTileCount(client, baselineTileCount + 1);
    // Let the initial fit settle before sampling baseline dimensions.
    await sleep(500);
  });

  afterAll(async () => {
    await client.callTool('layout_restore_from_maximize').catch(() => {});
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('refits term.rows when the plan-mode banner appears and clears on a maximized tile', async () => {
    await client.callTool('layout_maximize', { sessionId });
    // setTimeout(0) + rAF + setTimeout(100) refit cycle + slack.
    await sleep(600);

    const beforeBanner = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId },
    );

    // Drive the session into plan-mode-review state. PreToolUse(ExitPlanMode)
    // sets lastTool; Stop with lastTool in USER_CHOICE_TOOLS transitions to
    // status='waiting' + attentionReason='Waiting for your response', which
    // TileTaskPanel reads to render the "Needs response" banner above the
    // terminal.
    await injectHookEvent(client, sessionId, 'PreToolUse', {
      toolName: 'ExitPlanMode',
    });
    await injectHookEvent(client, sessionId, 'Stop');

    // session-store update -> useSessionStore subscription in TerminalInstance
    // -> scheduleRefit (setTimeout(0) + rAF + setTimeout(100, verifyAndCorrectFit))
    // + slack.
    await sleep(400);

    const afterBanner = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId },
    );

    // Banner inserts a flex child above the terminal -> flex-1 shrinks -> term
    // loses at least one row. Without the fix, term.rows would stay at
    // beforeBanner.rows (single-pass ResizeObserver fit landing on stale
    // dimensions), and the terminal's bottom rows would render below the
    // visible container.
    expect(afterBanner.rows).toBeLessThan(beforeBanner.rows);
    expect(afterBanner.cols).toBe(beforeBanner.cols);

    // No late corrective resize should still be pending - two reads 250ms
    // apart must agree, matching the post-maximize stability assertion in
    // tile-maximize-narrow-render.test.ts.
    await sleep(250);
    const settled = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId },
    );
    expect(settled.rows).toBe(afterBanner.rows);
    expect(settled.cols).toBe(afterBanner.cols);

    // UserPromptSubmit on a waiting session transitions back to 'active' and
    // clears the action-level attentionReason. TileTaskPanel hides the
    // banner; the panel wrapper itself goes away (no tasks queued); flex-1
    // grows back; term.rows must follow.
    await injectHookEvent(client, sessionId, 'UserPromptSubmit');
    await sleep(400);

    const cleared = await client.callToolJson<{ cols: number; rows: number }>(
      'terminal_get_dimensions',
      { sessionId },
    );
    expect(cleared.rows).toBeGreaterThan(afterBanner.rows);
    expect(cleared.cols).toBe(afterBanner.cols);
  });
});
