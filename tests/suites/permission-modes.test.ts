import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { PERMISSION_MODES } from '../../src/shared/constants';

describe('permission modes', () => {
  it('PERMISSION_MODES matches Claude CLI allowed choices', () => {
    // Run claude with an invalid mode to get the "Allowed choices" error
    let stderr: string;
    try {
      execSync('claude --permission-mode __invalid__ 2>&1', {
        encoding: 'utf-8',
        timeout: 10_000,
      });
      // If it somehow succeeds, skip this test
      return;
    } catch (err) {
      stderr = (err as { stdout?: string }).stdout ?? '';
      if (!stderr) {
        stderr = (err as { stderr?: string }).stderr ?? '';
      }
    }

    // Parse: "Allowed choices are acceptEdits, bypassPermissions, default, dontAsk, plan, auto."
    const match = stderr.match(/Allowed choices are ([^.]+)\./);
    expect(match, `Could not parse allowed choices from: ${stderr}`).toBeTruthy();

    const cliModes = match![1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // 'default' means "no flag passed" — we don't include it in PERMISSION_MODES
    const cliNonDefault = cliModes.filter((m) => m !== 'default');

    const ourModes = new Set(PERMISSION_MODES);
    const cliSet = new Set(cliNonDefault);

    // Check we aren't missing any CLI modes
    for (const mode of cliNonDefault) {
      expect(ourModes.has(mode as typeof PERMISSION_MODES[number]),
        `CLI has mode "${mode}" that is missing from PERMISSION_MODES`,
      ).toBe(true);
    }

    // Check we don't have extra modes the CLI doesn't support
    for (const mode of PERMISSION_MODES) {
      expect(cliSet.has(mode),
        `PERMISSION_MODES has "${mode}" that is not in CLI allowed choices`,
      ).toBe(true);
    }
  });
});
