import { spawn } from 'node:child_process';
import { logger } from '../logger';
import { HANDOFF_COMPACTION_PROMPT } from '../../shared/constants';
import type { AgentSessionType } from '../../shared/session-agents';

/** Headless one-shot invocations for each supported CLI. The prompt is fed via
 *  stdin to avoid ARG_MAX limits on long transcripts. CLIs without a known
 *  stable headless mode are omitted; the compactor falls through to one that
 *  is available. */
interface HeadlessInvocation {
  command: string;
  args: string[];
}

const HEADLESS_INVOCATIONS: Partial<Record<AgentSessionType, HeadlessInvocation>> = {
  claude: { command: 'claude', args: ['-p'] },
  codex: { command: 'codex', args: ['exec', '-'] },
};

/** Order tried by the compactor when the preferred CLI is unavailable.
 *  Claude first because `claude -p` is the most reliable headless mode. */
const FALLBACK_ORDER: AgentSessionType[] = ['claude', 'codex'];

/** Opus summarizing the upper end of a 1MB transcript can run ~60–90s; 60s would
 *  spuriously fail those calls. Closing the dialog still leaves the child running
 *  to completion (we don't currently signal cancel), so this is mainly an upper
 *  bound for a runaway invocation. */
const MAX_COMPACTION_MS = 120_000;

export interface CompactInput {
  transcript: string;
  /** CLI the compactor should try first. Typically the source or target session type. */
  preferCli?: AgentSessionType;
  /** Env overrides (e.g. HOME pointing at a non-default account). */
  env?: Record<string, string>;
}

export interface CompactResult {
  summary: string;
  /** Which CLI actually produced the summary (useful for logs/UI). */
  usedCli: AgentSessionType;
}

/** Run a headless one-shot invocation, piping prompt via stdin and resolving with
 *  stdout text. Rejects on non-zero exit, timeout, or spawn error. */
function runHeadless(
  invocation: HeadlessInvocation,
  prompt: string,
  env: Record<string, string>,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(invocation.command, invocation.args, {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      fn();
    };

    let killEscalation: NodeJS.Timeout | null = null;
    const timeout = setTimeout(() => {
      proc.kill('SIGTERM');
      // Belt-and-braces: if the child ignores SIGTERM, force-kill after a grace
      // period so we don't leak processes when this Promise has already rejected.
      killEscalation = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already exited */ }
      }, 5_000);
      settle(() => reject(new Error(`compactor: ${invocation.command} timed out after ${MAX_COMPACTION_MS}ms`)));
    }, MAX_COMPACTION_MS);

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString('utf-8'); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString('utf-8'); });
    proc.on('error', (err) => {
      clearTimeout(timeout);
      if (killEscalation) clearTimeout(killEscalation);
      settle(() => reject(err));
    });
    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (killEscalation) clearTimeout(killEscalation);
      if (code === 0) {
        settle(() => resolve(stdout.trim()));
      } else {
        settle(() => reject(new Error(`compactor: ${invocation.command} exited ${code}: ${stderr.trim().slice(0, 500)}`)));
      }
    });

    // If the child exits before consuming stdin, end() emits EPIPE. Swallow it —
    // the 'close' handler above already surfaces a meaningful error from the exit code.
    proc.stdin.on('error', () => { /* drained via 'close' */ });
    proc.stdin.end(prompt);
  });
}

/** Build the ordered list of CLIs to try: preferred first (if it has a headless
 *  invocation), then the rest in fallback order, deduped. */
export function pickCompactorOrder(preferCli: AgentSessionType | undefined): AgentSessionType[] {
  const order: AgentSessionType[] = [];
  if (preferCli && HEADLESS_INVOCATIONS[preferCli]) order.push(preferCli);
  for (const cli of FALLBACK_ORDER) {
    if (!order.includes(cli) && HEADLESS_INVOCATIONS[cli]) order.push(cli);
  }
  return order;
}

/** Summarize a transcript by spawning a CLI in headless mode. Tries the preferred
 *  CLI first, then falls back through `FALLBACK_ORDER`. Throws if every candidate
 *  fails — the caller should surface the error so the user can choose
 *  full-transcript handoff instead. */
export async function compact(input: CompactInput): Promise<CompactResult> {
  if (!input.transcript.trim()) {
    throw new Error('compactor: transcript is empty');
  }

  const prompt = `${HANDOFF_COMPACTION_PROMPT}\n\n--- TRANSCRIPT ---\n${input.transcript}\n--- END TRANSCRIPT ---\n`;
  const env = input.env ?? {};
  const order = pickCompactorOrder(input.preferCli);

  if (order.length === 0) {
    throw new Error('compactor: no CLI with a known headless mode is available');
  }

  const errors: string[] = [];
  for (const cli of order) {
    const invocation = HEADLESS_INVOCATIONS[cli]!;
    try {
      const summary = await runHeadless(invocation, prompt, env);
      if (summary) {
        logger.info('handoff', 'Compaction succeeded', { cli, chars: summary.length });
        return { summary, usedCli: cli };
      }
      errors.push(`${cli}: empty output`);
    } catch (err) {
      errors.push(`${cli}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`compactor: all candidates failed — ${errors.join('; ')}`);
}
