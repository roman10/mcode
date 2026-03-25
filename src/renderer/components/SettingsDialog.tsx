import { useEffect, useState } from 'react';
import { useEditorStore } from '../stores/editor-store';
import { useLayoutStore } from '../stores/layout-store';
import Dialog from './shared/Dialog';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): React.JSX.Element {
  const [preventSleep, setPreventSleep] = useState(true);
  const [scanAllBranches, setScanAllBranches] = useState(false);
  const vimEnabled = useEditorStore((s) => s.vimEnabled);
  const setVimEnabled = useEditorStore((s) => s.setVimEnabled);
  const showActivityTab = useLayoutStore((s) => s.showActivityTab);
  const setShowActivityTab = useLayoutStore((s) => s.setShowActivityTab);

  useEffect(() => {
    if (!open) return;
    window.mcode.preferences
      .getSleepStatus()
      .then((status) => setPreventSleep(status.enabled))
      .catch(() => {});
    window.mcode.preferences
      .get('commitScanAllBranches')
      .then((val) => setScanAllBranches(val === 'true'))
      .catch(() => {});
  }, [open]);

  const handleToggle = (): void => {
    const newValue = !preventSleep;
    setPreventSleep(newValue);
    window.mcode.preferences.setPreventSleep(newValue).catch(() => {
      setPreventSleep(!newValue);
    });
  };

  const handleScanAllBranchesToggle = (): void => {
    const newValue = !scanAllBranches;
    setScanAllBranches(newValue);
    window.mcode.preferences
      .set('commitScanAllBranches', String(newValue))
      .then(() => window.mcode.commits.refresh())
      .catch(() => setScanAllBranches(!newValue));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Settings"
      width="w-[380px]"
    >
      {/* General */}
      <div>
        <h3 className="text-text-secondary text-xs font-medium uppercase tracking-wide mb-3">
          General
        </h3>

        <label className="flex items-center justify-between cursor-pointer group">
          <div className="flex-1 mr-3">
            <div className="text-sm text-text-primary">
              Prevent sleep while sessions are active
            </div>
            <div className="text-xs text-text-muted mt-0.5">
              Keeps your computer awake while Claude sessions are running. Screen dimming is
              unaffected.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={preventSleep}
            onClick={handleToggle}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
              preventSleep ? 'bg-accent' : 'bg-bg-primary'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                preventSleep ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </label>
      </div>

      {/* Commit Tracking */}
      <div className="mt-4">
        <h3 className="text-text-secondary text-xs font-medium uppercase tracking-wide mb-3">
          Commit Tracking
        </h3>

        <label className="flex items-center justify-between cursor-pointer group">
          <div className="flex-1 mr-3">
            <div className="text-sm text-text-primary">Scan all branches</div>
            <div className="text-xs text-text-muted mt-0.5">
              When off, only commits on the main branch are tracked. Turn on to include commits
              from all branches.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={scanAllBranches}
            onClick={handleScanAllBranchesToggle}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
              scanAllBranches ? 'bg-accent' : 'bg-bg-primary'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                scanAllBranches ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </label>
      </div>

      {/* Editor */}
      <div className="mt-4">
        <h3 className="text-text-secondary text-xs font-medium uppercase tracking-wide mb-3">
          Editor
        </h3>

        <label className="flex items-center justify-between cursor-pointer group">
          <div className="flex-1 mr-3">
            <div className="text-sm text-text-primary">Vim keybindings</div>
            <div className="text-xs text-text-muted mt-0.5">
              Enable vim keybindings in the file viewer with full editing support. Use :w to save
              and :q to close.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={vimEnabled}
            onClick={() => setVimEnabled(!vimEnabled)}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
              vimEnabled ? 'bg-accent' : 'bg-bg-primary'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                vimEnabled ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </label>
      </div>

      {/* Sidebar */}
      <div className="mt-4">
        <h3 className="text-text-secondary text-xs font-medium uppercase tracking-wide mb-3">
          Sidebar
        </h3>

        <label className="flex items-center justify-between cursor-pointer group">
          <div className="flex-1 mr-3">
            <div className="text-sm text-text-primary">Show Activity tab</div>
            <div className="text-xs text-text-muted mt-0.5">
              Display the Activity tab in the sidebar for viewing Claude Code hook events.
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={showActivityTab}
            onClick={() => setShowActivityTab(!showActivityTab)}
            className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
              showActivityTab ? 'bg-accent' : 'bg-bg-primary'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                showActivityTab ? 'translate-x-4' : 'translate-x-0'
              }`}
            />
          </button>
        </label>
      </div>

      {/* Actions */}
      <div className="flex justify-end mt-6">
        <button
          type="button"
          className="inline-flex items-center px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
          onClick={() => onOpenChange(false)}
        >
          Done
          <kbd className="ml-2 text-xs opacity-70 font-mono">Esc</kbd>
        </button>
      </div>
    </Dialog>
  );
}

export default SettingsDialog;
