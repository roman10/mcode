import { useEffect, useState } from 'react';
import { useSessionStore } from '../../stores/session-store';
import type { HookEvent } from '../../../shared/types';
import { KNOWN_HOOK_EVENTS } from '../../../shared/constants';

const MAX_EVENTS = 200;

const EVENT_COLORS: Record<string, string> = {
  SessionStart: 'bg-green-800 text-green-200',
  SessionEnd: 'bg-gray-700 text-gray-300',
  PreToolUse: 'bg-blue-800 text-blue-200',
  PostToolUse: 'bg-blue-900 text-blue-300',
  PostToolUseFailure: 'bg-red-800 text-red-200',
  Stop: 'bg-amber-800 text-amber-200',
  PermissionRequest: 'bg-orange-800 text-orange-200',
  Notification: 'bg-purple-800 text-purple-200',
};

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function eventDetail(event: HookEvent): string {
  if (event.toolName) return event.toolName;
  if (event.hookEventName === 'Stop') return 'Turn ended';
  if (event.hookEventName === 'PermissionRequest') return 'Approval needed';
  if (event.hookEventName === 'SessionStart') return 'Started';
  if (event.hookEventName === 'SessionEnd') return 'Ended';
  if (event.hookEventName === 'Notification') return 'Notification';
  return '';
}

function ActivityFeed(): React.JSX.Element {
  const [events, setEvents] = useState<HookEvent[]>([]);
  const [sessionFilter, setSessionFilter] = useState<string>('');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('');

  const sessions = useSessionStore((s) => s.sessions);

  // Load historical events on mount
  useEffect(() => {
    window.mcode.hooks.getRecentAll(MAX_EVENTS).then((history) => {
      setEvents(history);
    }).catch(console.error);
  }, []);

  // Subscribe to live events
  useEffect(() => {
    const unsub = window.mcode.hooks.onEvent((event) => {
      setEvents((prev) => [event, ...prev].slice(0, MAX_EVENTS));
    });
    return unsub;
  }, []);

  // Build session options for filter
  const sessionOptions = Object.values(sessions)
    .filter((s) => !s.ephemeral)
    .map((s) => ({ id: s.sessionId, label: s.label }));

  // Apply filters
  const filtered = events.filter((e) => {
    if (sessionFilter && e.sessionId !== sessionFilter) return false;
    if (eventTypeFilter && e.hookEventName !== eventTypeFilter) return false;
    return true;
  });

  const hasFilters = sessionFilter || eventTypeFilter;

  return (
    <div className="flex flex-col h-full w-full bg-bg-primary">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default shrink-0">
        <span className="text-sm font-medium text-text-primary flex-1">Activity</span>

        <select
          className="text-xs bg-bg-elevated border border-border-default rounded px-1.5 py-0.5 text-text-secondary"
          value={sessionFilter}
          onChange={(e) => setSessionFilter(e.target.value)}
        >
          <option value="">All sessions</option>
          {sessionOptions.map((s) => (
            <option key={s.id} value={s.id}>{s.label}</option>
          ))}
        </select>

        <select
          className="text-xs bg-bg-elevated border border-border-default rounded px-1.5 py-0.5 text-text-secondary"
          value={eventTypeFilter}
          onChange={(e) => setEventTypeFilter(e.target.value)}
        >
          <option value="">All events</option>
          {KNOWN_HOOK_EVENTS.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>

        {hasFilters && (
          <button
            className="text-[10px] text-text-muted hover:text-text-secondary"
            onClick={() => { setSessionFilter(''); setEventTypeFilter(''); }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            {events.length === 0 ? 'No events yet' : 'No events match filters'}
          </div>
        ) : (
          filtered.map((event, i) => {
            const session = sessions[event.sessionId];
            const colorClass = EVENT_COLORS[event.hookEventName] ?? 'bg-gray-800 text-gray-300';

            return (
              <div
                key={`${event.createdAt}-${i}`}
                className="flex items-start gap-2 px-3 py-1.5 border-b border-border-default/50 hover:bg-bg-secondary/50"
              >
                {/* Timestamp */}
                <span className="text-[10px] text-text-muted w-12 shrink-0 pt-0.5 text-right">
                  {formatRelativeTime(event.createdAt)}
                </span>

                {/* Session label */}
                <span className="text-xs text-text-secondary truncate w-24 shrink-0 pt-0.5">
                  {session?.label ?? event.sessionId.slice(0, 8)}
                </span>

                {/* Event badge */}
                <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${colorClass}`}>
                  {event.hookEventName}
                </span>

                {/* Detail */}
                <span className="text-xs text-text-muted truncate flex-1 pt-0.5">
                  {eventDetail(event)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default ActivityFeed;
