CREATE TABLE account_provider_identities (
  account_id TEXT NOT NULL,
  session_type TEXT NOT NULL,
  auth_status TEXT NOT NULL DEFAULT 'not-authenticated',
  identity TEXT,
  display_name TEXT,
  last_checked_at TEXT,
  last_authenticated_at TEXT,
  metadata_json TEXT,
  PRIMARY KEY (account_id, session_type),
  FOREIGN KEY (account_id) REFERENCES account_profiles(account_id) ON DELETE CASCADE
);

-- Backfill existing Claude identity from account_profiles.email
INSERT INTO account_provider_identities (account_id, session_type, auth_status, identity)
SELECT account_id, 'claude', CASE WHEN email IS NOT NULL THEN 'ok' ELSE 'not-authenticated' END, email
FROM account_profiles;
