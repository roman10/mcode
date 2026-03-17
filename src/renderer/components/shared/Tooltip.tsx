import * as RadixTooltip from '@radix-ui/react-tooltip';

interface TooltipProps {
  children: React.ReactNode;
  content: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
}

function Tooltip({
  children,
  content,
  side = 'top',
}: TooltipProps): React.JSX.Element {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={4}
          className="z-50 rounded px-2 py-1 text-xs bg-bg-elevated text-text-primary shadow-md border border-border-subtle data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

export default Tooltip;
