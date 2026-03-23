import type { HmrEvent } from '@shared/types';

const MAX_EVENTS = 100;
const events: HmrEvent[] = [];

export function initHmrCapture(): void {
  const hot = import.meta.hot;
  if (!hot) return;

  for (const type of [
    'vite:beforeUpdate',
    'vite:afterUpdate',
    'vite:beforeFullReload',
    'vite:error',
  ] as const) {
    hot.on(type, () => {
      events.push({ type, timestamp: Date.now() });
      if (events.length > MAX_EVENTS) events.shift();
    });
  }
}

export function getHmrEvents(limit?: number): HmrEvent[] {
  if (limit && limit > 0) return events.slice(-limit);
  return [...events];
}
