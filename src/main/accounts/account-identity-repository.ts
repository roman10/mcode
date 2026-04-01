import { getDb } from '../db';

interface IdentityRecord {
  account_id: string;
  session_type: string;
  auth_status: string;
  identity: string | null;
  display_name: string | null;
  last_checked_at: string | null;
  last_authenticated_at: string | null;
  metadata_json: string | null;
}

export interface ProviderIdentityRow {
  accountId: string;
  sessionType: string;
  authStatus: string;
  identity: string | null;
  displayName: string | null;
  lastCheckedAt: string | null;
  lastAuthenticatedAt: string | null;
}

function toRow(r: IdentityRecord): ProviderIdentityRow {
  return {
    accountId: r.account_id,
    sessionType: r.session_type,
    authStatus: r.auth_status,
    identity: r.identity,
    displayName: r.display_name,
    lastCheckedAt: r.last_checked_at,
    lastAuthenticatedAt: r.last_authenticated_at,
  };
}

/**
 * Persistence layer for provider-scoped identity state.
 * Each account can have one identity row per provider (session_type).
 */
export class AccountIdentityRepository {
  get(accountId: string, sessionType: string): ProviderIdentityRow | null {
    const db = getDb();
    const row = db
      .prepare('SELECT * FROM account_provider_identities WHERE account_id = ? AND session_type = ?')
      .get(accountId, sessionType) as IdentityRecord | undefined;
    return row ? toRow(row) : null;
  }

  list(accountId: string): ProviderIdentityRow[] {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM account_provider_identities WHERE account_id = ? ORDER BY session_type')
      .all(accountId) as IdentityRecord[];
    return rows.map(toRow);
  }

  upsert(
    accountId: string,
    sessionType: string,
    authStatus: string,
    identity?: string | null,
    displayName?: string | null,
  ): void {
    const db = getDb();
    const now = new Date().toISOString();
    const lastAuth = authStatus === 'ok' ? now : undefined;

    db.prepare(
      `INSERT INTO account_provider_identities (account_id, session_type, auth_status, identity, display_name, last_checked_at, last_authenticated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (account_id, session_type)
       DO UPDATE SET auth_status = excluded.auth_status,
                     identity = COALESCE(excluded.identity, identity),
                     display_name = COALESCE(excluded.display_name, display_name),
                     last_checked_at = excluded.last_checked_at,
                     last_authenticated_at = COALESCE(excluded.last_authenticated_at, last_authenticated_at)`,
    ).run(accountId, sessionType, authStatus, identity ?? null, displayName ?? null, now, lastAuth ?? null);
  }

  deleteAll(accountId: string): void {
    const db = getDb();
    db.prepare('DELETE FROM account_provider_identities WHERE account_id = ?').run(accountId);
  }
}
