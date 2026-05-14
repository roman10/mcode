import type { SessionManager } from '../session/session-manager';
import type { ExternalSessionInfo } from '../../shared/types';
import { typedHandle } from '../ipc-helpers';

export function registerSessionIpc(sessionManager: SessionManager): void {
  typedHandle('session:create', (input) => {
    return sessionManager.create(input);
  });

  typedHandle('session:list', () => {
    return sessionManager.list();
  });

  typedHandle('session:get', (sessionId) => {
    return sessionManager.get(sessionId);
  });

  typedHandle('session:kill', (sessionId) => {
    return sessionManager.kill(sessionId);
  });

  typedHandle('session:delete', (sessionId) => {
    sessionManager.delete(sessionId);
  });

  typedHandle('session:delete-all-ended', () => {
    return sessionManager.deleteAllEnded();
  });

  typedHandle('session:delete-batch', (sessionIds) => {
    return sessionManager.deleteBatch(sessionIds);
  });

  typedHandle('session:get-last-defaults', (sessionType) => {
    return sessionManager.getLastDefaults(sessionType);
  });

  typedHandle('session:set-label', (sessionId, label) => {
    sessionManager.setLabel(sessionId, label);
  });

  typedHandle('session:set-auto-label', (sessionId, label) => {
    sessionManager.setAutoLabel(sessionId, label);
  });

  typedHandle('session:set-auto-close', (sessionId, value) => {
    sessionManager.setAutoClose(sessionId, value);
  });

  typedHandle('session:set-terminal-config', (sessionId, config) => {
    sessionManager.setTerminalConfig(sessionId, config);
  });

  typedHandle('session:clear-attention', (sessionId) => {
    sessionManager.clearAttention(sessionId);
  });

  typedHandle('session:clear-all-attention', () => {
    sessionManager.clearAllAttention();
  });

  typedHandle('session:resume', ({ sessionId, accountId }) => {
    return sessionManager.resume(sessionId, accountId);
  });

  typedHandle('session:fork', ({ sessionId, targetCli, mode }) => {
    return sessionManager.forkSession(sessionId, targetCli, mode);
  });

  typedHandle('session:fork-preview', ({ sessionId }) => {
    return sessionManager.previewHandoff(sessionId);
  });

  typedHandle('session:list-external', async (limit) => {
    const cap = limit ?? 50;
    const cwds = new Set(sessionManager.getDistinctClaudeCwds());
    if (cwds.size === 0) cwds.add(process.cwd());

    const all: ExternalSessionInfo[] = [];
    for (const cwd of cwds) {
      const results = await sessionManager.listExternalSessions(cwd, cap);
      all.push(...results);
    }
    all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return all.slice(0, cap);
  });

  typedHandle('session:import-external', (claudeSessionId, cwd, label) => {
    return sessionManager.importExternal(claudeSessionId, cwd, label);
  });
}
