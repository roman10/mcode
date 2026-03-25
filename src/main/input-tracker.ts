import { getDb } from './db';
import { typedHandle } from './ipc-helpers';
import type {
  DailyInputStats,
  InputHeatmapEntry,
  InputWeeklyTrend,
  InputCadenceInfo,
} from '../shared/types';
import type { ParsedHumanEntry } from './jsonl-usage-parser';

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

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export class InputTracker {
  /** Batch-insert parsed human entries. Called by TokenTracker during JSONL scan. */
  insertBatch(
    entries: ParsedHumanEntry[],
    claudeSessionId: string,
    projectDir: string,
  ): number {
    if (entries.length === 0) return 0;

    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO human_input
        (message_id, claude_session_id, project_dir, text_length, word_count, message_timestamp, date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    let newCount = 0;
    const insertAll = db.transaction(() => {
      for (const entry of entries) {
        const date = localDateStr(new Date(entry.timestamp));
        const result = stmt.run(
          entry.messageId,
          claudeSessionId,
          projectDir,
          entry.textLength,
          entry.wordCount,
          entry.timestamp,
          date,
        );
        if (result.changes > 0) newCount++;
      }
    });
    insertAll();

    return newCount;
  }

  // --- Query methods ---

  getDailyInputStats(date?: string): DailyInputStats {
    const db = getDb();
    const targetDate = date ?? localDateStr(new Date());

    const row = db.prepare(`
      SELECT COUNT(*) as message_count,
             COALESCE(SUM(text_length), 0) as total_chars,
             COALESCE(SUM(word_count), 0) as total_words,
             COUNT(DISTINCT claude_session_id) as session_count
      FROM human_input
      WHERE date = ?
    `).get(targetDate) as DailyAggRow;

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

    return {
      date: targetDate,
      messageCount: row.message_count,
      totalCharacters: row.total_chars,
      totalWords: row.total_words,
      activeSessionCount: row.session_count,
      messagesPerCommit,
    };
  }

  getInputHeatmap(days = 7): InputHeatmapEntry[] {
    const db = getDb();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    const startDateStr = localDateStr(startDate);

    const rows = db.prepare(`
      SELECT date,
             COUNT(*) as message_count,
             COALESCE(SUM(text_length), 0) as total_chars
      FROM human_input
      WHERE date >= ?
      GROUP BY date
      ORDER BY date ASC
    `).all(startDateStr) as HeatmapRow[];

    const rowMap = new Map(rows.map((r) => [r.date, r]));

    // Fill missing days with zeros
    const result: InputHeatmapEntry[] = [];
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = localDateStr(d);
      const existing = rowMap.get(dateStr);
      result.push({
        date: dateStr,
        messageCount: existing?.message_count ?? 0,
        totalCharacters: existing?.total_chars ?? 0,
      });
    }

    return result;
  }

  getInputWeeklyTrend(): InputWeeklyTrend {
    const db = getDb();

    const thisWeekRow = db.prepare(`
      SELECT COUNT(*) as message_count,
             COALESCE(SUM(text_length), 0) as total_chars
      FROM human_input
      WHERE date >= date('now', 'localtime', 'weekday 0', '-6 days')
    `).get() as WeekRow;

    const lastWeekRow = db.prepare(`
      SELECT COUNT(*) as message_count,
             COALESCE(SUM(text_length), 0) as total_chars
      FROM human_input
      WHERE date >= date('now', 'localtime', 'weekday 0', '-13 days')
        AND date < date('now', 'localtime', 'weekday 0', '-6 days')
    `).get() as WeekRow;

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

  getInputCadence(date?: string): InputCadenceInfo {
    const db = getDb();
    const targetDate = date ?? localDateStr(new Date());

    // Peak interaction hour
    const hourRows = db.prepare(`
      SELECT strftime('%H', message_timestamp, 'localtime') as hour,
             COUNT(*) as cnt
      FROM human_input
      WHERE date = ?
      GROUP BY hour
      ORDER BY cnt DESC
    `).all(targetDate) as HourRow[];

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
             WHERE t.claude_session_id = h.claude_session_id
               AND t.message_timestamp < h.message_timestamp)
          )) * 86400 as think_seconds
        FROM human_input h
        WHERE h.date = ?
      ) WHERE think_seconds IS NOT NULL
        AND think_seconds > 0
        AND think_seconds < 3600
    `).all(targetDate) as ThinkTimeRow[];

    if (thinkRows.length > 0) {
      const total = thinkRows.reduce((acc, r) => acc + r.think_seconds, 0);
      avgThinkTimeMinutes = Math.round((total / thinkRows.length / 60) * 10) / 10;
    }

    // Leverage ratio: AI output tokens per human input character for this day
    let leverageRatio: number | null = null;
    const charRow = db.prepare(
      'SELECT COALESCE(SUM(text_length), 0) as chars FROM human_input WHERE date = ?',
    ).get(targetDate) as { chars: number };
    const tokenRow = db.prepare(
      'SELECT COALESCE(SUM(output_tokens), 0) as tokens FROM token_usage WHERE date = ?',
    ).get(targetDate) as { tokens: number };

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
  typedHandle('input:get-daily-stats', (date) => {
    return inputTracker.getDailyInputStats(date);
  });

  typedHandle('input:get-heatmap', (days) => {
    return inputTracker.getInputHeatmap(days);
  });

  typedHandle('input:get-weekly-trend', () => {
    return inputTracker.getInputWeeklyTrend();
  });

  typedHandle('input:get-cadence', (date) => {
    return inputTracker.getInputCadence(date);
  });
}
