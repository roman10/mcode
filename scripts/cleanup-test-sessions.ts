/**
 * Delete all test sessions and remove their tiles, terminal tabs, and sidebar entries.
 * Connects to the running mcode app's MCP server using production-available tools.
 *
 * Usage: npx tsx scripts/cleanup-test-sessions.ts
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = process.env['MCODE_TEST_URL'] ?? 'http://127.0.0.1:7532/mcp';

interface SessionInfo {
  sessionId: string;
  status: string;
  isTest: boolean;
}

async function callTool(client: Client, name: string, args?: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: args ?? {} });
  return (result.content as Array<{ type: string; text?: string }>)
    .find((c) => c.type === 'text')?.text ?? '';
}

async function callToolJson<T>(client: Client, name: string, args?: Record<string, unknown>): Promise<T> {
  const text = await callTool(client, name, args);
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  const client = new Client({ name: 'cleanup-test-sessions', version: '0.1.0' });

  try {
    await client.connect(transport);
  } catch {
    console.error(`Cannot connect to mcode at ${MCP_URL}. Is the app running with MCP enabled?`);
    process.exit(1);
  }

  try {
    const sessions = await callToolJson<SessionInfo[]>(client, 'session_list');
    const testSessions = sessions.filter((s) => s.isTest);

    if (testSessions.length === 0) {
      console.log('No test sessions found.');
      return;
    }

    console.log(`Found ${testSessions.length} test session(s).`);

    // Remove tiles and terminal tabs
    await Promise.allSettled(
      testSessions.map((s) => callTool(client, 'layout_remove_tile', { sessionId: s.sessionId })),
    );
    await Promise.allSettled(
      testSessions.map((s) => callTool(client, 'terminal_panel_remove_tab', { sessionId: s.sessionId })),
    );

    // Kill active test sessions
    const active = testSessions.filter((s) => s.status !== 'ended');
    if (active.length > 0) {
      await Promise.allSettled(
        active.map((s) => callTool(client, 'session_kill', { sessionId: s.sessionId })),
      );
      await new Promise((r) => setTimeout(r, 500));
      console.log(`Killed ${active.length} active test session(s).`);
    }

    // Delete ended test sessions
    const result = await callTool(client, 'session_delete_all_ended_test');
    console.log(result);
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
