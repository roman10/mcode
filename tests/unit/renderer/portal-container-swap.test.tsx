// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { render, act } from '@testing-library/react';

// Guards the invariant behind TerminalTile / ClosableTileWrapper: a tile's
// subtree (xterm Terminal, CodeMirror state, WebGL atlas) must survive being
// moved between the in-tile anchor and the maximize overlay slot WITHOUT
// remounting. A child records every mount via a fresh id — stable id across
// the move means the subtree was preserved.
let mountCount = 0;
function Sentinel({ sink }: { sink: { id: number } }): null {
  const idRef = useRef<number>(0);
  if (idRef.current === 0) idRef.current = ++mountCount;
  useLayoutEffect(() => {
    sink.id = idRef.current;
  });
  return null;
}

describe('portal subtree preservation across anchor swap', () => {
  // Documents the root cause that broke tile-maximize-reflow /
  // tile-split-while-expanded: changing a createPortal container is NOT a
  // reparent — React deletes the old portal fiber and mounts a new one.
  it('REMOUNTS when the createPortal container itself changes', () => {
    function PortalSwap({ sink }: { sink: { id: number } }): React.JSX.Element {
      const [a, setA] = useState<HTMLDivElement | null>(null);
      const [b, setB] = useState<HTMLDivElement | null>(null);
      const [useB, setUseB] = useState(false);
      (PortalSwap as unknown as { flip: () => void }).flip = () => setUseB((v) => !v);
      const target = useB ? b : a;
      return (
        <div>
          <div ref={setA} />
          <div ref={setB} />
          {target && createPortal(<Sentinel sink={sink} />, target)}
        </div>
      );
    }
    const sink = { id: -1 };
    act(() => {
      render(<PortalSwap sink={sink} />);
    });
    const before = sink.id;
    act(() => {
      (PortalSwap as unknown as { flip: () => void }).flip();
    });
    expect(sink.id).not.toBe(before);
  });

  // Lifetime cleanup for the stable host. React's portal cleanup only tears
  // down the subtree React owns — the manually-reparented host element itself
  // stays attached to whichever slot last received it. Without an explicit
  // host.remove() on unmount, the empty host accumulates one per
  // session-removal cycle, pinning a chunk of DOM around the slot.
  it('REMOVES the reparented host from the DOM when the tile unmounts', () => {
    function StableHostTile(): React.JSX.Element {
      const [slot, setSlot] = useState<HTMLDivElement | null>(null);
      const hostRef = useRef<HTMLDivElement | null>(null);
      if (hostRef.current === null) {
        const el = document.createElement('div');
        el.setAttribute('data-test-host', 'true');
        hostRef.current = el;
      }
      const host = hostRef.current;
      useLayoutEffect(() => {
        if (slot && host.parentElement !== slot) slot.appendChild(host);
      }, [slot, host]);
      useLayoutEffect(() => () => { host.remove(); }, [host]);
      return (
        <div>
          <div ref={setSlot} data-test-slot="true" />
          {slot && createPortal(<span>inner</span>, host)}
        </div>
      );
    }

    const { unmount } = render(<StableHostTile />);
    const hostBefore = document.querySelector('[data-test-host]');
    expect(hostBefore).not.toBeNull();
    expect(hostBefore?.parentElement?.getAttribute('data-test-slot')).toBe('true');

    act(() => {
      unmount();
    });
    expect(document.querySelector('[data-test-host]')).toBeNull();
  });

  // The fix: portal into ONE stable host (constant container) and physically
  // appendChild that host between anchors. The portal fiber never changes, so
  // the subtree is preserved — same mount id before and after.
  it('PRESERVES the subtree when a stable host is reparented via appendChild', () => {
    function StableHostSwap({ sink }: { sink: { id: number } }): React.JSX.Element {
      const [a, setA] = useState<HTMLDivElement | null>(null);
      const [b, setB] = useState<HTMLDivElement | null>(null);
      const [useB, setUseB] = useState(false);
      (StableHostSwap as unknown as { flip: () => void }).flip = () => setUseB((v) => !v);
      const hostRef = useRef<HTMLDivElement | null>(null);
      if (hostRef.current === null) hostRef.current = document.createElement('div');
      const host = hostRef.current;
      const target = useB ? b : a;
      useLayoutEffect(() => {
        if (target && host.parentElement !== target) target.appendChild(host);
      }, [target, host]);
      return (
        <div>
          <div ref={setA} />
          <div ref={setB} />
          {target && createPortal(<Sentinel sink={sink} />, host)}
        </div>
      );
    }
    const sink = { id: -1 };
    act(() => {
      render(<StableHostSwap sink={sink} />);
    });
    const before = sink.id;
    expect(before).toBeGreaterThan(0);
    act(() => {
      (StableHostSwap as unknown as { flip: () => void }).flip();
    });
    expect(sink.id).toBe(before);
  });
});
