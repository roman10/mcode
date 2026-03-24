import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import {
  createTestSession,
  cleanupSessions,
  type SessionInfo,
  resetTestState,
} from '../helpers';

interface AccountProfile {
  accountId: string;
  name: string;
  email: string | null;
  isDefault: boolean;
}

describe('session account assignment', () => {
  const client = new McpTestClient();
  const sessionIds: string[] = [];
  let defaultAccount: AccountProfile;

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
    const accounts = await client.callToolJson<AccountProfile[]>('account_list');
    const found = accounts.find((a) => a.isDefault);
    if (!found) throw new Error('No default account found');
    defaultAccount = found;
  });

  afterAll(async () => {
    await cleanupSessions(client, sessionIds);
    await client.disconnect();
  });

  it('creates session without accountId → accountId is null', async () => {
    const session = await createTestSession(client);
    sessionIds.push(session.sessionId);

    expect(session.accountId).toBeNull();

    const status = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(status.accountId).toBeNull();
  });

  it('creates session with accountId → accountId is stored', async () => {
    const session = await createTestSession(client, {
      accountId: defaultAccount.accountId,
    });
    sessionIds.push(session.sessionId);

    expect(session.accountId).toBe(defaultAccount.accountId);

    const status = await client.callToolJson<SessionInfo>('session_get_status', {
      sessionId: session.sessionId,
    });
    expect(status.accountId).toBe(defaultAccount.accountId);
  });
});
