import { createContext, useCallback, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import type { MosaicNode } from 'react-mosaic-component';
import { useLayoutStore } from '../../stores/layout-store';
import { unionTileIds } from '../../utils/tile-id';
import { ErrorBoundary, ErrorFallback } from '../shared/ErrorBoundary';
import TileFactory from './TileFactory';
import 'react-mosaic-component/react-mosaic-component.css';

/** Per-tile portal targets. Every tile is mounted exactly once in a flat list
 *  (see {@link MosaicLayout}); both the background and the maximize-overlay
 *  <Mosaic> render only empty slot divs. Each tile `createPortal`s its stable
 *  DOM into whichever slot currently owns it — its `background` slot normally,
 *  its `overlay` slot when maximized — so xterm Terminals / WebGL atlases /
 *  CodeMirror state survive every tree restructure (add, remove, rebalance,
 *  drag-rearrange, maximize) instead of being remounted by react-mosaic's
 *  per-parent leaf reconciliation. */
export type SlotKind = 'background' | 'overlay';
export interface MosaicSlotRegistry {
  getSlot(kind: SlotKind, tileId: string): HTMLElement | null;
  registerSlot(kind: SlotKind, tileId: string, el: HTMLElement | null): void;
  /** Bumped on every (de)registration; the context value's identity changes
   *  with it so portaling tiles re-read getSlot once their slot mounts. */
  version: number;
}
export const MosaicOverlayContext = createContext<MosaicSlotRegistry | null>(null);

/** Stable slot div for one leaf of one mosaic. Registers on mount, clears on
 *  unmount. `register` is stable (useCallback []), so this effect runs exactly
 *  once per (kind, tileId) — no register/bump feedback loop. */
function Slot({
  kind,
  tileId,
  register,
}: {
  kind: SlotKind;
  tileId: string;
  register: (kind: SlotKind, tileId: string, el: HTMLElement | null) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    register(kind, tileId, ref.current);
    return () => register(kind, tileId, null);
  }, [kind, tileId, register]);
  return <div ref={ref} className="h-full w-full flex flex-col" />;
}

function MosaicLayout(): React.JSX.Element {
  const mosaicTree = useLayoutStore((s) => s.mosaicTree);
  const setMosaicTree = useLayoutStore((s) => s.setMosaicTree);
  const persist = useLayoutStore((s) => s.persist);
  const maximizedTree = useLayoutStore((s) => s.maximizedTree);
  const setMaximizedTree = useLayoutStore((s) => s.setMaximizedTree);
  const [overlayEl, setOverlayEl] = useState<HTMLDivElement | null>(null);

  const slotsRef = useRef<Record<SlotKind, Map<string, HTMLElement>>>({
    background: new Map(),
    overlay: new Map(),
  });
  const [version, bump] = useReducer((v: number) => v + 1, 0);

  const registerSlot = useCallback(
    (kind: SlotKind, tileId: string, el: HTMLElement | null) => {
      const slots = slotsRef.current[kind];
      if (el) {
        if (slots.get(tileId) === el) return;
        slots.set(tileId, el);
      } else {
        if (!slots.has(tileId)) return;
        slots.delete(tileId);
      }
      bump();
    },
    [],
  );

  const getSlot = useCallback(
    (kind: SlotKind, tileId: string) => slotsRef.current[kind].get(tileId) ?? null,
    [],
  );

  const registry = useMemo<MosaicSlotRegistry>(
    () => ({ getSlot, registerSlot, version }),
    [getSlot, registerSlot, version],
  );

  const handleChange = (newTree: MosaicNode<string> | null): void => {
    setMosaicTree(newTree);
    persist();
  };

  // Every tile that exists in either tree. Memoized so the flat list below is
  // referentially stable across unrelated re-renders.
  const flatTileIds = useMemo(
    () => unionTileIds(mosaicTree, maximizedTree),
    [mosaicTree, maximizedTree],
  );

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
              <Slot kind="background" tileId={id} register={registerSlot} />
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
                  <Slot kind="overlay" tileId={id} register={registerSlot} />
                </MosaicWindow>
              )}
              value={maximizedTree}
              onChange={setMaximizedTree}
              className="mosaic-theme-dark"
            />
          )}
        </div>
        {/* Flat tile mount point. Tiles are mounted ONCE here, keyed by tileId
         *  and structure-independent, then portal their content into the
         *  background/overlay slot that currently owns them. display:none keeps
         *  the (empty) outer wrappers out of layout while the portaled content
         *  lives in the visible slots; React synthetic events still bubble
         *  through the fiber tree, so each tile's handlers fire. Lives inside
         *  MosaicLayout so it unmounts on view-mode switch (no Kanban
         *  double-mount). */}
        <div style={{ display: 'none' }}>
          {flatTileIds.map((id) => (
            <ErrorBoundary
              key={id}
              fallback={(props) => <ErrorFallback {...props} />}
              onError={(error) => console.error(`Tile ${id} error:`, error)}
            >
              <TileFactory tileId={id} />
            </ErrorBoundary>
          ))}
        </div>
      </div>
    </MosaicOverlayContext.Provider>
  );
}

export default MosaicLayout;
