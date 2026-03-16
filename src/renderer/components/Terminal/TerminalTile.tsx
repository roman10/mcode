import TerminalToolbar from './TerminalToolbar';
import TerminalInstance from './TerminalInstance';
import { useLayoutStore } from '../../stores/layout-store';

interface TerminalTileProps {
  sessionId: string;
}

function TerminalTile({ sessionId }: TerminalTileProps): React.JSX.Element {
  const removeTile = useLayoutStore((s) => s.removeTile);
  const persist = useLayoutStore((s) => s.persist);

  const handleClose = (): void => {
    removeTile(sessionId);
    persist();
  };

  return (
    <div className="flex flex-col h-full w-full bg-bg-primary">
      <TerminalToolbar sessionId={sessionId} onClose={handleClose} />
      <div className="flex-1 min-h-0 pl-1">
        <TerminalInstance sessionId={sessionId} />
      </div>
    </div>
  );
}

export default TerminalTile;
