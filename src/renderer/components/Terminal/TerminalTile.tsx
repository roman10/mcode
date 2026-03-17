import TerminalToolbar from './TerminalToolbar';
import TerminalInstance from './TerminalInstance';
import { useLayoutStore } from '../../stores/layout-store';
import { useSessionStore } from '../../stores/session-store';

interface TerminalTileProps {
  sessionId: string;
}

function TerminalTile({ sessionId }: TerminalTileProps): React.JSX.Element {
  const removeTile = useLayoutStore((s) => s.removeTile);
  const persist = useLayoutStore((s) => s.persist);
  const selectSession = useSessionStore((s) => s.selectSession);

  const handleClose = (): void => {
    removeTile(sessionId);
    persist();
  };

  const handleFocus = (): void => {
    selectSession(sessionId, 'user');
  };

  return (
    <div
      className="flex flex-col h-full w-full bg-bg-primary"
      onPointerDown={handleFocus}
    >
      <TerminalToolbar sessionId={sessionId} onClose={handleClose} />
      <div className="flex-1 min-h-0 pl-1">
        <TerminalInstance sessionId={sessionId} />
      </div>
    </div>
  );
}

export default TerminalTile;
