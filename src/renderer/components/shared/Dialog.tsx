import * as RadixDialog from '@radix-ui/react-dialog';

interface DialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** When false, clicking the overlay does not close the dialog. Default: true */
  closeOnOverlayClick?: boolean;
  children: React.ReactNode;
  title: string;
  /** Accessible description shown below the title */
  description?: string;
  /** Width class, e.g. "w-[420px]". Default: "w-[420px]" */
  width?: string;
  /** Extra classes on the content container */
  className?: string;
}

function Dialog({
  open,
  onOpenChange,
  closeOnOverlayClick = true,
  children,
  title,
  description,
  width = 'w-[420px]',
  className = '',
}: DialogProps): React.JSX.Element {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className={`fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-bg-elevated border border-border-default rounded-lg p-6 shadow-xl ${width} ${className}`}
          onInteractOutside={(e) => {
            if (!closeOnOverlayClick) e.preventDefault();
          }}
        >
          <RadixDialog.Title className={`text-text-primary text-lg font-medium ${description ? 'mb-1' : 'mb-4'}`}>
            {title}
          </RadixDialog.Title>
          {description && (
            <RadixDialog.Description className="text-text-muted text-sm mb-4">
              {description}
            </RadixDialog.Description>
          )}
          {children}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export default Dialog;
