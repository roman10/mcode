import { useEffect, useState } from 'react';
import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import Tooltip from '../shared/Tooltip';
import { formatKeys } from '../../utils/format-shortcut';

const DISMISS_KEY = 'update-dismissed-version';

type UpdateState =
  | { phase: 'idle' }
  | { phase: 'available'; version: string }
  | { phase: 'downloading'; version: string; percent: number }
  | { phase: 'ready'; version: string }
  | { phase: 'error'; version: string; message: string };

/** Inline SVG: downward arrow into tray (download icon) */
function DownloadIcon(): React.JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M6 1.5v7" />
      <path d="M3 6l3 3 3-3" />
      <path d="M1.5 10.5h9" />
    </svg>
  );
}

/** Inline SVG: circular arrow (restart icon) */
function RestartIcon(): React.JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M1.5 2v3h3" />
      <path d="M1.88 7.5a4.5 4.5 0 1 0 .87-4.5L1.5 5" />
    </svg>
  );
}

/** Inline SVG: external link icon */
function ExternalLinkIcon(): React.JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M4.5 1.5H2a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V7.5" />
      <path d="M7 1.5h3.5V5" />
      <path d="M5 7L10.5 1.5" />
    </svg>
  );
}

function DismissButton({ onDismiss }: { onDismiss: () => void }): React.JSX.Element {
  return (
    <Tooltip content="Dismiss" side="top">
      <span
        role="button"
        tabIndex={0}
        className="shrink-0 ml-0.5 text-text-muted hover:text-text-primary"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation();
            onDismiss();
          }
        }}
      >
        ×
      </span>
    </Tooltip>
  );
}

function UpdatePill({
  state,
  onDismiss,
}: {
  state: Exclude<UpdateState, { phase: 'idle' }>;
  onDismiss: () => void;
}): React.JSX.Element {
  switch (state.phase) {
    case 'available':
      return (
        <button
          type="button"
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono transition-colors cursor-pointer shrink-0 text-accent hover:bg-accent/20 ml-auto"
          onClick={() => window.mcode.app.downloadUpdate()}
        >
          <span>v{state.version} available</span>
          <DownloadIcon />
          <DismissButton onDismiss={onDismiss} />
        </button>
      );

    case 'downloading':
      return (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono shrink-0 text-text-secondary ml-auto">
          <span>Downloading {state.percent}%</span>
        </div>
      );

    case 'ready':
      return (
        <button
          type="button"
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono transition-colors cursor-pointer shrink-0 bg-accent/20 text-accent hover:bg-accent/30 ml-auto"
          onClick={() => window.mcode.app.installUpdate()}
        >
          <span>Restart to update</span>
          <RestartIcon />
        </button>
      );

    case 'error':
      return (
        <button
          type="button"
          className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono transition-colors cursor-pointer shrink-0 text-text-secondary hover:bg-bg-primary/50 ml-auto"
          onClick={() => window.mcode.app.openUpdatePage()}
        >
          <span>Update failed</span>
          <ExternalLinkIcon />
          <DismissButton onDismiss={onDismiss} />
        </button>
      );
  }
}

export default function StatusBar(): React.JSX.Element | null {
  const terminals = useTerminalPanelStore((s) => s.terminals);
  const panelVisible = useTerminalPanelStore((s) => s.panelVisible);
  const setPanelVisible = useTerminalPanelStore((s) => s.setPanelVisible);

  const [updateState, setUpdateState] = useState<UpdateState>({ phase: 'idle' });
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(
    () => sessionStorage.getItem(DISMISS_KEY),
  );

  useEffect(() => {
    const unsub1 = window.mcode.app.onUpdateAvailable((info) => {
      setUpdateState({ phase: 'available', version: info.version });
    });
    const unsub2 = window.mcode.app.onUpdateDownloadProgress((info) => {
      setUpdateState((prev) =>
        prev.phase === 'available' || prev.phase === 'downloading'
          ? { phase: 'downloading', version: prev.version, percent: info.percent }
          : prev,
      );
    });
    const unsub3 = window.mcode.app.onUpdateDownloaded((info) => {
      setUpdateState({ phase: 'ready', version: info.version });
    });
    const unsub4 = window.mcode.app.onUpdateError((info) => {
      setUpdateState((prev) => {
        if (prev.phase === 'idle') return prev;
        return { phase: 'error', version: prev.version, message: info.message };
      });
    });
    return () => { unsub1(); unsub2(); unsub3(); unsub4(); };
  }, []);

  const showUpdate =
    updateState.phase !== 'idle' &&
    !(
      (updateState.phase === 'available' || updateState.phase === 'error') &&
      updateState.version === dismissedVersion
    );

  const terminalCount = Object.keys(terminals).length;

  if (terminalCount === 0 && !showUpdate) return null;

  return (
    <div className="h-6 shrink-0 flex items-center gap-1 px-2 bg-bg-secondary border-t border-border-subtle text-xs overflow-x-auto">
      {terminalCount > 0 && !panelVisible && (
        <Tooltip content={`Toggle terminal panel (${formatKeys('Ctrl+`', false)})`} side="top">
          <button
            type="button"
            className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-bg-primary/50 cursor-pointer shrink-0"
            onClick={() => setPanelVisible(true)}
          >
            <span className="font-mono">&gt;_</span>
            <span>Terminal{terminalCount > 1 ? `s (${terminalCount})` : ''}</span>
          </button>
        </Tooltip>
      )}

      {showUpdate && (
        <UpdatePill
          state={updateState as Exclude<UpdateState, { phase: 'idle' }>}
          onDismiss={() => {
            if ('version' in updateState) {
              setDismissedVersion(updateState.version);
              sessionStorage.setItem(DISMISS_KEY, updateState.version);
            }
            setUpdateState({ phase: 'idle' });
          }}
        />
      )}
    </div>
  );
}
