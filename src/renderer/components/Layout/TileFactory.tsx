import { sessionIdFromTileId, DASHBOARD_TILE_ID } from '../../stores/layout-store';
import TerminalTile from '../Terminal/TerminalTile';
import ActivityFeed from '../Dashboard/ActivityFeed';

interface TileFactoryProps {
  tileId: string;
}

function TileFactory({ tileId }: TileFactoryProps): React.JSX.Element {
  if (tileId === DASHBOARD_TILE_ID) {
    return <ActivityFeed />;
  }

  const sessionId = sessionIdFromTileId(tileId);

  if (sessionId) {
    return <TerminalTile sessionId={sessionId} />;
  }

  return (
    <div className="flex items-center justify-center h-full text-text-muted text-sm">
      Unknown tile: {tileId}
    </div>
  );
}

export default TileFactory;
