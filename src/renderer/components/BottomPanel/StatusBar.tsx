import { useEffect, useState } from 'react';
import { useTerminalPanelStore } from '../../stores/terminal-panel-store';
import Tooltip from '../shared/Tooltip';
import { formatKeys } from '../../utils/format-shortcut';

const DISMISS_KEY = 'update-dismissed-version';

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

  const terminalCount = Object.keys(terminals).length;

  // Show nothing if no terminals and no update
  if (terminalCount === 0 && !showUpdate) return null;

  return (
    <div className="h-6 shrink-0 flex items-center gap-1 px-2 bg-bg-secondary border-t border-border-subtle text-xs overflow-x-auto">
      {/* Terminal panel toggle (when collapsed) */}
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
