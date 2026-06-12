import { getDb } from '../db';
import { localDateStr, enumerateDates } from './date-utils';
import type {
  DailyInputStats,
  InputHeatmapEntry,
  InputCadenceInfo,
  PromptHistoryEntry,
} from '../../shared/types';
import type { AgentSessionType } from '../../shared/session-agents';
import type { ParsedHumanEntry } from './jsonl-usage-parser';

/** Build optional provider WHERE clause fragment. */
function inputProviderFilter(provider?: string): { clause: string; params: unknown[] } {
  return provider ? { clause: ' AND provider = ?', params: [provider] } : { clause: '', params: [] };
}

interface DailyAggRow {
  message_count: number;
  total_chars: number;
  total_words: number;
  session_count: number;
}

interface HeatmapRow {
  date: string;
  message_count: number;
  total_chars: number;
}

interface HourRow {
  hour: string;
  cnt: number;
}

interface ThinkTimeRow {
  think_seconds: number;
}

interface PromptHistoryRow {
  id: number;
  prompt_text: string;
  agent_session_id: string;
  project_dir: string;
  word_count: number;
  message_timestamp: string;
  provider: string;
  is_pinned: number;
  use_count: number;
  first_used_at: string;
  last_used_at: string;
  project_count: number;
  provider_count: number;
}

function toPromptHistoryEntry(row: PromptHistoryRow): PromptHistoryEntry {
  return {
    id: row.id,
    promptText: row.prompt_text,
    agentSessionId: row.agent_session_id,
    projectDir: row.project_dir,
    wordCount: row.word_count,
    messageTimestamp: row.message_timestamp,
    provider: row.provider,
    isPinned: row.is_pinned === 1,
    useCount: row.use_count,
    firstUsedAt: row.first_used_at,
    lastUsedAt: row.last_used_at,
    projectCount: row.project_count,
    providerCount: row.provider_count,
  };
}

function normalizePromptText(prompt: string): string {
  return prompt.replace(/[\n\r\t]/g, ' ').trim().toLowerCase();
}

const SQL_NORMALIZED_PROMPT = "lower(trim(replace(replace(replace(prompt_text, char(10), ' '), char(13), ' '), char(9), ' ')))";

export class InputTracker {
  /** Batch-insert parsed human entries. Called by TokenTracker during JSONL scan. */
  insertBatch(
    entries: ParsedHumanEntry[],
    agentSessionId: string,
    projectDir: string,
    provider: string = 'claude',
  ): number {
    if (entries.length === 0) return 0;

    const db = getDb();
    const stmt = db.prepare(`
      INSERT INTO human_input
        (message_id, agent_session_id, project_dir, text_length, word_count, message_timestamp, date, provider, prompt_text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO UPDATE SET prompt_text = excluded.prompt_text
        WHERE prompt_text IS NULL
    `);

    let newCount = 0;
    const insertAll = db.transaction(() => {
      for (const entry of entries) {
        const date = localDateStr(new Date(entry.timestamp));
        const result = stmt.run(
          entry.messageId,
          agentSessionId,
          projectDir,
          entry.textLength,
          entry.wordCount,
          entry.timestamp,
          date,
          provider,
          entry.text,
        );
        if (result.changes > 0) newCount++;
      }
    });
    insertAll();

    return newCount;
  }

  // --- Query methods ---

  getDailyInputStats(date?: string, provider?: string): DailyInputStats {
    const db = getDb();
    const targetDate = date ?? localDateStr(new Date());
    const pf = inputProviderFilter(provider);

    const row = db.prepare(`
      SELECT COUNT(*) as message_count,
             COALESCE(SUM(text_length), 0) as total_chars,
             COALESCE(SUM(word_count), 0) as total_words,
             COUNT(DISTINCT agent_session_id) as session_count
      FROM human_input
      WHERE date = ?${pf.clause}
    `).get(targetDate, ...pf.params) as DailyAggRow;

    // Cross-query commits for messages-per-commit ratio
    let messagesPerCommit: number | null = null;
    if (row.message_count > 0) {
      const commitRow = db.prepare(
        'SELECT COUNT(*) as cnt FROM commits WHERE date = ?',
      ).get(targetDate) as { cnt: number } | undefined;
      const commitCount = commitRow?.cnt ?? 0;
      if (commitCount > 0) {
        messagesPerCommit = Math.round((row.message_count / commitCount) * 10) / 10;
      }
    }

    // Per-provider breakdown
    const providerRows = db.prepare(`
      SELECT provider,
             COUNT(*) as message_count,
             COALESCE(SUM(text_length), 0) as total_chars
      FROM human_input
      WHERE date = ?${pf.clause}
      GROUP BY provider
    `).all(targetDate, ...pf.params) as { provider: string; message_count: number; total_chars: number }[];

    const byProvider = providerRows.map((pr) => ({
      provider: pr.provider as AgentSessionType,
      messageCount: pr.message_count,
      totalCharacters: pr.total_chars,
    }));

    return {
      date: targetDate,
      messageCount: row.message_count,
      totalCharacters: row.total_chars,
      totalWords: row.total_words,
      activeSessionCount: row.session_count,
      messagesPerCommit,
      byProvider,
    };
  }

  getInputHeatmap(
    startDateStr: string,
    endDateStr: string,
    provider?: string,
    fillEmptyDays = true,
  ): InputHeatmapEntry[] {
    const db = getDb();
    const pf = inputProviderFilter(provider);

    const rows = db.prepare(`
      SELECT date,
             COUNT(*) as message_count,
             COALESCE(SUM(text_length), 0) as total_chars
      FROM human_input
      WHERE date BETWEEN ? AND ?${pf.clause}
      GROUP BY date
      ORDER BY date ASC
    `).all(startDateStr, endDateStr, ...pf.params) as HeatmapRow[];

    if (!fillEmptyDays) {
      return rows.map((r) => ({
        date: r.date,
        messageCount: r.message_count,
        totalCharacters: r.total_chars,
      }));
    }

    const rowMap = new Map(rows.map((r) => [r.date, r]));
    return enumerateDates(startDateStr, endDateStr).map((date) => {
      const r = rowMap.get(date);
      return {
        date,
        messageCount: r?.message_count ?? 0,
        totalCharacters: r?.total_chars ?? 0,
      };
    });
  }

  // ── Prompt history queries ──────────────────────────────────────────────

  searchPrompts(query: string, limit = 50): PromptHistoryEntry[] {
    const db = getDb();
    // Escape LIKE wildcards in user input
    const escaped = query.replace(/[%_\\]/g, '\\$&');
    const rows = db.prepare(`
      WITH source AS (
        SELECT id, prompt_text, agent_session_id, project_dir,
               word_count, message_timestamp, provider, is_pinned,
               ${SQL_NORMALIZED_PROMPT} AS normalized_prompt
        FROM human_input
        WHERE prompt_text IS NOT NULL
          AND trim(prompt_text) <> ''
      ),
      matches AS (
        SELECT DISTINCT normalized_prompt
        FROM source
        WHERE prompt_text LIKE ? ESCAPE '\\'
      ),
      grouped AS (
        SELECT source.normalized_prompt,
               COUNT(*) AS use_count,
               MIN(message_timestamp) AS first_used_at,
               MAX(message_timestamp) AS last_used_at,
               COUNT(DISTINCT project_dir) AS project_count,
               COUNT(DISTINCT provider) AS provider_count,
               MAX(is_pinned) AS is_pinned
        FROM source
        JOIN matches ON matches.normalized_prompt = source.normalized_prompt
        GROUP BY source.normalized_prompt
      ),
      ranked AS (
        SELECT source.*, grouped.use_count, grouped.first_used_at, grouped.last_used_at,
               grouped.project_count, grouped.provider_count, grouped.is_pinned AS group_is_pinned,
               ROW_NUMBER() OVER (
                 PARTITION BY source.normalized_prompt
                 ORDER BY source.is_pinned DESC, source.message_timestamp DESC, source.id DESC
               ) AS rn
        FROM source
        JOIN grouped ON grouped.normalized_prompt = source.normalized_prompt
      )
      SELECT id, prompt_text, agent_session_id, project_dir,
             word_count, message_timestamp, provider, group_is_pinned AS is_pinned,
             use_count, first_used_at, last_used_at, project_count, provider_count
      FROM ranked
      WHERE rn = 1
      ORDER BY group_is_pinned DESC, last_used_at DESC
      LIMIT ?
    `).all(`%${escaped}%`, limit) as PromptHistoryRow[];

    return rows.map(toPromptHistoryEntry);
  }

  recentPrompts(limit = 50): PromptHistoryEntry[] {
    const db = getDb();
    const rows = db.prepare(`
      WITH source AS (
        SELECT id, prompt_text, agent_session_id, project_dir,
               word_count, message_timestamp, provider, is_pinned,
               ${SQL_NORMALIZED_PROMPT} AS normalized_prompt
        FROM human_input
        WHERE prompt_text IS NOT NULL
          AND trim(prompt_text) <> ''
      ),
      grouped AS (
        SELECT normalized_prompt,
               COUNT(*) AS use_count,
               MIN(message_timestamp) AS first_used_at,
               MAX(message_timestamp) AS last_used_at,
               COUNT(DISTINCT project_dir) AS project_count,
               COUNT(DISTINCT provider) AS provider_count,
               MAX(is_pinned) AS is_pinned
        FROM source
        GROUP BY normalized_prompt
      ),
      ranked AS (
        SELECT source.*, grouped.use_count, grouped.first_used_at, grouped.last_used_at,
               grouped.project_count, grouped.provider_count, grouped.is_pinned AS group_is_pinned,
               ROW_NUMBER() OVER (
                 PARTITION BY source.normalized_prompt
                 ORDER BY source.is_pinned DESC, source.message_timestamp DESC, source.id DESC
               ) AS rn
        FROM source
        JOIN grouped ON grouped.normalized_prompt = source.normalized_prompt
      )
      SELECT id, prompt_text, agent_session_id, project_dir,
             word_count, message_timestamp, provider, group_is_pinned AS is_pinned,
             use_count, first_used_at, last_used_at, project_count, provider_count
      FROM ranked
      WHERE rn = 1
      ORDER BY group_is_pinned DESC, last_used_at DESC
      LIMIT ?
    `).all(limit) as PromptHistoryRow[];

    return rows.map(toPromptHistoryEntry);
  }

  togglePin(id: number): void {
    const db = getDb();
    const row = db.prepare('SELECT prompt_text FROM human_input WHERE id = ? AND prompt_text IS NOT NULL')
      .get(id) as { prompt_text: string } | undefined;
    if (!row) return;

    const normalizedPrompt = normalizePromptText(row.prompt_text);
    const pinned = db.prepare(`
      SELECT COUNT(*) AS count
      FROM human_input
      WHERE prompt_text IS NOT NULL
        AND ${SQL_NORMALIZED_PROMPT} = ?
        AND is_pinned = 1
    `).get(normalizedPrompt) as { count: number } | undefined;

    if ((pinned?.count ?? 0) > 0) {
      db.prepare(`
        UPDATE human_input
        SET is_pinned = 0
        WHERE prompt_text IS NOT NULL
          AND ${SQL_NORMALIZED_PROMPT} = ?
      `).run(normalizedPrompt);
      return;
    }

    db.prepare('UPDATE human_input SET is_pinned = 1 WHERE id = ?').run(id);
  }

  deletePrompt(id: number): void {
    const db = getDb();
    // Null out the text rather than deleting the row — the row still feeds input stats.
    const row = db.prepare('SELECT prompt_text FROM human_input WHERE id = ? AND prompt_text IS NOT NULL')
      .get(id) as { prompt_text: string } | undefined;
    if (!row) return;

    db.prepare(`
      UPDATE human_input
      SET prompt_text = NULL, is_pinned = 0
      WHERE prompt_text IS NOT NULL
        AND ${SQL_NORMALIZED_PROMPT} = ?
    `).run(normalizePromptText(row.prompt_text));
  }

  getInputCadence(date?: string, provider?: string): InputCadenceInfo {
    const db = getDb();
    const targetDate = date ?? localDateStr(new Date());
    const pf = inputProviderFilter(provider);

    // Peak interaction hour
    const hourRows = db.prepare(`
      SELECT strftime('%H', message_timestamp, 'localtime') as hour,
             COUNT(*) as cnt
      FROM human_input
      WHERE date = ?${pf.clause}
      GROUP BY hour
      ORDER BY cnt DESC
    `).all(targetDate, ...pf.params) as HourRow[];

    const peakHour = hourRows.length > 0 ? hourRows[0].hour : null;

    // Think time: avg delay between the last AI response and the next human message
    // within the same session. We join human_input with token_usage to find the
    // preceding AI message timestamp.
    let avgThinkTimeMinutes: number | null = null;

    const thinkRows = db.prepare(`
      SELECT think_seconds FROM (
        SELECT
          (julianday(h.message_timestamp) - julianday(
            (SELECT MAX(t.message_timestamp) FROM token_usage t
             WHERE t.agent_session_id = h.agent_session_id
               AND t.message_timestamp < h.message_timestamp)
          )) * 86400 as think_seconds
        FROM human_input h
        WHERE h.date = ?${pf.clause}
      ) WHERE think_seconds IS NOT NULL
        AND think_seconds > 0
        AND think_seconds < 3600
    `).all(targetDate, ...pf.params) as ThinkTimeRow[];

    if (thinkRows.length > 0) {
      const total = thinkRows.reduce((acc, r) => acc + r.think_seconds, 0);
      avgThinkTimeMinutes = Math.round((total / thinkRows.length / 60) * 10) / 10;
    }

    // Leverage ratio: AI output tokens per human input character for this day
    let leverageRatio: number | null = null;
    const charRow = db.prepare(
      `SELECT COALESCE(SUM(text_length), 0) as chars FROM human_input WHERE date = ?${pf.clause}`,
    ).get(targetDate, ...pf.params) as { chars: number };
    const tokenRow = db.prepare(
      `SELECT COALESCE(SUM(output_tokens), 0) as tokens FROM token_usage WHERE date = ?${pf.clause}`,
    ).get(targetDate, ...pf.params) as { tokens: number };

    if (charRow.chars > 0 && tokenRow.tokens > 0) {
      leverageRatio = Math.round(tokenRow.tokens / charRow.chars);
    }

    return {
      avgThinkTimeMinutes,
      peakHour,
      leverageRatio,
    };
  }
}
