import { useEffect, useRef, useState } from 'react';
import Dialog from './Dialog';
import type { CreateTaskInput } from '../../../shared/types';

const isMac = navigator.userAgent.includes('Mac');

interface PlanModeResponseDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreate(input: CreateTaskInput): void;
  targetSessionId: string;
  cwd: string;
}

function PlanModeResponseDialog({
  open,
  onOpenChange,
  onCreate,
  targetSessionId,
  cwd,
}: PlanModeResponseDialogProps): React.JSX.Element {
  const [exitPlanMode, setExitPlanMode] = useState(true);
  const [message, setMessage] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setExitPlanMode(true);
      setMessage('');
      setIsCreating(false);
      setTimeout(() => textareaRef.current?.focus(), 50);
    }
  }, [open]);

  const placeholder = exitPlanMode
    ? 'proceed with implementation'
    : 'what should be changed in the plan';

  const handleSubmit = (e?: React.FormEvent): void => {
    e?.preventDefault();
    if (!message.trim() || isCreating) return;
    setIsCreating(true);
    onCreate({
      prompt: message.trim(),
      cwd,
      targetSessionId,
      planModeAction: { exitPlanMode },
    });
  };

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
      title="Respond to Plan Mode"
      width="w-[380px]"
    >
      <form onSubmit={handleSubmit}>
        <div className="space-y-4">
          {/* Proceed / Revise toggle */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setExitPlanMode(true)}
              className={`flex-1 py-2 text-sm rounded border transition-colors ${
                exitPlanMode
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-default text-text-secondary hover:bg-bg-elevated'
              }`}
            >
              Proceed
            </button>
            <button
              type="button"
              onClick={() => setExitPlanMode(false)}
              className={`flex-1 py-2 text-sm rounded border transition-colors ${
                !exitPlanMode
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-default text-text-secondary hover:bg-bg-elevated'
              }`}
            >
              Revise
            </button>
          </div>

          {/* Message */}
          <div>
            <label className="block text-sm text-text-secondary mb-1">
              {exitPlanMode ? 'Tell Claude to proceed' : 'Tell Claude what to change'}
            </label>
            <textarea
              ref={textareaRef}
              className="w-full bg-bg-primary text-text-primary text-sm px-3 py-2 border border-border-default rounded focus:border-border-focus outline-none resize-none"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={placeholder}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-5">
          <button
            type="button"
            className="px-4 py-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!message.trim() || isCreating}
            className="px-4 py-2 text-sm bg-accent text-white rounded hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
          >
            {isCreating ? 'Queuing...' : 'Queue Response'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export default PlanModeResponseDialog;
