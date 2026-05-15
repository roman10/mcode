import { createContext } from 'react';

/** Maximize affordances a non-session tile's own toolbar needs. Provided by
 *  ClosableTileWrapper (which owns the tileId and the overlay portal) and
 *  consumed by TileMaximizeButton inside each tile's toolbar — so the button
 *  lives next to the close button without prop-drilling a tileId into the
 *  file/diff/commit-diff tile components. */
export interface TileChrome {
  isMaximized: boolean;
  toggleMaximize: () => void;
}

export const TileChromeContext = createContext<TileChrome | null>(null);
