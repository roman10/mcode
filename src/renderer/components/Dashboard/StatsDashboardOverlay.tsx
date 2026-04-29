import * as RadixDialog from '@radix-ui/react-dialog';
import { useDialogStore } from '../../stores/dialog-store';
import StatsDashboard from './StatsDashboard';

function StatsDashboardOverlay(): React.JSX.Element {
  const open = useDialogStore((s) => s.showStatsDashboard);
  const setOpen = useDialogStore((s) => s.setShowStatsDashboard);

  return (
    <RadixDialog.Root open={open} onOpenChange={setOpen}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-50 bg-black/50 animate-fade-in" />
        <RadixDialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[95vw] h-[95vh] bg-bg-primary border border-border-default rounded-lg shadow-xl overflow-hidden flex flex-col"
        >
          <RadixDialog.Title className="sr-only">Stats Dashboard</RadixDialog.Title>
          <StatsDashboard onClose={() => setOpen(false)} />
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

export default StatsDashboardOverlay;
