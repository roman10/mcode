import { useCallback, useRef } from 'react';
import { useTerminalPanelStore, type PanelNode } from '../../stores/terminal-panel-store';
import TerminalTabGroup from './TerminalTabGroup';

interface SplitContainerProps {
  node: PanelNode;
}

function SplitDivider({
  direction,
  onDrag,
}: {
  direction: 'horizontal' | 'vertical';
  onDrag: (delta: number) => void;
}): React.JSX.Element {
  const dragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      const startPos = direction === 'horizontal' ? e.clientX : e.clientY;
      const container = (e.target as HTMLElement).parentElement;
      const containerSize = container
        ? direction === 'horizontal'
          ? container.clientWidth
          : container.clientHeight
        : 1;

      const handleMouseMove = (me: MouseEvent): void => {
        if (!dragging.current) return;
        const currentPos = direction === 'horizontal' ? me.clientX : me.clientY;
        const delta = (currentPos - startPos) / containerSize;
        onDrag(delta);
      };

      const handleMouseUp = (): void => {
        dragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [direction, onDrag],
  );

  const isHorizontal = direction === 'horizontal';
  return (
    <div
      className={`
        ${isHorizontal ? 'w-[3px] cursor-col-resize' : 'h-[3px] cursor-row-resize'}
        shrink-0 hover:bg-border-focus/50 transition-colors
      `}
      onMouseDown={handleMouseDown}
    />
  );
}

export default function TerminalSplitContainer({ node }: SplitContainerProps): React.JSX.Element {
  const setSplitRatio = useTerminalPanelStore((s) => s.setSplitRatio);
  const activateTabGroup = useTerminalPanelStore((s) => s.activateTabGroup);

  const handleFocusGroup = useCallback(
    (tabGroupId: string) => {
      activateTabGroup(tabGroupId);
    },
    [activateTabGroup],
  );

  const handleDrag = useCallback(
    (delta: number) => {
      if (node.type === 'leaf') return;
      setSplitRatio(node, node.ratio + delta);
    },
    [node, setSplitRatio],
  );

  if (node.type === 'leaf') {
    return (
      <div
        className="flex-1 min-h-0 min-w-0 flex flex-col"
        onFocus={() => handleFocusGroup(node.tabGroupId)}
      >
        <TerminalTabGroup tabGroupId={node.tabGroupId} />
      </div>
    );
  }

  const { direction, children, ratio } = node;
  const isHorizontal = direction === 'horizontal';

  const firstStyle = isHorizontal
    ? { width: `${ratio * 100}%` }
    : { height: `${ratio * 100}%` };
  const secondStyle = isHorizontal
    ? { width: `${(1 - ratio) * 100}%` }
    : { height: `${(1 - ratio) * 100}%` };

  return (
    <div className={`flex ${isHorizontal ? 'flex-row' : 'flex-col'} flex-1 min-h-0 min-w-0`}>
      <div className="min-h-0 min-w-0 flex flex-col" style={firstStyle}>
        <TerminalSplitContainer node={children[0]} />
      </div>
      <SplitDivider direction={direction} onDrag={handleDrag} />
      <div className="min-h-0 min-w-0 flex flex-col" style={secondStyle}>
        <TerminalSplitContainer node={children[1]} />
      </div>
    </div>
  );
}
