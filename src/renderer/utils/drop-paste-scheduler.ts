export interface PasteTarget {
  focus: () => void;
  paste: (text: string) => void;
}

export interface DropPasteOptions {
  initialDelayMs?: number;
  betweenDelayMs?: number;
  scheduler?: (cb: () => void, ms: number) => unknown;
}

// Claude Code's TUI debounces incoming bracketed-pastes when matching them as
// image attachments — pastes within ~200ms get coalesced. Spacing each path
// out with a 300ms gap (and a 50ms initial delay so the drop event settles)
// produces one image chip per path. Joining paths inside a single paste
// (with spaces or newlines) loses the path-detection regex match entirely.
const DEFAULT_INITIAL_DELAY_MS = 50;
const DEFAULT_BETWEEN_DELAY_MS = 300;

export function scheduleDropPaste(
  paths: string[],
  term: PasteTarget,
  options: DropPasteOptions = {},
): void {
  if (paths.length === 0) return;
  const initial = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const between = options.betweenDelayMs ?? DEFAULT_BETWEEN_DELAY_MS;
  const schedule = options.scheduler ?? ((cb, ms) => window.setTimeout(cb, ms));
  term.focus();
  paths.forEach((p, idx) => {
    schedule(() => term.paste(p), initial + idx * between);
  });
}
