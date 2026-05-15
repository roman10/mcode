import { useContext } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { TileChromeContext } from './TileChromeContext';
import Tooltip from '../shared/Tooltip';

/** Maximize/restore button for non-session tile toolbars (file / diff /
 *  commit-diff). Reads the overlay state + toggle from TileChromeContext,
 *  which ClosableTileWrapper provides. `className` lets each toolbar match
 *  its sibling close button. Renders nothing outside a wrapper (defensive). */
function TileMaximizeButton({ className }: { className?: string }): React.JSX.Element | null {
  const chrome = useContext(TileChromeContext);
  if (!chrome) return null;
  const { isMaximized, toggleMaximize } = chrome;
  return (
    <Tooltip content={isMaximized ? 'Restore layout (⌘↵)' : 'Maximize tile (⌘↵)'} side="bottom">
      <button
        aria-label={isMaximized ? 'Restore layout' : 'Maximize tile'}
        className={className}
        onClick={toggleMaximize}
      >
        {isMaximized ? <Minimize2 size={14} strokeWidth={1.5} /> : <Maximize2 size={14} strokeWidth={1.5} />}
      </button>
    </Tooltip>
  );
}

export default TileMaximizeButton;
