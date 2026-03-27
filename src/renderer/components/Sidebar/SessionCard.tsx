import { useState, useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import type { SessionInfo } from '@shared/types';
import { useAccountsStore } from '../../stores/accounts-store';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import { splitLabelIcon } from '../../utils/label-utils';
import { canResumeSession } from '../../utils/session-resume';
import Tooltip from '../shared/Tooltip';
import StatusBadge from './StatusBadge';
import ContextMenu from '../shared/ContextMenu';
import type { MenuItem } from '../shared/ContextMenu';

interface SessionCardProps {
  session: SessionInfo;
  isSelected: boolean;
  hasTile: boolean;
  onSelect(): void;
  onDoubleClick(): void;
  onKill(): void;
  onDelete(): void;
  onRename(label: string): void;
}

export interface SessionCardHandle {
  startEditing(): void;
}

const attentionBorderColors: Record<string, string> = {
  action: 'border-l-2 border-l-red-400',
  info:   'border-l-2 border-l-amber-400',
  none:   '',
};

const SessionCard = forwardRef<SessionCardHandle, SessionCardProps>(
  function SessionCard({
    session,
    isSelected,
    hasTile,
    onSelect,
    onDoubleClick,
    onKill,
    onDelete,
    onRename,
  }, ref) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const [labelIcon, labelText] = splitLabelIcon(session.label);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    const labelTextRef = useRef(labelText);
    labelTextRef.current = labelText;

    const startEditing = (): void => {
      setEditValue(labelTextRef.current);
      setIsEditing(true);
    };

    useImperativeHandle(ref, () => ({ startEditing }), []);

    useEffect(() => {
      if (isEditing && inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    }, [isEditing]);

    const handleRenameSubmit = (): void => {
      const trimmed = editValue.trim();
      const full = labelIcon ? `${labelIcon} ${trimmed}` : trimmed;
      if (trimmed && full !== session.label) {
        onRename(full);
      } else {
        setEditValue(labelText);
      }
      setIsEditing(false);
    };

    const shortTime = useRelativeTime(session.startedAt);
    const attentionBorder = attentionBorderColors[session.attentionLevel] ?? '';
    const accountName = useAccountsStore((s) => {
      if (!session.accountId) return null;
      const account = s.accounts.find((a) => a.accountId === session.accountId);
      return account && !account.isDefault ? account.name : null;
    });

    const resumable = canResumeSession(session);
    const canOpenTile = !hasTile && (session.status !== 'ended' || resumable);
    const isEnded = session.status === 'ended';

    const contextMenuItems: MenuItem[] = [
      { label: 'Rename', action: 'rename', shortcut: 'F2' },
      ...(canOpenTile
        ? [{ label: isEnded ? 'View / Resume' : 'Open Tile', action: 'open-tile', shortcut: '↵' }]
        : []),
      { label: '', action: 'sep1', separator: true },
      isEnded
        ? { label: 'Delete Session', action: 'delete', shortcut: '⌫' }
        : { label: 'Kill Session', action: 'kill', shortcut: '⌫' },
    ];

    const handleContextAction = (action: string): void => {
      switch (action) {
        case 'rename':
          startEditing();
          break;
        case 'open-tile':
          onDoubleClick();
          break;
        case 'kill':
          onKill();
          break;
        case 'delete':
          onDelete();
          break;
      }
    };

    return (
      <div
        className={`group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors ${attentionBorder} ${
          isSelected
            ? 'bg-bg-elevated'
            : 'hover:bg-bg-secondary'
        }`}
        onClick={onSelect}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {/* Status dot with attention ring */}
        <StatusBadge status={session.status} attentionLevel={session.attentionLevel} attentionReason={session.attentionReason} />

        {/* Label + metadata */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-1">
              {labelIcon && <span className="text-sm shrink-0">{labelIcon}</span>}
              <input
                ref={inputRef}
                className="flex-1 min-w-0 bg-bg-primary text-text-primary text-sm px-1 py-0 border border-border-focus rounded outline-none"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleRenameSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSubmit();
                  if (e.key === 'Escape') {
                    setEditValue(labelText);
                    setIsEditing(false);
                  }
                }}
              />
            </div>
          ) : (
            <span
              className="block text-sm text-text-primary truncate"
              title={session.label}
            >
              {session.sessionType === 'terminal' && (
                <span className="text-text-muted font-mono text-xs mr-1">&gt;_</span>
              )}
              {labelIcon && <span className="mr-1">{labelIcon}</span>}
              {labelText}
              {accountName && (
                <span className="text-xs text-text-muted ml-1.5">{accountName}</span>
              )}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-text-muted truncate" title={session.cwd}>
              {session.cwd}
            </span>
            {shortTime && (
              <span className="text-xs text-text-muted shrink-0">
                · {shortTime}
              </span>
            )}
            {session.lastTool && session.status !== 'ended' && (
              <Tooltip content={`Last tool: ${session.lastTool}`} side="right">
                <span className="text-xs text-text-muted bg-bg-primary px-1 rounded shrink-0">
                  {session.lastTool}
                </span>
              </Tooltip>
            )}
            {session.autoClose && (
              <span className="text-xs bg-accent/15 text-accent px-1 rounded shrink-0">
                auto
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1 opacity-40 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {canOpenTile && (
            <Tooltip content={isEnded ? 'View / Resume session' : 'Open tile'} side="top">
              <button
                className="text-text-secondary hover:text-text-primary text-xs p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onDoubleClick();
                }}
              >
                +
              </button>
            </Tooltip>
          )}
          {session.status !== 'ended' ? (
            <Tooltip content="Kill session" side="top">
              <button
                className="text-text-secondary hover:text-red-400 text-xs p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onKill();
                }}
              >
                x
              </button>
            </Tooltip>
          ) : (
            <Tooltip content="Delete session" side="top">
              <button
                className="text-text-secondary hover:text-red-400 text-xs p-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete();
                }}
              >
                x
              </button>
            </Tooltip>
          )}
        </div>

        {contextMenu && (
          <ContextMenu
            items={contextMenuItems}
            position={contextMenu}
            onAction={handleContextAction}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    );
  },
);

export default SessionCard;
