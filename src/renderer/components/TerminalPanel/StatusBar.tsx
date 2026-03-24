import { useEffect, useState } from 'react';
import {
  useTerminalPanelStore,
  type TerminalEntry,
} from '../../stores/terminal-panel-store';

const DISMISS_KEY = 'update-dismissed-version';

/** Compact pill showing an ephemeral command's status in the status bar. */
function EphemeralPill({ entry }: { entry: TerminalEntry }): React.JSX.Element {
  const activateTerminal = useTerminalPanelStore((s) => s.activateTerminal);
  const setPanelVisible = useTerminalPanelStore((s) => s.setPanelVisible);

  const colorClass =
    entry.ephemeralStatus === 'error'
      ? 'text-red-400'
      : entry.ephemeralStatus === 'success'
        ? 'text-green-400'
        : 'text-text-secondary';

  return (
    <button
      type="button"
      className={`
        flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono
        transition-colors cursor-pointer shrink-0
        hover:bg-bg-secondary ${colorClass}
      `}
      onClick={() => {
        setPanelVisible(true);
        activateTerminal(entry.sessionId);
      }}
      title={`${entry.ephemeralCommand ?? entry.label} (${entry.repo})`}
    >
      {entry.ephemeralStatus === 'running' && (
        <span className="inline-block w-3 h-3 shrink-0">
          <svg className="animate-spin w-3 h-3" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
          </svg>
        </span>
      )}
      {entry.ephemeralStatus === 'success' && <span className="shrink-0">✓</span>}
      {entry.ephemeralStatus === 'error' && <span className="shrink-0">✗</span>}
      <span className="truncate max-w-[200px]">
        {entry.ephemeralCommand ?? entry.label}
      </span>
      <span className="shrink-0 text-xs text-text-muted px-1 rounded bg-bg-primary/50">
        {entry.repo}
      </span>
    </button>
  );
}

function UpdatePill({
  version,
  onDismiss,
}: {
  version: string;
  onDismiss: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono transition-colors cursor-pointer shrink-0 text-accent hover:bg-accent/20 ml-auto"
      onClick={() => window.mcode.app.openUpdatePage()}
      title={`Open download page for v${version}`}
    >
      <span>v{version} available</span>
      <svg
        width="10"
        height="10"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="shrink-0"
      >
        <path d="M4.5 1.5H2a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h8a.5.5 0 0 0 .5-.5V7.5" />
        <path d="M7 1.5h3.5V5" />
        <path d="M5 7L10.5 1.5" />
      </svg>
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
        title="Dismiss"
      >
        ×
      </span>
    </button>
  );
}

export default function StatusBar(): React.JSX.Element | null {
  const terminals = useTerminalPanelStore((s) => s.terminals);
  const panelVisible = useTerminalPanelStore((s) => s.panelVisible);
  const setPanelVisible = useTerminalPanelStore((s) => s.setPanelVisible);

  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(
    () => sessionStorage.getItem(DISMISS_KEY),
  );

  useEffect(() => {
    return window.mcode.app.onUpdateAvailable((info) => {
      setUpdateVersion(info.version);
    });
  }, []);

  const showUpdate = updateVersion !== null && updateVersion !== dismissedVersion;

  const terminalList = Object.values(terminals);
  const terminalCount = terminalList.length;
  const ephemeralEntries = terminalList.filter((t) => t.isEphemeral);

  // Show nothing if no terminals and no update
  if (terminalCount === 0 && !showUpdate) return null;

  return (
    <div className="h-6 shrink-0 flex items-center gap-1 px-2 bg-bg-secondary border-t border-border-subtle text-xs overflow-x-auto">
      {/* Terminal panel toggle (when collapsed) */}
      {terminalCount > 0 && !panelVisible && (
        <button
          type="button"
          className="flex items-center gap-1 px-2 py-0.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-bg-primary/50 cursor-pointer shrink-0"
          onClick={() => setPanelVisible(true)}
          title="Show terminal panel"
        >
          <span className="font-mono">&gt;_</span>
          <span>Terminal{terminalCount > 1 ? `s (${terminalCount})` : ''}</span>
        </button>
      )}

      {/* Ephemeral command pills (shown when panel is collapsed) */}
      {!panelVisible &&
        ephemeralEntries.map((entry) => (
          <EphemeralPill key={entry.sessionId} entry={entry} />
        ))}

      {showUpdate && (
        <UpdatePill
          version={updateVersion}
          onDismiss={() => {
            setDismissedVersion(updateVersion);
            sessionStorage.setItem(DISMISS_KEY, updateVersion);
          }}
        />
      )}
    </div>
  );
}
