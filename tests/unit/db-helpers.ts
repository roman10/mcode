import type { Database } from 'better-sqlite3';

/**
 * Truncates test data from the database.
 * 
 * Safely removes sessions and related data (events, tasks) where is_test = 1.
 * In the unit test environment (NODE_ENV === 'test'), it also clears global 
 * tables like accounts and preferences to ensure total isolation.
 * 
 * @param db The better-sqlite3 database instance
 */
export function truncateTestData(db: Database): void {
  // 1. Delete events for test sessions
  db.prepare(`
    DELETE FROM events 
    WHERE session_id IN (SELECT session_id FROM sessions WHERE is_test = 1)
  `).run();

  // 2. Delete tasks targeting test sessions
  db.prepare(`
    DELETE FROM task_queue 
    WHERE target_session_id IN (SELECT session_id FROM sessions WHERE is_test = 1)
  `).run();

  // 3. Delete snapshots of test sessions
  db.prepare(`
    DELETE FROM session_labels 
    WHERE agent_session_id IN (
      SELECT claude_session_id FROM sessions WHERE is_test = 1 AND claude_session_id IS NOT NULL
      UNION
      SELECT codex_thread_id FROM sessions WHERE is_test = 1 AND codex_thread_id IS NOT NULL
      UNION
      SELECT gemini_session_id FROM sessions WHERE is_test = 1 AND gemini_session_id IS NOT NULL
      UNION
      SELECT copilot_session_id FROM sessions WHERE is_test = 1 AND copilot_session_id IS NOT NULL
    )
  `).run();

  // 4. Delete test sessions themselves
  db.prepare('DELETE FROM sessions WHERE is_test = 1').run();

  // 5. In unit tests, we use an in-memory mock and want a truly clean slate.
  // Wipe everything — the is_test filtering above is for integration tests
  // where real user sessions must survive; unit tests own the entire DB.
  if (process.env.NODE_ENV === 'test') {
    db.prepare('DELETE FROM events').run();
    db.prepare('DELETE FROM task_queue').run();
    db.prepare('DELETE FROM session_labels').run();
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM account_provider_identities').run();
    db.prepare('DELETE FROM account_profiles').run();
    db.prepare('DELETE FROM preferences').run();
    db.prepare('DELETE FROM layout_state').run();
    db.prepare('DELETE FROM token_usage').run();
    db.prepare('DELETE FROM commits').run();
    db.prepare('DELETE FROM tracked_repos').run();
    db.prepare('DELETE FROM tracked_jsonl_files').run();
  }
}
