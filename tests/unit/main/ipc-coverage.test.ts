import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Coverage test for IPC contracts ↔ handler registration.
 *
 * Locks in the convention introduced when IPC was consolidated under
 * src/main/ipc/. Every channel declared in src/shared/ipc-contract-*.ts must
 * have a matching `typedHandle`/`typedOn` call in src/main/ipc/, and no other
 * file in src/main/ may call ipcMain.handle / ipcMain.on directly.
 *
 * Static analysis (regex) is intentional — runtime mocking would require
 * stubbing the entire main-process service graph and is far more fragile.
 */

const REPO_ROOT = join(__dirname, '../../..');
const CONTRACTS_DIR = join(REPO_ROOT, 'src/shared');
const IPC_DIR = join(REPO_ROOT, 'src/main/ipc');
const MAIN_DIR = join(REPO_ROOT, 'src/main');

interface ContractChannels {
  invoke: Set<string>;
  send: Set<string>;
  push: Set<string>;
}

function readContractFile(path: string): ContractChannels {
  const src = readFileSync(path, 'utf-8');
  const lines = src.split('\n');
  const result: ContractChannels = { invoke: new Set(), send: new Set(), push: new Set() };

  let currentKind: 'invoke' | 'send' | 'push' | null = null;
  let depth = 0;

  for (const line of lines) {
    // Track which interface block we're inside.
    const interfaceMatch = line.match(/^\s*export\s+interface\s+\w*(Invoke|Send|Push)Contract\b/);
    if (interfaceMatch) {
      currentKind = interfaceMatch[1].toLowerCase() as 'invoke' | 'send' | 'push';
      depth = 0;
    }

    // Crude brace tracking to know when the interface ends.
    if (currentKind) {
      for (const ch of line) {
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) currentKind = null;
        }
      }

      if (currentKind && depth > 0) {
        // Match  'channel:name': { params: ... }
        const channelMatch = line.match(/^\s*'([\w:-]+)'\s*:\s*\{/);
        if (channelMatch) {
          result[currentKind].add(channelMatch[1]);
        }
      }
    }
  }

  return result;
}

function collectAllContracts(): ContractChannels {
  const combined: ContractChannels = { invoke: new Set(), send: new Set(), push: new Set() };
  for (const entry of readdirSync(CONTRACTS_DIR)) {
    if (!entry.startsWith('ipc-contract-') || !entry.endsWith('.ts')) continue;
    const file = readContractFile(join(CONTRACTS_DIR, entry));
    file.invoke.forEach((c) => combined.invoke.add(c));
    file.send.forEach((c) => combined.send.add(c));
    file.push.forEach((c) => combined.push.add(c));
  }
  return combined;
}

interface HandlerRegistrations {
  handles: Set<string>;
  ons: Set<string>;
}

function collectAllHandlers(): HandlerRegistrations {
  const handles = new Set<string>();
  const ons = new Set<string>();
  for (const entry of readdirSync(IPC_DIR)) {
    if (!entry.endsWith('-ipc.ts')) continue;
    const src = readFileSync(join(IPC_DIR, entry), 'utf-8');
    for (const m of src.matchAll(/\btypedHandle\(\s*'([\w:-]+)'/g)) handles.add(m[1]);
    for (const m of src.matchAll(/\btypedOn\(\s*'([\w:-]+)'/g)) ons.add(m[1]);
  }
  return { handles, ons };
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else if (entry.isFile() && entry.name.endsWith('.ts')) yield path;
  }
}

describe('IPC contract ↔ handler coverage', () => {
  const contracts = collectAllContracts();
  const handlers = collectAllHandlers();

  it('every invoke channel in contracts has a typedHandle in src/main/ipc/', () => {
    const missing = [...contracts.invoke].filter((c) => !handlers.handles.has(c)).sort();
    expect(missing, `Invoke channels declared but not handled: ${missing.join(', ')}`).toEqual([]);
  });

  it('every send channel in contracts has a typedOn in src/main/ipc/', () => {
    const missing = [...contracts.send].filter((c) => !handlers.ons.has(c)).sort();
    expect(missing, `Send channels declared but not handled: ${missing.join(', ')}`).toEqual([]);
  });

  it('every typedHandle call matches a declared invoke channel', () => {
    const extra = [...handlers.handles].filter((c) => !contracts.invoke.has(c)).sort();
    expect(extra, `Handlers registered for undeclared invoke channels: ${extra.join(', ')}`).toEqual([]);
  });

  it('every typedOn call matches a declared send channel', () => {
    const extra = [...handlers.ons].filter((c) => !contracts.send.has(c)).sort();
    expect(extra, `Handlers registered for undeclared send channels: ${extra.join(', ')}`).toEqual([]);
  });

  it('no file outside src/main/ipc/ calls ipcMain.handle or ipcMain.on', () => {
    const offenders: string[] = [];
    for (const path of walk(MAIN_DIR)) {
      // Allowed: ipc-helpers.ts is the one place that wraps ipcMain.handle/on.
      if (path.endsWith('/ipc-helpers.ts')) continue;
      // Allowed: anything inside src/main/ipc/ (handlers use the typed wrappers).
      if (path.includes(`${IPC_DIR}/`) || path === IPC_DIR) continue;
      const src = readFileSync(path, 'utf-8');
      if (/\bipcMain\.(handle|on)\b/.test(src)) {
        offenders.push(path.slice(REPO_ROOT.length + 1));
      }
    }
    expect(offenders, `IPC registrations must live in src/main/ipc/. Offenders: ${offenders.join(', ')}`).toEqual([]);
  });

  it('found a non-trivial number of channels (sanity check parser)', () => {
    // If the regex breaks silently and parses zero, the assertions above pass vacuously.
    expect(contracts.invoke.size).toBeGreaterThan(20);
    expect(handlers.handles.size).toBeGreaterThan(20);
  });
});
