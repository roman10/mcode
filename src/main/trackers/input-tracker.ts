import { getDb } from '../db';
import { localDateStr, enumerateDates } from './date-utils';
import { typedHandle } from '../ipc-helpers';
import type {
  DailyInputStats,
  InputHeatmapEntry,
  InputWeeklyTrend,
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

interface WeekRow {
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
  };
}

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

  getInputWeeklyTrend(provider?: string): InputWeeklyTrend {
    const db = getDb();
    const pf = inputProviderFilter(provider);

    const thisWeekRow = db.prepare(`
      SELECT COUNT(*) as message_count,
             COALESCE(SUM(text_length), 0) as total_chars
      FROM human_input
      WHERE date >= date('now', 'localtime', 'weekday 0', '-6 days')${pf.clause}
    `).get(...pf.params) as WeekRow;

    const lastWeekRow = db.prepare(`
      SELECT COUNT(*) as message_count,
             COALESCE(SUM(text_length), 0) as total_chars
      FROM human_input
      WHERE date >= date('now', 'localtime', 'weekday 0', '-13 days')
        AND date < date('now', 'localtime', 'weekday 0', '-6 days')${pf.clause}
    `).get(...pf.params) as WeekRow;

    const pctChange = lastWeekRow.message_count > 0
      ? Math.round(((thisWeekRow.message_count - lastWeekRow.message_count) / lastWeekRow.message_count) * 100)
      : null;

    return {
      thisWeek: {
        messageCount: thisWeekRow.message_count,
        totalCharacters: thisWeekRow.total_chars,
      },
      lastWeek: {
        messageCount: lastWeekRow.message_count,
        totalCharacters: lastWeekRow.total_chars,
      },
      pctChange,
    };
  }

  // ── Prompt history queries ──────────────────────────────────────────────

  searchPrompts(query: string, limit = 50): PromptHistoryEntry[] {
    const db = getDb();
    // Escape LIKE wildcards in user input
    const escaped = query.replace(/[%_\\]/g, '\\$&');
    const rows = db.prepare(`
      SELECT id, prompt_text, agent_session_id, project_dir,
             word_count, message_timestamp, provider, is_pinned
      FROM human_input
      WHERE prompt_text IS NOT NULL
        AND prompt_text LIKE ? ESCAPE '\\'
      ORDER BY is_pinned DESC, message_timestamp DESC
      LIMIT ?
    `).all(`%${escaped}%`, limit) as PromptHistoryRow[];

    return rows.map(toPromptHistoryEntry);
  }

  recentPrompts(limit = 50): PromptHistoryEntry[] {
    const db = getDb();
    const rows = db.prepare(`
      SELECT id, prompt_text, agent_session_id, project_dir,
             word_count, message_timestamp, provider, is_pinned
      FROM human_input
      WHERE prompt_text IS NOT NULL
      ORDER BY is_pinned DESC, message_timestamp DESC
      LIMIT ?
    `).all(limit) as PromptHistoryRow[];

    return rows.map(toPromptHistoryEntry);
  }

  togglePin(id: number): void {
    const db = getDb();
    db.prepare('UPDATE human_input SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END WHERE id = ?').run(id);
  }

  deletePrompt(id: number): void {
    const db = getDb();
    // Null out the text rather than deleting the row — the row still feeds input stats.
    db.prepare('UPDATE human_input SET prompt_text = NULL, is_pinned = 0 WHERE id = ?').run(id);
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

export function registerInputIpc(inputTracker: InputTracker): void {
  typedHandle('input:get-daily-stats', (date, provider) => {
    return inputTracker.getDailyInputStats(date, provider);
  });

  typedHandle('input:get-heatmap', (startDate, endDate, provider, fillEmptyDays) => {
    return inputTracker.getInputHeatmap(startDate, endDate, provider, fillEmptyDays);
  });

  typedHandle('input:get-weekly-trend', (provider) => {
    return inputTracker.getInputWeeklyTrend(provider);
  });

  typedHandle('input:get-cadence', (date, provider) => {
    return inputTracker.getInputCadence(date, provider);
  });

  typedHandle('prompt-history:search', (query, limit) => {
    return inputTracker.searchPrompts(query, limit);
  });

  typedHandle('prompt-history:recent', (limit) => {
    return inputTracker.recentPrompts(limit);
  });

  typedHandle('prompt-history:delete', (id) => {
    inputTracker.deletePrompt(id);
  });

  typedHandle('prompt-history:toggle-pin', (id) => {
    inputTracker.togglePin(id);
  });
}
