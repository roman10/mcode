import { createContext, useState } from 'react';
import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import type { MosaicNode } from 'react-mosaic-component';
import { useLayoutStore } from '../../stores/layout-store';
import { ErrorBoundary, ErrorFallback } from '../shared/ErrorBoundary';
import TileFactory from './TileFactory';
import 'react-mosaic-component/react-mosaic-component.css';

/** Portal target for the maximized tile. TerminalTile reads this and
 *  `createPortal`s its content into the overlay when the tile is maximized,
 *  so the underlying mosaic (and every TerminalInstance in it) stays mounted. */
export const MosaicOverlayContext = createContext<HTMLElement | null>(null);

function MosaicLayout(): React.JSX.Element {
  const mosaicTree = useLayoutStore((s) => s.mosaicTree);
  const setMosaicTree = useLayoutStore((s) => s.setMosaicTree);
  const persist = useLayoutStore((s) => s.persist);
  const maximizedTileId = useLayoutStore((s) => s.maximizedTileId);
  const [overlayEl, setOverlayEl] = useState<HTMLDivElement | null>(null);

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
    <MosaicOverlayContext.Provider value={overlayEl}>
      <div className="relative h-full w-full">
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
        {/* Overlay layer for maximized tiles. Bounded to the mosaic area
         *  (sidebar and bottom panel sit outside this container). z-30 keeps
         *  it above the mosaic but below dialog/menu/tooltip overlays (z-50).
         *  TerminalTile portals into this div when maximized; otherwise it's
         *  empty and `display: none` keeps it from intercepting events. */}
        <div
          ref={setOverlayEl}
          className="absolute inset-0 z-30"
          style={{ display: maximizedTileId ? 'block' : 'none' }}
        />
      </div>
    </MosaicOverlayContext.Provider>
  );
}

export default MosaicLayout;
