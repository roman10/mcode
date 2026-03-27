import { ChevronDown, ChevronRight } from 'lucide-react';

function SectionDivider({
  label,
  collapsed,
  onToggle,
  summary,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  summary?: string;
}): React.JSX.Element {
  return (
    <button type="button" className="flex items-center gap-2 pt-1 w-full text-left" onClick={onToggle} aria-expanded={!collapsed}>
      {collapsed ? (
        <ChevronRight size={10} className="text-text-muted/60 shrink-0" />
      ) : (
        <ChevronDown size={10} className="text-text-muted/60 shrink-0" />
      )}
      <span className="text-xs text-text-muted/60 uppercase tracking-wider">{label}</span>
      {collapsed && summary && (
        <span className="text-xs text-text-muted/50 truncate">{summary}</span>
      )}
      <div className="flex-1 h-px bg-border-default" />
    </button>
  );
}

export default SectionDivider;
