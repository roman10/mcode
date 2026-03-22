import { useEffect, useRef, useState } from 'react';
import Dialog from '../shared/Dialog';
import type { AccountProfile, SessionCreateInput } from '../../../shared/types';
import { EFFORT_LEVELS, PERMISSION_MODES, type EffortLevel, type PermissionMode } from '../../../shared/constants';

const isMac = navigator.userAgent.includes('Mac');

interface NewSessionDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreate(input: SessionCreateInput): void;
}

function NewSessionDialog({
  open,
  onOpenChange,
  onCreate,
}: NewSessionDialogProps): React.JSX.Element {
  const [cwd, setCwd] = useState('');
  const [label, setLabel] = useState('');
  const [initialPrompt, setInitialPrompt] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode | ''>('');
  const [effort, setEffort] = useState<EffortLevel | ''>('');
  const [useWorktree, setUseWorktree] = useState(false);
  const [worktreeName, setWorktreeName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [accounts, setAccounts] = useState<AccountProfile[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  // Reset form and load defaults when dialog opens
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setLabel('');
      setInitialPrompt('');
      setUseWorktree(false);
      setWorktreeName('');
      setIsCreating(false);
      Promise.all([
        window.mcode.sessions.getLastDefaults(),
        window.mcode.accounts.list(),
      ]).then(([defaults, list]) => {
        setAccounts(list);
        const defaultAccount = list.find((a) => a.isDefault);
        const rememberedAccountId = defaults?.accountId;
        if (rememberedAccountId && list.some((a) => a.accountId === rememberedAccountId)) {
          setSelectedAccountId(rememberedAccountId);
        } else {
          setSelectedAccountId(defaultAccount?.accountId ?? '');
        }
        if (defaults) {
          setCwd(defaults.cwd);
          if (defaults.permissionMode) setPermissionMode(defaults.permissionMode);
          if (defaults.effort) setEffort(defaults.effort);
        }
      });
    }
    prevOpenRef.current = open;
  });

  const handleBrowse = async (): Promise<void> => {
    const dir = await window.mcode.app.selectDirectory();
    if (dir) setCwd(dir);
  };

  const handleSubmit = (e?: React.FormEvent): void => {
    e?.preventDefault();
    if (!cwd.trim() || isCreating) return;

    setIsCreating(true);
    const defaultAccount = accounts.find((a) => a.isDefault);
    const isDefaultSelected = !selectedAccountId || selectedAccountId === defaultAccount?.accountId;
    onCreate({
      cwd: cwd.trim(),
      label: label.trim() || undefined,
      initialPrompt: initialPrompt.trim() || undefined,
      permissionMode: permissionMode || undefined,
      effort: effort || undefined,
      worktree: useWorktree ? (worktreeName.trim() || '') : undefined,
      accountId: isDefaultSelected ? undefined : selectedAccountId,
    });
  };

  // Cmd+Enter to submit — use ref to avoid stale closure
  const handleSubmitRef = useRef(handleSubmit);
  handleSubmitRef.current = handleSubmit;

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent): void => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        handleSubmitRef.current();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      closeOnOverlayClick={false}
      title="New Session"
    >
      <form onSubmit={handleSubmit}>
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
              onChange={(e) => {
                const value = e.target.value;
                setPermissionMode(
                  value === '' || PERMISSION_MODES.includes(value as PermissionMode)
                    ? (value as PermissionMode | '')
                    : '',
                );
              }}
            >
              <option value="">default</option>
              {PERMISSION_MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </div>

          {/* Effort */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">
              Effort
            </label>
            <select
              className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none"
              value={effort}
              onChange={(e) => {
                const value = e.target.value;
                setEffort(
                  value === '' || EFFORT_LEVELS.includes(value as EffortLevel)
                    ? (value as EffortLevel | '')
                    : '',
                );
              }}
            >
              <option value="">default</option>
              {EFFORT_LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </div>

          {/* Account (only shown when multiple accounts exist) */}
          {accounts.length > 1 && (
            <div>
              <label className="block text-sm text-text-secondary mb-1">
                Account
              </label>
              <select
                className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none"
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
              >
                {accounts.map((account) => (
                  <option key={account.accountId} value={account.accountId}>
                    {account.name}{account.email ? ` (${account.email})` : ''}
                    {account.isDefault ? ' — default' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Worktree */}
          <div>
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                className="accent-accent"
                checked={useWorktree}
                onChange={(e) => {
                  setUseWorktree(e.target.checked);
                  if (!e.target.checked) setWorktreeName('');
                }}
              />
              Run in isolated worktree
            </label>
            {useWorktree && (
              <input
                className="w-full mt-2 bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none"
                value={worktreeName}
                onChange={(e) => setWorktreeName(e.target.value)}
                placeholder="Auto-generated if empty"
              />
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!cwd.trim() || isCreating}
            className="inline-flex items-center px-4 py-2 text-sm bg-accent text-white rounded hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
          >
            {isCreating ? 'Creating...' : (
              <>
                Create Session
                <kbd className="ml-2 text-xs opacity-70 font-mono">
                  {isMac ? '⌘↵' : 'Ctrl+↵'}
                </kbd>
              </>
            )}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default NewSessionDialog;
