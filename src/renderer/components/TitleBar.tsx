import { useMemo } from 'react';
import { Search } from 'lucide-react';
import { useLayoutStore } from '../stores/layout-store';
import { useSessionStore } from '../stores/session-store';
import { formatKeys } from '../utils/format-shortcut';
import { basename } from '../utils/path-utils';

function TitleBar(): React.JSX.Element {
  const openQuickOpen = useLayoutStore((s) => s.openQuickOpen);
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);

  const projectLabel = useMemo(() => {
    const selected = selectedSessionId ? sessions[selectedSessionId] : null;
    if (selected) return basename(selected.cwd);
    const sorted = Object.values(sessions).sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
    return sorted[0] ? basename(sorted[0].cwd) : null;
  }, [sessions, selectedSessionId]);

  return (
    <div className="h-[38px] shrink-0 [-webkit-app-region:drag] flex items-center justify-center">
      <button
        type="button"
        onClick={() => openQuickOpen('files')}
        className="[-webkit-app-region:no-drag] flex items-center gap-2.5
                   w-[350px] max-w-[40vw] h-[26px] px-3 rounded-md
                   bg-bg-secondary/50 border border-border-subtle
                   text-text-muted text-xs
                   hover:bg-bg-secondary/80 hover:border-border-default
                   transition-colors cursor-pointer select-none"
        aria-label="Search files and commands"
      >
        <Search size={13} strokeWidth={1.75} />
        <span className="flex-1 text-left truncate">{projectLabel || 'Search'}</span>
        <kbd className="text-[11px] opacity-50">{formatKeys('P', true)}</kbd>
      </button>
    </div>
  );
}

export default TitleBar;
