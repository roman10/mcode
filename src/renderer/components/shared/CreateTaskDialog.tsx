import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '../../stores/session-store';
import { formatShortTime } from '../../hooks/useRelativeTime';
import { useTextInsertTarget } from '../../hooks/useTextInsertTarget';
import Dialog from './Dialog';
import SlashCommandAutocomplete from './SlashCommandAutocomplete';
import FileAutocomplete from './FileAutocomplete';
import { buildModeCycle, TASK_PERMISSION_MODE_LABELS } from '@shared/task-utils';
import { canSessionBeTaskTarget, canSessionBePlanResponseTarget } from '@shared/session-capabilities';
import { getAgentDefinition } from '@shared/session-agents';
import type { CreateTaskInput, TaskPermissionMode, PlanModeActionType } from '@shared/types';

const isMac = navigator.userAgent.includes('Mac');

type TaskType = 'prompt' | 'planResponse';

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreate(input: CreateTaskInput): void;
  defaultTargetSessionId?: string;
  defaultCwd?: string;
  defaultTaskType?: TaskType;
}

function CreateTaskDialog({
  open,
  onOpenChange,
  onCreate,
  defaultTargetSessionId,
  defaultCwd,
  defaultTaskType,
}: CreateTaskDialogProps): React.JSX.Element {
  const [taskType, setTaskType] = useState<TaskType>(defaultTaskType ?? 'prompt');
  const [prompt, setPrompt] = useState('');
  const [cwd, setCwd] = useState(defaultCwd ?? '');
  const [targetSessionId, setTargetSessionId] = useState(defaultTargetSessionId ?? '');
  const [permissionMode, setPermissionMode] = useState<TaskPermissionMode | ''>('');
  const [planAction, setPlanAction] = useState<PlanModeActionType>('auto-accept');
  const [isCreating, setIsCreating] = useState(false);
  const [cursorPos, setCursorPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useTextInsertTarget(open, textareaRef, setPrompt, setCursorPos);

  const sessions = useSessionStore((s) => s.sessions);

  // Valid targets depend on task type
  const targetableSessions = useMemo(
    () => Object.values(sessions).filter(
      (s) => taskType === 'planResponse' ? canSessionBePlanResponseTarget(s) : canSessionBeTaskTarget(s),
    ),
    [sessions, taskType],
  );

  // Show plan mode toggle whenever any session can receive a plan response,
  // independent of the currently selected session. The toggle changes which
  // sessions appear in the dropdown, so it must not depend on the selection.
  const anyPlanModeTargets = useMemo(
    () => Object.values(sessions).some((s) => canSessionBePlanResponseTarget(s)),
    [sessions],
  );

  // Available permission modes based on selected target session
  const selectedSession = targetSessionId ? sessions[targetSessionId] : undefined;
  const selectedAgentDef = getAgentDefinition(selectedSession?.sessionType);
  const selectedAgentName = selectedAgentDef?.displayName ?? 'Claude Code';
  const supportsPlanMode = selectedAgentDef?.supportsPlanMode ?? false;
  const slashSessionType = selectedSession?.sessionType === 'terminal'
    ? 'claude'
    : selectedSession?.sessionType ?? 'claude';
  const availableModes = useMemo(
    () => (selectedSession ? buildModeCycle(selectedSession) : []),
    [selectedSession],
  );

  // Reset permissionMode when target session changes and current selection is unavailable
  useEffect(() => {
    if (permissionMode && availableModes.length > 0 && !availableModes.includes(permissionMode)) {
      setPermissionMode('');
    }
  }, [availableModes, permissionMode]);

  // When target session changes and doesn't support plan mode, reset taskType
  useEffect(() => {
    if (taskType === 'planResponse' && targetSessionId && !supportsPlanMode) {
      setTaskType('prompt');
    }
  }, [taskType, targetSessionId, supportsPlanMode]);

  // Clear target if it's no longer in the filtered list (e.g., switching task type)
  useEffect(() => {
    if (targetSessionId && !defaultTargetSessionId && !targetableSessions.some((s) => s.sessionId === targetSessionId)) {
      setTargetSessionId('');
    }
  }, [targetSessionId, defaultTargetSessionId, targetableSessions]);

  // Reset form and load defaults when dialog opens
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setTaskType(defaultTaskType ?? 'prompt');
      setPrompt('');
      setCwd(defaultCwd ?? '');
      setTargetSessionId(defaultTargetSessionId ?? '');
      setPermissionMode('');
      setPlanAction('auto-accept');
      setIsCreating(false);
      setCursorPos(0);
      if (!defaultCwd) {
        window.mcode.sessions.getLastDefaults().then((defaults) => {
          if (!defaults) return;
          setCwd(defaults.cwd);
        });
      }
    }
    prevOpenRef.current = open;
  }, [open, defaultCwd, defaultTargetSessionId, defaultTaskType]);

  // In plan response mode, lock CWD to target session's cwd
  useEffect(() => {
    if (taskType === 'planResponse' && selectedSession?.cwd) {
      setCwd(selectedSession.cwd);
    }
  }, [taskType, selectedSession?.cwd]);

  const handleBrowse = async (): Promise<void> => {
    const dir = await window.mcode.app.selectDirectory();
    if (dir) setCwd(dir);
  };

  const isPlanResponse = taskType === 'planResponse';
  const needsPrompt = !isPlanResponse || planAction === 'revise';

  const handleSubmit = (e?: React.FormEvent): void => {
    e?.preventDefault();
    if ((needsPrompt && !prompt.trim()) || !cwd.trim() || !targetSessionId || isCreating) return;

    const finalPrompt = needsPrompt ? prompt.trim() : 'Proceed';

    setIsCreating(true);
    onCreate({
      prompt: finalPrompt,
      cwd: cwd.trim(),
      targetSessionId,
      ...(taskType === 'prompt' && permissionMode ? { permissionMode } : {}),
      ...(taskType === 'planResponse' ? { planModeAction: { action: planAction } } : {}),
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
      title={isPlanResponse ? 'Queue Plan Mode Response' : 'New Task'}
    >
      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          {/* Target session — placed first so task type toggle can react to it */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">
              Target session
            </label>
            <select
              className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none disabled:opacity-60"
              value={targetSessionId}
              onChange={(e) => setTargetSessionId(e.target.value)}
              disabled={!!defaultTargetSessionId}
            >
              <option value="" disabled>Select a session...</option>
              {targetableSessions.map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  {s.label || s.sessionId.slice(0, 8)} — {s.status} · {formatShortTime(s.startedAt)}
                </option>
              ))}
            </select>
          </div>

          {/* Task type toggle — shown when any session can receive a plan response */}
          {anyPlanModeTargets && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTaskType('prompt')}
                className={`flex-1 py-2 text-sm rounded border transition-colors ${
                  !isPlanResponse
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border-default text-text-secondary hover:bg-bg-elevated'
                }`}
              >
                New prompt
              </button>
              <button
                type="button"
                onClick={() => setTaskType('planResponse')}
                className={`flex-1 py-2 text-sm rounded border transition-colors ${
                  isPlanResponse
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border-default text-text-secondary hover:bg-bg-elevated'
                }`}
              >
                Plan Mode response
              </button>
            </div>
          )}

          {/* Plan action radio list — only in plan response mode */}
          {isPlanResponse && (
            <div className="space-y-1">
              {([
                {
                  value: 'auto-accept' as const,
                  label: 'Yes, auto-accept edits',
                  active: 'border-green-500 bg-green-500/10 text-green-400',
                  radio: 'border-green-500',
                  dot: 'bg-green-500',
                },
                {
                  value: 'manual-approve' as const,
                  label: 'Yes, manually approve edits',
                  active: 'border-blue-500 bg-blue-500/10 text-blue-400',
                  radio: 'border-blue-500',
                  dot: 'bg-blue-500',
                },
                {
                  value: 'revise' as const,
                  label: 'Tell Claude what to change',
                  active: 'border-amber-500 bg-amber-500/10 text-amber-400',
                  radio: 'border-amber-500',
                  dot: 'bg-amber-500',
                },
              ]).map(({ value, label, active, radio, dot }) => (
                <label
                  key={value}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded border cursor-pointer transition-colors ${
                    planAction === value
                      ? active
                      : 'border-transparent text-text-secondary hover:bg-bg-elevated'
                  }`}
                  onClick={() => setPlanAction(value)}
                >
                  <span className={`shrink-0 w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                    planAction === value ? radio : 'border-text-muted'
                  }`}>
                    {planAction === value && (
                      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                    )}
                  </span>
                  <span className="text-sm">{label}</span>
                </label>
              ))}
            </div>
          )}

          {/* Prompt — hidden for non-revise plan actions */}
          {(!isPlanResponse || planAction === 'revise') && (
            <div>
              <label className="block text-sm text-text-secondary mb-1">
                {isPlanResponse ? 'Tell Claude what to change' : 'Prompt'}
              </label>
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none resize-none"
                  rows={isPlanResponse ? 3 : 4}
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value);
                    setCursorPos(e.target.selectionStart ?? 0);
                  }}
                  onClick={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                  onKeyUp={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                  placeholder={isPlanResponse ? 'what should be changed in the plan' : `What should ${selectedAgentName} work on?`}
                  autoFocus={!!defaultTargetSessionId}
                />
                <SlashCommandAutocomplete
                  prompt={prompt}
                  cwd={cwd}
                  sessionType={slashSessionType}
                  textareaRef={textareaRef}
                  onSelect={(text) => { setPrompt(text); setCursorPos(text.length); }}
                />
                <FileAutocomplete
                  text={prompt}
                  cursorPos={cursorPos}
                  cwd={cwd}
                  textareaRef={textareaRef}
                  onSelect={(newText, newPos) => {
                    setPrompt(newText);
                    setCursorPos(newPos);
                    requestAnimationFrame(() => {
                      const ta = textareaRef.current;
                      if (ta) { ta.selectionStart = newPos; ta.selectionEnd = newPos; }
                    });
                  }}
                />
              </div>
            </div>
          )}

          {/* Working directory */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">
              Working directory
            </label>
            <div className="flex gap-2">
              <input
                className="flex-1 bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none disabled:opacity-60"
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="/path/to/project"
                disabled={isPlanResponse}
              />
              {!isPlanResponse && (
                <button
                  type="button"
                  className="px-3 py-2 text-sm bg-bg-secondary text-text-secondary border border-border-default rounded hover:bg-bg-elevated transition-colors"
                  onClick={handleBrowse}
                >
                  Browse
                </button>
              )}
            </div>
          </div>

          {/* Permission mode — hidden in plan response mode */}
          {!isPlanResponse && (
            <div>
              <label className="block text-sm text-text-secondary mb-1">
                Permission mode
              </label>
              <select
                className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none disabled:opacity-60"
                value={permissionMode}
                onChange={(e) => setPermissionMode(e.target.value as TaskPermissionMode | '')}
                disabled={!targetSessionId}
              >
                <option value="">Don&apos;t change</option>
                {availableModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {TASK_PERMISSION_MODE_LABELS[mode as TaskPermissionMode] ?? mode}
                  </option>
                ))}
              </select>
            </div>
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
            disabled={(needsPrompt && !prompt.trim()) || !cwd.trim() || !targetSessionId || isCreating}
            className="inline-flex items-center px-4 py-2 text-sm bg-accent text-white rounded hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
          >
            {isCreating ? 'Creating...' : (
              <>
                {isPlanResponse ? 'Queue Plan Mode Response' : 'Create Task'}
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

export default CreateTaskDialog;
