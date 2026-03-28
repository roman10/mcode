import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '../../stores/session-store';
import { formatShortTime } from '../../hooks/useRelativeTime';
import Dialog from './Dialog';
import SlashCommandAutocomplete from './SlashCommandAutocomplete';
import FileAutocomplete from './FileAutocomplete';
import { buildModeCycle, TASK_PERMISSION_MODE_LABELS } from '@shared/task-utils';
import { canSessionBeTaskTarget } from '@shared/session-capabilities';
import type { CreateTaskInput, TaskPermissionMode } from '@shared/types';

const isMac = navigator.userAgent.includes('Mac');

interface CreateTaskDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreate(input: CreateTaskInput): void;
  defaultTargetSessionId?: string;
  defaultCwd?: string;
}

function CreateTaskDialog({
  open,
  onOpenChange,
  onCreate,
  defaultTargetSessionId,
  defaultCwd,
}: CreateTaskDialogProps): React.JSX.Element {
  const [prompt, setPrompt] = useState('');
  const [cwd, setCwd] = useState(defaultCwd ?? '');
  const [targetSessionId, setTargetSessionId] = useState(defaultTargetSessionId ?? '');
  const [permissionMode, setPermissionMode] = useState<TaskPermissionMode | ''>('');
  const [isCreating, setIsCreating] = useState(false);
  const [cursorPos, setCursorPos] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sessions = useSessionStore((s) => s.sessions);

  // Valid targets: live-mode Claude sessions that are active or idle
  const targetableSessions = Object.values(sessions).filter(
    (s) => canSessionBeTaskTarget(s),
  );

  // Available permission modes based on selected target session
  const selectedSession = targetSessionId ? sessions[targetSessionId] : undefined;
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

  // Reset form and load defaults when dialog opens
  const prevOpenRef = useRef(false);
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setPrompt('');
      setCwd(defaultCwd ?? '');
      setTargetSessionId(defaultTargetSessionId ?? '');
      setPermissionMode('');
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
  }, [open, defaultCwd, defaultTargetSessionId]);

  const handleBrowse = async (): Promise<void> => {
    const dir = await window.mcode.app.selectDirectory();
    if (dir) setCwd(dir);
  };

  const handleSubmit = (e?: React.FormEvent): void => {
    e?.preventDefault();
    if (!prompt.trim() || !cwd.trim() || !targetSessionId || isCreating) return;

    setIsCreating(true);
    onCreate({
      prompt: prompt.trim(),
      cwd: cwd.trim(),
      targetSessionId,
      ...(permissionMode ? { permissionMode } : {}),
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
      title="New Task"
    >
      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          {/* Prompt */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">
              Prompt
            </label>
            <div className="relative">
              <textarea
                ref={textareaRef}
                className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none resize-none"
                rows={4}
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  setCursorPos(e.target.selectionStart ?? 0);
                }}
                onClick={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                onKeyUp={(e) => setCursorPos((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
                placeholder="What should Claude work on?"
                autoFocus
              />
              <SlashCommandAutocomplete
                prompt={prompt}
                cwd={cwd}
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

          {/* Target session */}
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

          {/* Permission mode */}
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
            disabled={!prompt.trim() || !cwd.trim() || !targetSessionId || isCreating}
            className="inline-flex items-center px-4 py-2 text-sm bg-accent text-white rounded hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
          >
            {isCreating ? 'Creating...' : (
              <>
                Create Task
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
