import Tooltip from '../shared/Tooltip';

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

interface AccountPillProps {
  name: string;
  email: string | null;
}

function AccountPill({ name, email }: AccountPillProps): React.JSX.Element {
  const tooltipContent = email ? `${name} (${email})` : name;
  return (
    <Tooltip content={tooltipContent} side="bottom">
      <span className="text-[10px] leading-tight px-1 py-px rounded bg-bg-primary text-text-muted shrink-0 ml-1 cursor-default select-none">
        {getInitials(name)}
      </span>
    </Tooltip>
  );
}

export default AccountPill;
