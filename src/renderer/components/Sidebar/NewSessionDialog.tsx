import { useEffect, useRef, useState } from 'react';
import Dialog from '../shared/Dialog';
import { getAgentDefinition, type AgentSessionType } from '@shared/session-agents';
import type { AccountProfileWithProviders, SessionCreateInput } from '@shared/types';
import { AGENT_PERMISSION_MODES, DEFAULT_AGENT_PERMISSION_MODE, EFFORT_LEVELS, PERMISSION_MODE_LABELS, type EffortLevel, type PermissionMode } from '@shared/constants';

const isMac = navigator.userAgent.includes('Mac');

interface NewSessionDialogProps {
  open: boolean;
  initialSessionType?: AgentSessionType;
  onOpenChange(open: boolean): void;
  onCreate(input: SessionCreateInput): void;
}

function NewSessionDialog({
  open,
  initialSessionType,
  onOpenChange,
  onCreate,
}: NewSessionDialogProps): React.JSX.Element {
  const [sessionType, setSessionType] = useState<AgentSessionType>(initialSessionType ?? 'claude');
  const [cwd, setCwd] = useState('');
  const [label, setLabel] = useState('');
  const [permissionMode, setPermissionMode] = useState<PermissionMode | ''>('');
  const [effort, setEffort] = useState<EffortLevel | ''>('');
  const [enableAutoMode, setEnableAutoMode] = useState(false);
  const [useWorktree, setUseWorktree] = useState(false);
  const [worktreeName, setWorktreeName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [accounts, setAccounts] = useState<AccountProfileWithProviders[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const agentDefinition = getAgentDefinition(sessionType);
  const isClaude = agentDefinition?.dialogMode === 'full';
  const agentModes = AGENT_PERMISSION_MODES[sessionType] as readonly PermissionMode[] | undefined;

  // Reset form and load defaults when dialog opens
  const prevOpenRef = useRef(false);
  const justOpenedRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      justOpenedRef.current = true;
      setSessionType(initialSessionType ?? 'claude');
      setLabel('');
      setEnableAutoMode(false);
      setUseWorktree(false);
      setWorktreeName('');
      setIsCreating(false);
      const agentType = initialSessionType ?? 'claude';
      Promise.all([
        window.mcode.sessions.getLastDefaults(agentType),
        window.mcode.accounts.list(),
      ]).then(([defaults, list]) => {
        justOpenedRef.current = false;
        setAccounts(list);
        const defaultAccount = list.find((a) => a.isDefault);
        const rememberedAccountId = defaults?.accountId;
        if (rememberedAccountId && list.some((a) => a.accountId === rememberedAccountId)) {
          setSelectedAccountId(rememberedAccountId);
        } else {
          setSelectedAccountId(defaultAccount?.accountId ?? '');
        }
        const validModes = AGENT_PERMISSION_MODES[agentType];
        if (defaults) {
          setCwd(defaults.cwd);
          if (defaults.permissionMode && validModes?.includes(defaults.permissionMode as PermissionMode)) {
            setPermissionMode(defaults.permissionMode);
          } else {
            const fallback = DEFAULT_AGENT_PERMISSION_MODE[agentType];
            setPermissionMode(fallback && validModes?.includes(fallback) ? fallback : '');
          }
          if (defaults.effort) setEffort(defaults.effort);
          setEnableAutoMode(defaults.enableAutoMode === true);
        } else {
          const fallback = DEFAULT_AGENT_PERMISSION_MODE[agentType];
          setPermissionMode(fallback && validModes?.includes(fallback) ? fallback : '');
        }
      });
    }
    prevOpenRef.current = open;
  }, [open, initialSessionType]);

  // Re-fetch last-used defaults when switching agent types.
  // `open` is intentionally omitted: the dialog-open effect above handles the open→true transition.
  useEffect(() => {
    if (!open) return;
    if (justOpenedRef.current) {
      justOpenedRef.current = false;
      return; // Skip — dialog-open effect already loaded defaults for this agent
    }
    window.mcode.sessions.getLastDefaults(sessionType).then((defaults) => {
      const validModes = AGENT_PERMISSION_MODES[sessionType];
      if (defaults?.permissionMode && validModes?.includes(defaults.permissionMode as PermissionMode)) {
        setPermissionMode(defaults.permissionMode);
      } else {
        const fallback = DEFAULT_AGENT_PERMISSION_MODE[sessionType];
        setPermissionMode(fallback && validModes?.includes(fallback) ? fallback : '');
      }
      if (defaults?.cwd) setCwd(defaults.cwd);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionType]);

  const handleBrowse = async (): Promise<void> => {
    const dir = await window.mcode.app.selectDirectory();
    if (dir) setCwd(dir);
  };

  const handleSubmit = (e?: React.FormEvent): void => {
    e?.preventDefault();
    if (!cwd.trim() || isCreating) return;

    setIsCreating(true);

    // Compute accountId for any agent with account profile support
    const defaultAccount = accounts.find((a) => a.isDefault);
    const isDefaultSelected = !selectedAccountId || selectedAccountId === defaultAccount?.accountId;
    const accountId = agentDefinition?.supportsAccountProfiles && !isDefaultSelected
      ? selectedAccountId : undefined;

    if (isClaude) {
      onCreate({
        cwd: cwd.trim(),
        label: label.trim() || undefined,
        permissionMode: permissionMode || undefined,
        effort: effort || undefined,
        enableAutoMode: enableAutoMode,
        worktree: useWorktree ? (worktreeName.trim() || '') : undefined,
        accountId,
        sessionType: 'claude',
      });
    } else {
      onCreate({
        cwd: cwd.trim(),
        label: label.trim() || undefined,
        permissionMode: permissionMode || undefined,
        accountId,
        sessionType,
      });
    }
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
          {/* Agent type */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">
              Agent
            </label>
            <select
              className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none"
              value={sessionType}
              onChange={(e) => setSessionType(e.target.value as AgentSessionType)}
            >
              <option value="claude">Claude Code</option>
              <option value="codex">Codex CLI</option>
              <option value="gemini">Gemini CLI</option>
              <option value="copilot">Copilot CLI</option>
            </select>
          </div>

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

          {/* Permission mode — shown for any agent with permission modes */}
          {agentModes && agentModes.length > 0 && (
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
                    value === '' || agentModes.includes(value as PermissionMode)
                      ? (value as PermissionMode | '')
                      : '',
                  );
                }}
              >
                <option value="">default</option>
                {agentModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {PERMISSION_MODE_LABELS[mode] ?? mode}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Account — shown for any agent with account profile support */}
          {agentDefinition?.supportsAccountProfiles && accounts.length > 1 && (
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
                    {account.name}{account.providers?.[sessionType]?.identity ? ` (${account.providers[sessionType]!.identity})` : ''}
                    {account.isDefault ? ' — default' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Claude-specific fields */}
          {isClaude && (
            <>
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

              {/* Enable auto mode */}
              <div>
                <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={enableAutoMode}
                    onChange={(e) => setEnableAutoMode(e.target.checked)}
                  />
                  Enable auto mode (unlocks in Shift+Tab cycle)
                </label>
              </div>

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
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            className="inline-flex items-center px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            onClick={() => onOpenChange(false)}
          >
            Cancel
            <kbd className="ml-2 text-xs opacity-70 font-mono">Esc</kbd>
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
