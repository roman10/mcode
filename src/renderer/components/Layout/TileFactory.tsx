import { sessionIdFromTileId } from '../../stores/layout-store';
import TerminalTile from '../Terminal/TerminalTile';

interface TileFactoryProps {
  tileId: string;
}

function TileFactory({ tileId }: TileFactoryProps): React.JSX.Element {
  const sessionId = sessionIdFromTileId(tileId);

  if (sessionId) {
    return <TerminalTile sessionId={sessionId} />;
  }

  // Future: handle other tile types like 'dashboard'
  return (
    <div className="flex items-center justify-center h-full text-text-muted text-sm">
      Unknown tile: {tileId}
    </div>
  );
}

export default TileFactory;
