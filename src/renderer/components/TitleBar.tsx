import { Search } from 'lucide-react';
import { useLayoutStore } from '../stores/layout-store';
import { formatKeys } from '../utils/format-shortcut';

function TitleBar(): React.JSX.Element {
  const openQuickOpen = useLayoutStore((s) => s.openQuickOpen);

  return (
    <div className="h-[38px] shrink-0 [-webkit-app-region:drag] flex items-center justify-center">
      <button
        type="button"
        onClick={() => openQuickOpen('files')}
        className="[-webkit-app-region:no-drag] flex items-center gap-2
                   h-[26px] px-3 rounded-md
                   bg-bg-secondary/60 border border-border-subtle
                   text-text-muted text-xs
                   hover:bg-bg-secondary hover:text-text-secondary hover:border-border-default
                   transition-colors cursor-pointer select-none"
        aria-label="Search files and commands"
      >
        <Search size={13} strokeWidth={1.75} />
        <span>Search</span>
        <kbd className="ml-1 text-[11px] opacity-60">{formatKeys('P', true)}</kbd>
      </button>
    </div>
  );
}

export default TitleBar;
