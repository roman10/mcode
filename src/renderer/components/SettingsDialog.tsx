import { useEffect, useState } from 'react';

interface SettingsDialogProps {
  onClose(): void;
}

function SettingsDialog({ onClose }: SettingsDialogProps): React.JSX.Element {
  const [preventSleep, setPreventSleep] = useState(true);
  const [scanAllBranches, setScanAllBranches] = useState(false);

  useEffect(() => {
    window.mcode.preferences
      .getSleepStatus()
      .then((status) => setPreventSleep(status.enabled))
      .catch(() => {});
    window.mcode.preferences
      .get('commitScanAllBranches')
      .then((val) => setScanAllBranches(val === 'true'))
      .catch(() => {});
  }, []);

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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-bg-elevated border border-border-default rounded-lg p-6 w-[380px] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-text-primary text-lg font-medium mb-4">Settings</h2>

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

        {/* Actions */}
        <div className="flex justify-end mt-6">
          <button
            type="button"
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            onClick={onClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsDialog;
