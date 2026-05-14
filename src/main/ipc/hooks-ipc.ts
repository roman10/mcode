import { typedHandle } from '../ipc-helpers';
import type { SessionManager } from '../session/session-manager';
import type { HookRuntimeInfo } from '../../shared/types';

export function registerHookIpc(
  sessionManager: SessionManager,
  getHookRuntimeInfo: () => HookRuntimeInfo,
): void {
  typedHandle('hooks:get-runtime', () => {
    return getHookRuntimeInfo();
  });

  typedHandle('hooks:get-recent', (sessionId, limit) => {
    return sessionManager.getRecentEvents(sessionId, limit ?? 50);
  });

  typedHandle('hooks:get-recent-all', (limit) => {
    return sessionManager.getRecentAllEvents(limit ?? 200);
  });

  typedHandle('hooks:clear-all', () => {
    sessionManager.clearAllEvents();
  });
}
