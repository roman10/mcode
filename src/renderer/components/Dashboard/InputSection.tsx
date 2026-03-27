import HeatmapGrid from '../shared/HeatmapGrid';
import SectionDivider from './SectionDivider';
import { formatNumber, formatHour } from './stats-helpers';
import type { DailyInputStats, InputHeatmapEntry, InputWeeklyTrend, InputCadenceInfo } from '@shared/types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function inputLevel(entry: InputHeatmapEntry): number {
  if (entry.messageCount >= 200) return 4;
  if (entry.messageCount >= 100) return 3;
  if (entry.messageCount >= 30) return 2;
  if (entry.messageCount > 0) return 1;
  return 0;
}

function inputTooltip(entry: InputHeatmapEntry): string {
  return `${entry.date}: ${entry.messageCount} msg${entry.messageCount !== 1 ? 's' : ''} · ${formatNumber(entry.totalCharacters)} chars`;
}

function formatThinkTime(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  return `${minutes}m`;
}

// ─── Component ──────────────────────────────────────────────────────────────

interface InputSectionProps {
  collapsed: boolean;
  onToggle: () => void;
  dailyInputStats: DailyInputStats | null;
  inputHeatmap: InputHeatmapEntry[];
  inputWeeklyTrend: InputWeeklyTrend | null;
  inputCadence: InputCadenceInfo | null;
  viewDate: string;
  onHeatmapSelect: (date: string) => void;
  dateLabel: string;
}

function InputSection({
  collapsed,
  onToggle,
  dailyInputStats,
  inputHeatmap,
  inputWeeklyTrend,
  inputCadence,
  viewDate,
  onHeatmapSelect,
  dateLabel,
}: InputSectionProps): React.JSX.Element {
  const inputMsgCount = dailyInputStats?.messageCount ?? 0;
  const inputChars = dailyInputStats?.totalCharacters ?? 0;
  const inputWords = dailyInputStats?.totalWords ?? 0;
  const inputSessions = dailyInputStats?.activeSessionCount ?? 0;
  const msgsPerCommit = dailyInputStats?.messagesPerCommit;

  return (
    <>
      <SectionDivider
        label="Human Input"
        collapsed={collapsed}
        onToggle={onToggle}
        summary={`${inputMsgCount} msg${inputMsgCount !== 1 ? 's' : ''} · ${inputSessions} session${inputSessions !== 1 ? 's' : ''}`}
      />

      {!collapsed && (
        <>
          {/* Headline */}
          <div className="flex items-baseline justify-between">
            <div>
              <span className="text-2xl font-semibold text-text-primary">{inputMsgCount}</span>
              <span className="text-sm text-text-secondary ml-1.5">message{inputMsgCount !== 1 ? 's' : ''}</span>
              {inputSessions > 0 && (
                <span className="text-sm text-text-muted ml-1">
                  · {inputSessions} session{inputSessions !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {msgsPerCommit != null && (
              <span className="text-xs text-blue-400 font-medium">{msgsPerCommit} msgs/commit</span>
            )}
          </div>

          {/* Character / word count */}
          {inputMsgCount > 0 && (
            <div className="text-xs text-text-muted">
              {formatNumber(inputChars)} characters · {formatNumber(inputWords)} words
            </div>
          )}

          {/* Input heatmap */}
          {inputHeatmap.length > 0 && (
            <HeatmapGrid
              entries={inputHeatmap}
              getLevel={inputLevel}
              getTooltip={inputTooltip}
              selectedDate={viewDate}
              onSelect={onHeatmapSelect}
              colorScale="blue"
            />
          )}

          {/* Cadence & trend */}
          {(inputCadence?.avgThinkTimeMinutes != null || inputCadence?.leverageRatio != null || inputCadence?.peakHour != null) && (
            <div className="text-xs text-text-muted space-y-0.5">
              {inputCadence.avgThinkTimeMinutes != null && (
                <div>
                  Think time: {formatThinkTime(inputCadence.avgThinkTimeMinutes)} avg
                  {inputCadence.leverageRatio != null && <span> · Leverage: {inputCadence.leverageRatio}x</span>}
                </div>
              )}
              {inputCadence.peakHour != null && <div>Peak: {formatHour(inputCadence.peakHour)}</div>}
            </div>
          )}

          {/* Weekly trend */}
          {inputWeeklyTrend && (
            <div className="text-xs text-text-muted">
              This week: {inputWeeklyTrend.thisWeek.messageCount} messages
              {inputWeeklyTrend.pctChange != null && (
                <span className={inputWeeklyTrend.pctChange >= 0 ? 'text-blue-400' : 'text-text-muted'}>
                  {' '}
                  ({inputWeeklyTrend.pctChange >= 0 ? '+' : ''}
                  {inputWeeklyTrend.pctChange}% vs last week)
                </span>
              )}
            </div>
          )}

          {inputMsgCount === 0 && (
            <div className="text-sm text-text-muted text-center py-2">No human messages {dateLabel}</div>
          )}
        </>
      )}
    </>
  );
}

export default InputSection;
