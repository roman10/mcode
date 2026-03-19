-- Account profiles for multi-account support.
-- The default account uses standard ~/.claude/ (home_dir IS NULL).
-- Secondary accounts use HOME override with symlink mirroring.

CREATE TABLE account_profiles (
  account_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  home_dir TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

ALTER TABLE sessions ADD COLUMN account_id TEXT REFERENCES account_profiles(account_id);
