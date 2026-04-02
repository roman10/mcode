import { McpTestClient } from './mcp-client';
import type { SessionInfo } from './helpers';

export default async function globalTeardown(): Promise<void> {
  const client = new McpTestClient();
  try {
    await client.connect();

    // 1. Kill any active test sessions that weren't cleaned up by failed tests
    const sessions = await client.callToolJson<SessionInfo[]>('session_list');
    const activeTestIds = sessions
      .filter((s) => s.isTest && s.status !== 'ended')
      .map((s) => s.sessionId);

    if (activeTestIds.length > 0) {
      await Promise.allSettled(
        activeTestIds.map((id) => client.callTool('session_kill', { sessionId: id })),
      );
      // Brief pause to allow processes to exit so delete_all_ended_test picks them up
      await new Promise((r) => setTimeout(r, 500));
    }

    // 2. Delete all ended test sessions (now including those just killed)
    await client.callTool('session_delete_all_ended_test');

    await client.disconnect();
  } catch {
    // Best-effort — app may already be shut down
  }
}
