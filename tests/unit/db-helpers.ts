import type { Database } from 'better-sqlite3';

/**
 * Truncates test data from the database.
 * 
 * Safely removes sessions and related data (events, tasks) where is_test = 1.
 * In the unit test environment (NODE_ENV === 'test'), it clears all tables
 * in the correct order to respect foreign key constraints.
 * 
 * @param db The better-sqlite3 database instance
 */
export function truncateTestData(db: Database): void {
  const isUnitTestCase = process.env.NODE_ENV === 'test';

  // Order matters for Foreign Keys! Child tables must be deleted before parents.
  
  if (isUnitTestCase) {
    // 1. Child tables of sessions
    db.prepare('DELETE FROM events').run();
    db.prepare('DELETE FROM task_queue').run();
    db.prepare('DELETE FROM session_labels').run();
    
    // 2. Parent table (sessions)
    db.prepare('DELETE FROM sessions').run();

    // 3. Child tables of account_profiles
    db.prepare('DELETE FROM account_provider_identities').run();
    
    // 4. Root tables
    db.prepare('DELETE FROM account_profiles').run();
    db.prepare('DELETE FROM preferences').run();
    db.prepare('DELETE FROM layout_state').run();
    db.prepare('DELETE FROM token_usage').run();
    db.prepare('DELETE FROM commits').run();
    db.prepare('DELETE FROM tracked_repos').run();
    db.prepare('DELETE FROM tracked_jsonl_files').run();
  } else {
    // Selective cleanup for integration tests (keep real user data)
    
    // 1. Child tables of sessions (only for test sessions)
    db.prepare(`
      DELETE FROM events 
      WHERE session_id IN (SELECT session_id FROM sessions WHERE is_test = 1)
    `).run();

    db.prepare(`
      DELETE FROM task_queue 
      WHERE target_session_id IN (SELECT session_id FROM sessions WHERE is_test = 1)
    `).run();

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

    // 2. Parent table (sessions)
    db.prepare('DELETE FROM sessions WHERE is_test = 1').run();
  }
}
