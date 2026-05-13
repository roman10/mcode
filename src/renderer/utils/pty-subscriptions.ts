import type { PtyExitPayload } from '@shared/types';

type PtyDataListener = (data: string) => void;
type PtyExitListener = (payload: PtyExitPayload) => void;

const dataListeners = new Map<string, Set<PtyDataListener>>();
const exitListeners = new Map<string, Set<PtyExitListener>>();
let unsubscribeData: (() => void) | null = null;
let unsubscribeExit: (() => void) | null = null;

function listenerCount<T>(listeners: Map<string, Set<T>>): number {
  let count = 0;
  for (const set of listeners.values()) count += set.size;
  return count;
}

function ensureDataSubscription(): void {
  if (unsubscribeData) return;
  unsubscribeData = window.mcode.pty.onData((sessionId, data) => {
    const listeners = dataListeners.get(sessionId);
    if (!listeners) return;
    for (const listener of listeners) listener(data);
  });
}

function ensureExitSubscription(): void {
  if (unsubscribeExit) return;
  unsubscribeExit = window.mcode.pty.onExit((sessionId, payload) => {
    const listeners = exitListeners.get(sessionId);
    if (!listeners) return;
    for (const listener of listeners) listener(payload);
  });
}

function releaseDataSubscription(): void {
  if (listenerCount(dataListeners) > 0) return;
  unsubscribeData?.();
  unsubscribeData = null;
}

function releaseExitSubscription(): void {
  if (listenerCount(exitListeners) > 0) return;
  unsubscribeExit?.();
  unsubscribeExit = null;
}

export function subscribeToPtyData(sessionId: string, listener: PtyDataListener): () => void {
  ensureDataSubscription();
  const listeners = dataListeners.get(sessionId) ?? new Set<PtyDataListener>();
  listeners.add(listener);
  dataListeners.set(sessionId, listeners);

  return () => {
    const current = dataListeners.get(sessionId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) dataListeners.delete(sessionId);
    releaseDataSubscription();
  };
}

export function subscribeToPtyExit(sessionId: string, listener: PtyExitListener): () => void {
  ensureExitSubscription();
  const listeners = exitListeners.get(sessionId) ?? new Set<PtyExitListener>();
  listeners.add(listener);
  exitListeners.set(sessionId, listeners);

  return () => {
    const current = exitListeners.get(sessionId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) exitListeners.delete(sessionId);
    releaseExitSubscription();
  };
}
