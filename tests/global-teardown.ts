import { McpTestClient } from './mcp-client';

export default async function globalTeardown(): Promise<void> {
  const client = new McpTestClient();
  try {
    await client.connect();
    await client.callTool('session_delete_all_ended_test');
    await client.disconnect();
  } catch {
    // Best-effort — app may already be shut down
  }
}
