import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import type { MosaicNode } from 'react-mosaic-component';
import { useLayoutStore } from '../../stores/layout-store';
import { ErrorBoundary, ErrorFallback } from '../shared/ErrorBoundary';
import TileFactory from './TileFactory';
import 'react-mosaic-component/react-mosaic-component.css';

function MosaicLayout(): React.JSX.Element {
  const mosaicTree = useLayoutStore((s) => s.mosaicTree);
  const setMosaicTree = useLayoutStore((s) => s.setMosaicTree);
  const persist = useLayoutStore((s) => s.persist);

  const handleChange = (newTree: MosaicNode<string> | null): void => {
    setMosaicTree(newTree);
    persist();
  };

  if (!mosaicTree) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted text-sm">
        No sessions open. Click + in the sidebar to create one.
      </div>
    );
  }

  return (
    <Mosaic<string>
      renderTile={(id, path) => (
        <MosaicWindow<string>
          path={path}
          title=""
          toolbarControls={<></>}
          createNode={() => ''}
        >
          <ErrorBoundary
            fallback={(props) => <ErrorFallback {...props} />}
            onError={(error) => console.error(`Tile ${id} error:`, error)}
          >
            <TileFactory tileId={id} />
          </ErrorBoundary>
        </MosaicWindow>
      )}
      value={mosaicTree}
      onChange={handleChange}
      className="mosaic-theme-dark"
    />
  );
}

export default MosaicLayout;
