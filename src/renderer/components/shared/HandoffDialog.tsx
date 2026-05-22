import { useEffect, useState } from 'react';
import { getLeaves } from 'react-mosaic-component';
import Dialog from './Dialog';
import { useSessionStore } from '../../stores/session-store';
import { useLayoutStore } from '../../stores/layout-store';
import { sessionIdFromTileId } from '../../utils/tile-id';
import { AGENT_SESSION_TYPES, getAgentDefinition, type AgentSessionType } from '@shared/session-agents';
import type { SessionInfo } from '@shared/types';

const isMac = navigator.userAgent.includes('Mac');

const ALL_AGENT_CLIS: { value: AgentSessionType; label: string }[] =
  AGENT_SESSION_TYPES.map((value) => ({ value, label: getAgentDefinition(value)!.displayName }));

interface HandoffDialogProps {
  open: boolean;
  /** Source session being handed off. Dialog destination picker omits this CLI. */
  sourceSession: SessionInfo | null;
  onOpenChange(open: boolean): void;
}

function HandoffDialog({ open, sourceSession, onOpenChange }: HandoffDialogProps): React.JSX.Element | null {
  const sourceCli = sourceSession?.sessionType as AgentSessionType | undefined;
  const candidates = ALL_AGENT_CLIS.filter((c) => c.value !== sourceCli);

  const [targetCli, setTargetCli] = useState<AgentSessionType>(candidates[0]?.value ?? 'codex');
  // Derive the radio's selected value from candidates so a stale state (e.g. user
  // previously picked Gemini, then reopens the dialog with a Gemini source) can't
  // leave no radio selected for one render or submit a same-CLI target.
  const effectiveTarget: AgentSessionType =
    candidates.find((c) => c.value === targetCli)?.value ?? candidates[0]?.value ?? 'codex';
  const [mode, setMode] = useState<'compacted' | 'full'>('compacted');
  const [busy, setBusy] = useState<'idle' | 'previewing' | 'forking'>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  const [previewCli, setPreviewCli] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reset state each time the dialog opens for a (possibly different) source.
  useEffect(() => {
    if (!open) return;
    setTargetCli(candidates[0]?.value ?? 'codex');
    setMode('compacted');
    setBusy('idle');
    setPreview(null);
    setPreviewCli(null);
    setError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only on open / source change
  }, [open, sourceSession?.sessionId]);

  const handlePreview = async (): Promise<void> => {
    if (!sourceSession || busy !== 'idle') return;
    setBusy('previewing');
    setError(null);
    try {
      const result = await window.mcode.sessions.forkPreview(sourceSession.sessionId);
      setPreview(result.summary);
      setPreviewCli(result.usedCli);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy('idle');
    }
  };

  const handleConfirm = async (): Promise<void> => {
    if (!sourceSession || busy !== 'idle') return;
    setBusy('forking');
    setError(null);
    try {
      const newSession = await window.mcode.sessions.fork(
        sourceSession.sessionId,
        effectiveTarget,
        mode,
      );
      // useSessionSubscriptions.onCreated also fires for the new session and adds
      // a tile + addSession. Both of these are idempotent. The only thing we own
      // here is the source-tile decision: if the source was ended and occupied a
      // tile, drop that tile so the fork visually takes over its slot. For a
      // *running* source we leave its tile in place — the user explicitly forked
      // pre-emptively and likely wants both sessions visible.
      useSessionStore.getState().addSession(newSession);
      const layout = useLayoutStore.getState();
      const leaves = layout.mosaicTree
        ? getLeaves(layout.mosaicTree).map(sessionIdFromTileId)
        : [];
      const sourceHadTile = leaves.includes(sourceSession.sessionId);
      const newAlreadyTiled = leaves.includes(newSession.sessionId);

      if (sourceHadTile && sourceSession.status === 'ended') {
        if (newAlreadyTiled) {
          // Listener already added the new tile; remove the ended source.
          layout.removeTile(sourceSession.sessionId);
        } else {
          // Listener hasn't run yet — swap in place to preserve position.
          layout.replaceTile(sourceSession.sessionId, newSession.sessionId);
        }
      } else if (!newAlreadyTiled) {
        // Running-source path or no source tile: ensure the fork is tiled.
        // No-op when the listener already added it.
        layout.addTile(newSession.sessionId);
      }
      layout.persist();
      layout.focusTile(`session:${newSession.sessionId}`);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy('idle');
    }
  };

  // Cmd/Ctrl+Enter to confirm
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- handleConfirm captures latest via closure each render
  }, [open, effectiveTarget, mode, sourceSession?.sessionId, busy]);

  if (!sourceSession) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o && busy === 'forking') return; onOpenChange(o); }}
      closeOnOverlayClick={busy !== 'forking'}
      title="Continue in another CLI"
      description={`Hand off the conversation from ${sourceCli ?? 'this session'} to a different CLI.`}
      width="w-[520px]"
    >
      <div className="space-y-5">
        {/* Destination */}
        <div>
          <div className="text-sm text-text-secondary mb-2">Destination</div>
          <div className="flex flex-wrap gap-2">
            {candidates.map((c) => (
              <button
                key={c.value}
                type="button"
                className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                  effectiveTarget === c.value
                    ? 'bg-accent text-white border-accent'
                    : 'bg-bg-primary text-text-primary border-border-default hover:bg-bg-elevated'
                }`}
                onClick={() => setTargetCli(c.value)}
                disabled={busy !== 'idle'}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Context mode */}
        <div>
          <div className="text-sm text-text-secondary mb-2">Context</div>
          <label className="flex items-start gap-2 text-sm text-text-primary cursor-pointer mb-2">
            <input
              type="radio"
              className="mt-0.5 accent-accent"
              checked={mode === 'compacted'}
              onChange={() => setMode('compacted')}
              disabled={busy !== 'idle'}
            />
            <span>
              <span className="block">Compacted summary <span className="text-text-muted">(recommended)</span></span>
              <span className="block text-xs text-text-muted">
                A short handoff summary is generated from the prior conversation and sent as the first prompt.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-text-primary cursor-pointer">
            <input
              type="radio"
              className="mt-0.5 accent-accent"
              checked={mode === 'full'}
              onChange={() => setMode('full')}
              disabled={busy !== 'idle'}
            />
            <span>
              <span className="block">Full transcript</span>
              <span className="block text-xs text-text-muted">
                The entire prior conversation is sent verbatim. Higher fidelity, more tokens.
              </span>
            </span>
          </label>
        </div>

        {/* Preview */}
        {mode === 'compacted' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-text-secondary">Summary preview</div>
              <button
                type="button"
                className="text-xs text-accent hover:underline disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={handlePreview}
                disabled={busy !== 'idle'}
              >
                {busy === 'previewing' ? 'Generating…' : preview ? 'Regenerate' : 'Generate preview'}
              </button>
            </div>
            {preview ? (
              <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-border-default bg-bg-primary p-2 text-xs text-text-primary">
                {preview}
                {previewCli && (
                  <div className="mt-2 text-text-muted">— produced via {previewCli}</div>
                )}
              </div>
            ) : (
              <div className="text-xs text-text-muted">
                Click &ldquo;Generate preview&rdquo; to see the summary before handing off.
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="text-xs text-red-400">{error}</div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-3 mt-6">
        <button
          type="button"
          className="inline-flex items-center px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          onClick={() => onOpenChange(false)}
          disabled={busy === 'forking'}
        >
          Cancel
          <kbd className="ml-2 text-xs opacity-70 font-mono">Esc</kbd>
        </button>
        <button
          type="button"
          disabled={busy !== 'idle'}
          className="inline-flex items-center px-4 py-2 text-sm bg-accent text-white rounded hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
          onClick={handleConfirm}
        >
          {busy === 'forking' ? 'Handing off…' : (
            <>
              Continue
              <kbd className="ml-2 text-xs opacity-70 font-mono">
                {isMac ? '⌘↵' : 'Ctrl+↵'}
              </kbd>
            </>
          )}
        </button>
      </div>
    </Dialog>
  );
}

export default HandoffDialog;
