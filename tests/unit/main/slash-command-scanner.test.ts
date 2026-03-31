import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanSlashCommands } from '../../../src/main/slash-command-scanner';

describe('slash-command-scanner', () => {
  let tempRoot: string;
  let previousHome: string | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'mcode-slash-commands-'));
    previousHome = process.env.HOME;
    process.env.HOME = tempRoot;
  });

  afterEach(async () => {
    process.env.HOME = previousHome;
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('loads Claude built-ins and lets user/project commands override them', async () => {
    const cwd = join(tempRoot, 'workspace');
    await mkdir(join(tempRoot, '.claude', 'commands'), { recursive: true });
    await mkdir(join(cwd, '.claude', 'commands'), { recursive: true });

    await writeFile(
      join(tempRoot, '.claude', 'commands', 'review.md'),
      '# Global review command\n\nUse the team review checklist.',
    );
    await writeFile(
      join(cwd, '.claude', 'commands', 'clear.md'),
      '# Project clear command\n\nReset project-specific context.',
    );

    const commands = await scanSlashCommands('claude', cwd);

    expect(commands.find((cmd) => cmd.name === 'review')).toEqual({
      name: 'review',
      description: 'Global review command',
      source: 'user',
    });
    expect(commands.find((cmd) => cmd.name === 'clear')).toEqual({
      name: 'clear',
      description: 'Project clear command',
      source: 'project',
    });
    expect(commands.find((cmd) => cmd.name === 'compact')?.source).toBe('builtin');
  });

  it('loads Gemini recursive TOML commands with colon namespaces', async () => {
    const cwd = join(tempRoot, 'workspace');
    await mkdir(join(tempRoot, '.gemini', 'commands', 'git'), { recursive: true });
    await mkdir(join(cwd, '.gemini', 'commands'), { recursive: true });

    await writeFile(
      join(tempRoot, '.gemini', 'commands', 'git', 'commit.toml'),
      'description = "Create a polished commit message"\nprompt = "Write a commit message"',
    );
    await writeFile(
      join(cwd, '.gemini', 'commands', 'deploy.toml'),
      'description = "Prepare a deployment checklist"\nprompt = "List deployment steps"',
    );

    const commands = await scanSlashCommands('gemini', cwd);

    expect(commands.find((cmd) => cmd.name === 'git:commit')).toEqual({
      name: 'git:commit',
      description: 'Create a polished commit message',
      source: 'user',
    });
    expect(commands.find((cmd) => cmd.name === 'deploy')).toEqual({
      name: 'deploy',
      description: 'Prepare a deployment checklist',
      source: 'project',
    });
    expect(commands.find((cmd) => cmd.name === 'commands')?.source).toBe('builtin');
  });

  it('uses agent-specific sources so Claude custom commands do not leak into Copilot', async () => {
    const cwd = join(tempRoot, 'workspace');
    await mkdir(join(tempRoot, '.claude', 'commands'), { recursive: true });
    await writeFile(
      join(tempRoot, '.claude', 'commands', 'review.md'),
      '# Claude-only review override',
    );

    const commands = await scanSlashCommands('copilot', cwd);

    expect(commands.some((cmd) => cmd.name === 'review' && cmd.source === 'user')).toBe(false);
    expect(commands.find((cmd) => cmd.name === 'review')?.source).toBe('builtin');
    expect(commands.find((cmd) => cmd.name === 'help')?.source).toBe('builtin');
  });
});
