import { useEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  action: string;
  enabled?: boolean;
  separator?: boolean;
}

interface ContextMenuProps {
  items: MenuItem[];
  position: { x: number; y: number };
  onAction: (action: string) => void;
  onClose: () => void;
}

function ContextMenu({ items, position, onAction, onClose }: ContextMenuProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const [clamped, setClamped] = useState(position);

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
    const x = Math.min(position.x, maxX);
    const y = Math.min(position.y, maxY);
    if (x !== clamped.x || y !== clamped.y) {
      setClamped({ x, y });
    }
  }, [position]); // eslint-disable-line react-hooks/exhaustive-deps -- clamped is derived from position

  return (
    <div
      ref={menuRef}
      data-testid="context-menu"
      className="fixed z-50 min-w-[160px] rounded-md border border-border-default bg-bg-elevated py-1 shadow-lg"
      style={{ left: clamped.x, top: clamped.y }}
    >
      {items.map((item) =>
        item.separator ? (
          <div key={item.action} className="my-1 border-t border-border-default" />
        ) : (
          <button
            key={item.action}
            data-action={item.action}
            disabled={item.enabled === false}
            className="flex w-full cursor-default px-3 py-1.5 text-left text-[13px] text-text-primary hover:bg-accent/15 disabled:text-text-muted disabled:hover:bg-transparent"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              if (item.enabled !== false) {
                onAction(item.action);
              }
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

export default ContextMenu;
