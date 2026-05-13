import { useSyncExternalStore } from 'react';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatShortTimeAt(isoString: string, nowMs: number): string {
  if (!isoString) return '';

  const then = new Date(isoString);
  if (isNaN(then.getTime())) return '';

  const hh = String(then.getHours()).padStart(2, '0');
  const mm = String(then.getMinutes()).padStart(2, '0');

  const diffSec = Math.floor((nowMs - then.getTime()) / 1000);

  if (diffSec < 0) return `${hh}:${mm}`;
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${hh}:${mm}`;
  return `${DAY_NAMES[then.getDay()]} ${hh}:${mm}`;
}

export function formatShortTime(isoString: string): string {
  return formatShortTimeAt(isoString, Date.now());
}

// Single shared 30s ticker so N consumers share one interval rather than N.
const subscribers = new Set<() => void>();
let intervalId: ReturnType<typeof setInterval> | null = null;
let tick = 0;

function subscribeTick(cb: () => void): () => void {
  subscribers.add(cb);
  if (intervalId === null) {
    intervalId = setInterval(() => {
      tick++;
      for (const fn of subscribers) fn();
    }, 30_000);
  }
  return () => {
    subscribers.delete(cb);
    if (subscribers.size === 0 && intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

function getTick(): number {
  return tick;
}

export function useRelativeTimeTick(): number {
  return useSyncExternalStore(subscribeTick, getTick, getTick);
}

export function useRelativeTime(isoString: string): string {
  // Re-render on each shared tick; format on render so the value tracks `isoString` too.
  useRelativeTimeTick();
  return formatShortTime(isoString);
}
