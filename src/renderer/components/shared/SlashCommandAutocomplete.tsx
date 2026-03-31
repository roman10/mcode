import { useEffect, useMemo, useState } from 'react';
import { getAgentDefinition } from '@shared/session-agents';
import { getSessionSlashCommandHelp, getSessionSlashCommandSupport } from '@shared/session-capabilities';
import type { SlashCommandEntry } from '@shared/types';
import { useTextareaDropdown } from '../../hooks/useTextareaDropdown';
import { filterByPrefixThenIncludes } from '../../utils/autocomplete-utils';
import { buildUnsupportedSlashCommandWarning, parseSlashCommandName } from '../../utils/slash-command-validation';

interface SlashCommandAutocompleteProps {
  prompt: string;
  cwd: string;
  sessionType: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onSelect: (commandText: string) => void;
}

const SOURCE_LABELS: Record<string, string> = {
  project: 'Project',
  user: 'Global',
  builtin: 'Built-in',
};

function SlashCommandAutocomplete({
  prompt,
  cwd,
  sessionType,
  textareaRef,
  onSelect,
}: SlashCommandAutocompleteProps): React.JSX.Element | null {
  const [commands, setCommands] = useState<SlashCommandEntry[]>([]);
  const agent = getAgentDefinition(sessionType);
  const slashSupport = getSessionSlashCommandSupport(sessionType);
  const slashHelp = getSessionSlashCommandHelp(sessionType);

  // Visible only when prompt is "/" followed by non-whitespace chars (no spaces)
  const matchesSlash = /^\/\S*$/.test(prompt);
  const query = matchesSlash ? prompt.slice(1).toLowerCase() : '';

  // Fetch commands when cwd or session type changes
  useEffect(() => {
    if (!cwd || !agent) return;
    let stale = false;
    window.mcode.slashCommands.scan(agent.sessionType, cwd).then((result) => {
      if (!stale) setCommands(result);
    });
    return () => { stale = true; };
  }, [cwd, agent]);

  // Filter commands
  const filtered = useMemo(() => {
    if (!matchesSlash) return [];
    return filterByPrefixThenIncludes(commands, query, (c) => c.name);
  }, [matchesSlash, query, commands]);

  const helperText = useMemo(() => {
    if (!agent || !slashHelp) return null;
    const customSources: string[] = [];
    if (slashSupport?.userCommandFiles) customSources.push('global custom commands');
    if (slashSupport?.projectCommandFiles) customSources.push('project custom commands');
    if (customSources.length > 0) {
      return `Showing ${agent.displayName} built-ins plus ${customSources.join(' and ')}. Use ${slashHelp.command} in the session for the full native list.`;
    }
    return `Showing known ${agent.displayName} slash commands. Use ${slashHelp.command} in the session for the full native list.`;
  }, [agent, slashHelp, slashSupport]);

  const unsupportedWarning = useMemo(() => {
    if (!agent || commands.length === 0) return null;
    return buildUnsupportedSlashCommandWarning(
      prompt,
      commands.map((cmd) => cmd.name),
      agent.displayName,
    );
  }, [agent, commands, prompt]);

  const currentSlashCommand = useMemo(() => parseSlashCommandName(prompt), [prompt]);

  const { selectedIndex, listRef, isOpen } = useTextareaDropdown({
    textareaRef,
    items: filtered,
    visible: matchesSlash,
    query,
    onSelect: (cmd) => onSelect('/' + cmd.name + ' '),
  });

  // Group items by source for section headers
  let lastSource = '';
  const noMatches = filtered.length === 0;
  const showPanel = (matchesSlash && (isOpen || noMatches)) || !!unsupportedWarning;
  if (!showPanel) return null;

  return (
    <div
      ref={listRef}
      className="absolute left-0 right-0 top-full mt-1 z-10 max-h-[240px] overflow-y-auto rounded-md border border-border-default bg-bg-elevated shadow-lg"
    >
      {agent && (
        <div className="px-3 pt-2 pb-2 border-b border-border-subtle">
          <div className="text-[11px] font-medium uppercase tracking-wider text-text-muted">
            {agent.displayName} commands
          </div>
          {helperText && (
            <div className="mt-1 text-xs text-text-secondary">
              {helperText}
            </div>
          )}
        </div>
      )}
      {unsupportedWarning && (
        <div className="px-3 py-2 text-xs text-amber-300 border-b border-border-subtle bg-amber-400/5">
          {unsupportedWarning}
        </div>
      )}
      {noMatches && matchesSlash && (
        <div className="px-3 py-2 text-xs text-text-muted">
          No slash commands match <span className="font-mono text-text-secondary">/{currentSlashCommand ?? prompt.replace(/^\//, '')}</span>.
        </div>
      )}
      {filtered.map((cmd, i) => {
        const showHeader = cmd.source !== lastSource;
        lastSource = cmd.source;
        return (
          <div key={cmd.name}>
            {showHeader && (
              <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-text-muted">
                {SOURCE_LABELS[cmd.source] ?? cmd.source}
              </div>
            )}
            <button
              type="button"
              data-index={i}
              className={`flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm ${
                i === selectedIndex ? 'bg-accent/15 text-text-primary' : 'text-text-primary hover:bg-bg-secondary'
              }`}
              onPointerDown={(e) => {
                e.preventDefault(); // keep focus on textarea
                onSelect('/' + cmd.name + ' ');
              }}
            >
              <span className="shrink-0 font-mono text-accent">/{cmd.name}</span>
              <span className="truncate text-text-secondary text-xs">{cmd.description}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default SlashCommandAutocomplete;
