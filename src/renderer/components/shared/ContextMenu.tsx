import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MenuItem {
  label: string;
  action: string;
  enabled?: boolean;
  separator?: boolean;
  children?: MenuItem[];
  checked?: boolean;
  shortcut?: string;
}

interface ContextMenuProps {
  items: MenuItem[];
  position: { x: number; y: number };
  onAction: (action: string) => void;
  onClose: () => void;
}

function SubMenu({ items, parentRect, onAction }: {
  items: MenuItem[];
  parentRect: DOMRect;
  onAction: (action: string) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: parentRect.right, y: parentRect.top });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    let x = parentRect.right;
    let y = parentRect.top;
    // Flip left if overflowing right edge
    if (x + rect.width > window.innerWidth - 4) {
      x = Math.max(4, parentRect.left - rect.width);
    }
    // Clamp vertically
    if (y + rect.height > window.innerHeight - 4) {
      y = Math.max(4, window.innerHeight - rect.height - 4);
    }
    setPos({ x, y });
  }, [parentRect]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[140px] rounded-md border border-border-default bg-bg-elevated py-1 shadow-lg"
      style={{ left: pos.x, top: pos.y }}
    >
      {items.map((item) => (
        <button
          key={item.action}
          data-action={item.action}
          disabled={item.enabled === false}
          className="flex w-full cursor-default items-center px-3 py-1.5 text-left text-[13px] text-text-primary hover:bg-accent/15 disabled:text-text-muted disabled:hover:bg-transparent"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (item.enabled !== false) onAction(item.action);
          }}
        >
          <span className="w-5 shrink-0 text-accent">
            {item.checked ? '✓' : ''}
          </span>
          {item.label}
          {item.shortcut && (
            <span className="ml-auto pl-4 text-xs text-text-muted">{item.shortcut}</span>
          )}
        </button>
      ))}
    </div>
  );
}

function ContextMenu({ items, position, onAction, onClose }: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState(position);
  const [openSub, setOpenSub] = useState<string | null>(null);
  const [subParentRect, setSubParentRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    const handlePointerDown = (e: PointerEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [onClose]);

  // Clamp menu position to stay within viewport
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - 4;
    const maxY = window.innerHeight - rect.height - 4;
    const x = Math.max(4, Math.min(position.x, maxX));
    const y = Math.max(4, Math.min(position.y, maxY));
    if (x !== clamped.x || y !== clamped.y) {
      setClamped({ x, y });
    }
  }, [position]); // eslint-disable-line react-hooks/exhaustive-deps -- clamped is derived from position

  const handleAction = (action: string): void => {
    onAction(action);
    onClose();
  };

  return createPortal(
    <div
      ref={menuRef}
      data-testid="context-menu"
      className="fixed z-50 min-w-[160px] rounded-md border border-border-default bg-bg-elevated py-1 shadow-lg"
      style={{ left: clamped.x, top: clamped.y }}
    >
      {items.map((item) =>
        item.separator ? (
          <div key={item.action} className="my-1 border-t border-border-default" />
        ) : item.children ? (
          <button
            key={item.action}
            className="flex w-full cursor-default items-center justify-between px-3 py-1.5 text-left text-[13px] text-text-primary hover:bg-accent/15"
            onPointerEnter={(e) => {
              setOpenSub(item.action);
              setSubParentRect(e.currentTarget.getBoundingClientRect());
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              setOpenSub(item.action);
              setSubParentRect(e.currentTarget.getBoundingClientRect());
            }}
          >
            {item.label}
            <span className="ml-2 text-text-muted">▸</span>
          </button>
        ) : (
          <button
            key={item.action}
            data-action={item.action}
            disabled={item.enabled === false}
            className="flex w-full cursor-default items-center px-3 py-1.5 text-left text-[13px] text-text-primary hover:bg-accent/15 disabled:text-text-muted disabled:hover:bg-transparent"
            onPointerEnter={() => setOpenSub(null)}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              if (item.enabled !== false) handleAction(item.action);
            }}
          >
            {item.label}
            {item.shortcut && (
              <span className="ml-auto pl-4 text-xs text-text-muted">{item.shortcut}</span>
            )}
          </button>
        ),
      )}
      {openSub &&
        subParentRect &&
        (() => {
          const parentItem = items.find((i) => i.action === openSub);
          if (!parentItem?.children) return null;
          return (
            <SubMenu
              items={parentItem.children}
              parentRect={subParentRect}
              onAction={handleAction}
            />
          );
        })()}
    </div>,
    document.body,
  );
}

export default ContextMenu;
