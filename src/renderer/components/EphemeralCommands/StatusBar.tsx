import { useEffect, useState } from 'react';
import {
  useEphemeralCommandStore,
  type EphemeralCommand,
} from '../../stores/ephemeral-command-store';

const DISMISS_KEY = 'update-dismissed-version';

function StatusPill({ cmd }: { cmd: EphemeralCommand }): React.JSX.Element {
  const selectCommand = useEphemeralCommandStore((s) => s.selectCommand);
  const selectedCommandId = useEphemeralCommandStore((s) => s.selectedCommandId);
  const dismissCommand = useEphemeralCommandStore((s) => s.dismissCommand);
  const killCommand = useEphemeralCommandStore((s) => s.killCommand);
  const isSelected = selectedCommandId === cmd.id;

  const colorClass = cmd.status === 'error'
    ? 'text-red-400'
    : cmd.status === 'success'
      ? 'text-green-400'
      : isSelected
        ? 'text-accent'
        : 'text-text-secondary';

  return (
    <button
      type="button"
      className={`
        flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono
        transition-colors cursor-pointer shrink-0
        ${isSelected ? 'bg-accent/20' : 'hover:bg-bg-secondary'}
        ${colorClass}
      `}
      onClick={() => selectCommand(isSelected ? null : cmd.id)}
      title={`${cmd.command} (${cmd.repo})`}
    >
      {/* Status indicator */}
      {cmd.status === 'running' && (
        <span className="inline-block w-3 h-3 shrink-0">
          <svg className="animate-spin w-3 h-3" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" strokeLinecap="round" />
          </svg>
        </span>
      )}
      {cmd.status === 'success' && <span className="shrink-0">✓</span>}
      {cmd.status === 'error' && <span className="shrink-0">✗</span>}

      {/* Command name (truncated) */}
      <span className="truncate max-w-[200px]">{cmd.command}</span>

      {/* Repo badge */}
      <span className="shrink-0 text-xs text-text-muted px-1 rounded bg-bg-primary/50">
        {cmd.repo}
      </span>

      {/* Kill button for running commands */}
      {cmd.status === 'running' && (
        <button
          type="button"
          className="shrink-0 ml-0.5 text-text-muted hover:text-red-400"
          onClick={(e) => {
            e.stopPropagation();
            killCommand(cmd.id);
          }}
          title="Stop command"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <rect x="1" y="1" width="8" height="8" rx="1" />
          </svg>
        </button>
      )}
      {/* Dismiss button for completed commands */}
      {cmd.status !== 'running' && (
        <button
          type="button"
          className="shrink-0 ml-0.5 text-text-muted hover:text-text-primary"
          onClick={(e) => {
            e.stopPropagation();
            dismissCommand(cmd.id);
          }}
          title="Dismiss"
        >
          ×
        </button>
      )}
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
      {/* External link icon */}
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
      {/* Dismiss */}
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
  const commands = useEphemeralCommandStore((s) => s.commands);
  const clearCompleted = useEphemeralCommandStore((s) => s.clearCompleted);

  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(
    () => sessionStorage.getItem(DISMISS_KEY),
  );

  useEffect(() => {
    return window.mcode.app.onUpdateAvailable((info) => {
      setUpdateVersion(info.version);
    });
  }, []);

  const showUpdate =
    updateVersion !== null && updateVersion !== dismissedVersion;

  if (commands.length === 0 && !showUpdate) return null;

  const completedCount = commands.filter((c) => c.status !== 'running').length;

  return (
    <div className="h-6 shrink-0 flex items-center gap-1 px-2 bg-bg-secondary border-t border-border-subtle text-xs overflow-x-auto">
      {commands.map((cmd) => (
        <StatusPill key={cmd.id} cmd={cmd} />
      ))}
      {completedCount > 1 && (
        <button
          type="button"
          className="shrink-0 text-xs text-text-muted hover:text-text-secondary px-1"
          onClick={clearCompleted}
        >
          Clear all
        </button>
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
