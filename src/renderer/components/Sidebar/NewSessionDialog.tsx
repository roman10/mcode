import { useState } from 'react';
import type { SessionCreateInput } from '../../../shared/types';

interface NewSessionDialogProps {
  onClose(): void;
  onCreate(input: SessionCreateInput): void;
}

function NewSessionDialog({
  onClose,
  onCreate,
}: NewSessionDialogProps): React.JSX.Element {
  const [cwd, setCwd] = useState('');
  const [label, setLabel] = useState('');
  const [initialPrompt, setInitialPrompt] = useState('');
  const [permissionMode, setPermissionMode] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleBrowse = async (): Promise<void> => {
    const dir = await window.mcode.app.selectDirectory();
    if (dir) setCwd(dir);
  };

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!cwd.trim() || isCreating) return;

    setIsCreating(true);
    onCreate({
      cwd: cwd.trim(),
      label: label.trim() || undefined,
      initialPrompt: initialPrompt.trim() || undefined,
      permissionMode: permissionMode || undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <form
        className="bg-bg-elevated border border-border-default rounded-lg p-6 w-[420px] shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <h2 className="text-text-primary text-lg font-medium mb-4">
          New Session
        </h2>

        <div className="space-y-4">
          {/* Working directory */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">
              Working directory
            </label>
            <div className="flex gap-2">
              <input
                className="flex-1 bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
                autoFocus
              />
              <button
                type="button"
                className="px-3 py-2 text-sm bg-bg-secondary text-text-secondary border border-border-default rounded hover:bg-bg-elevated transition-colors"
                onClick={handleBrowse}
              >
                Browse
              </button>
            </div>
          </div>

          {/* Label */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">
              Label (optional)
            </label>
            <input
              className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My session"
            />
          </div>

          {/* Initial prompt */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">
              Initial prompt (optional)
            </label>
            <textarea
              className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none resize-none"
              rows={3}
              value={initialPrompt}
              onChange={(e) => setInitialPrompt(e.target.value)}
              placeholder="What should Claude work on?"
            />
          </div>

          {/* Permission mode */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">
              Permission mode
            </label>
            <select
              className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none"
              value={permissionMode}
              onChange={(e) => setPermissionMode(e.target.value)}
            >
              <option value="">default</option>
              <option value="plan">plan</option>
              <option value="autoEdit">autoEdit</option>
              <option value="fullAuto">fullAuto</option>
            </select>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!cwd.trim() || isCreating}
            className="px-4 py-2 text-sm bg-accent text-white rounded hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isCreating ? 'Creating...' : 'Create Session'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default NewSessionDialog;
