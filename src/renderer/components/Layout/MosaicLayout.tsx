import { createContext, useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import type { MosaicNode } from 'react-mosaic-component';
import { useLayoutStore } from '../../stores/layout-store';
import { ErrorBoundary, ErrorFallback } from '../shared/ErrorBoundary';
import TileFactory from './TileFactory';
import 'react-mosaic-component/react-mosaic-component.css';

/** Per-tile portal targets for the maximize overlay. When `maximizedTree` is
 *  non-null an overlay <Mosaic> renders one empty slot div per leaf; each tile
 *  (mounted once in the background mosaic) `createPortal`s its existing DOM
 *  into its slot, so xterm Terminals / WebGL atlases / editor state survive
 *  maximize/restore. This is the N≥1 generalization of the old single-overlay
 *  portal — today's single-tile maximize is just the one-slot case. */
export interface OverlaySlotRegistry {
  getSlot(tileId: string): HTMLElement | null;
  registerSlot(tileId: string, el: HTMLElement | null): void;
  /** Bumped on every (de)registration; the context value's identity changes
   *  with it so portaling tiles re-read getSlot once their slot mounts. */
  version: number;
}
export const MosaicOverlayContext = createContext<OverlaySlotRegistry | null>(null);

/** Stable slot div for one overlay leaf. Registers on mount, clears on unmount.
 *  `register` is stable (useCallback []), so this effect runs exactly once per
 *  leaf — no register/bump feedback loop. */
function OverlaySlot({
  tileId,
  register,
}: {
  tileId: string;
  register: (tileId: string, el: HTMLElement | null) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    register(tileId, ref.current);
    return () => register(tileId, null);
  }, [tileId, register]);
  return <div ref={ref} className="h-full w-full flex flex-col" />;
}

function MosaicLayout(): React.JSX.Element {
  const mosaicTree = useLayoutStore((s) => s.mosaicTree);
  const setMosaicTree = useLayoutStore((s) => s.setMosaicTree);
  const persist = useLayoutStore((s) => s.persist);
  const maximizedTree = useLayoutStore((s) => s.maximizedTree);
  const setMaximizedTree = useLayoutStore((s) => s.setMaximizedTree);
  const [overlayEl, setOverlayEl] = useState<HTMLDivElement | null>(null);

  const slotsRef = useRef<Map<string, HTMLElement>>(new Map());
  const [version, bump] = useReducer((v: number) => v + 1, 0);

  const registerSlot = useCallback((tileId: string, el: HTMLElement | null) => {
    const slots = slotsRef.current;
    if (el) {
      if (slots.get(tileId) === el) return;
      slots.set(tileId, el);
    } else {
      if (!slots.has(tileId)) return;
      slots.delete(tileId);
    }
    bump();
  }, []);

  const getSlot = useCallback((tileId: string) => slotsRef.current.get(tileId) ?? null, []);

  const registry = useMemo<OverlaySlotRegistry>(
    () => ({ getSlot, registerSlot, version }),
    [getSlot, registerSlot, version],
  );

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
    <MosaicOverlayContext.Provider value={registry}>
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
        {/* Maximize overlay. Bounded to the mosaic area (sidebar / bottom panel
         *  sit outside). z-30 keeps it above the background mosaic but below
         *  dialog/menu/tooltip overlays (z-50). When maximizedTree is non-null
         *  it hosts its own <Mosaic> of empty slot divs; each maximized tile
         *  portals into its slot. Empty + display:none otherwise so it never
         *  intercepts events. Overlay layout is transient — onChange does NOT
         *  persist (resize/rearrange parity without leaking into saved state). */}
        <div
          ref={setOverlayEl}
          data-testid="maximize-overlay"
          className="absolute inset-0 z-30"
          style={{ display: maximizedTree ? 'block' : 'none' }}
        >
          {maximizedTree && overlayEl && (
            <Mosaic<string>
              renderTile={(id, path) => (
                <MosaicWindow<string>
                  path={path}
                  title=""
                  toolbarControls={<></>}
                  createNode={() => ''}
                >
                  <OverlaySlot tileId={id} register={registerSlot} />
                </MosaicWindow>
              )}
              value={maximizedTree}
              onChange={setMaximizedTree}
              className="mosaic-theme-dark"
            />
          )}
        </div>
      </div>
    </MosaicOverlayContext.Provider>
  );
}

export default MosaicLayout;
