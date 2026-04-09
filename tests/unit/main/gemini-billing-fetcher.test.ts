import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'node:util';

// Mock fs/promises for reading oauth_creds.json
const { mockReadFile } = vi.hoisted(() => ({
  mockReadFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: mockReadFile,
}));

// Mock child_process for Keychain access
const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}));

vi.mock('node:child_process', () => {
  const execFile = Object.assign(vi.fn(), {
    [promisify.custom]: mockExecFileAsync,
  });
  return { execFile };
});

vi.mock('../../../src/main/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock global fetch
const mockFetchFn = vi.fn();
vi.stubGlobal('fetch', mockFetchFn);

import { fetchGeminiBilling, _resetCaches } from '../../../src/main/gemini-billing-fetcher';
import type { AccountProfile } from '../../../src/shared/types';

const TEST_ACCOUNT: AccountProfile = {
  accountId: 'test-acct',
  name: 'Test Account',
  isDefault: true,
  homeDir: null,
  createdAt: '2026-01-01T00:00:00Z',
  lastUsedAt: null,
};

const OAUTH_CREDS = JSON.stringify({
  access_token: 'old-access-token',
  refresh_token: 'test-refresh-token',
  token_type: 'Bearer',
  expiry_date: 0,
});

function mockTokenRefreshResponse(accessToken: string): Response {
  return new Response(JSON.stringify({ access_token: accessToken }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockLoadCodeAssistResponse(projectId: string): Response {
  return new Response(JSON.stringify({ cloudaicompanionProject: projectId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mockQuotaResponse(buckets: Array<{
  modelId: string;
  remainingFraction: number;
  resetTime?: string;
}>): Response {
  return new Response(JSON.stringify({ buckets }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('gemini-billing-fetcher', () => {
  beforeEach(() => {
    mockReadFile.mockReset();
    mockFetchFn.mockReset();
    mockExecFileAsync.mockReset();
    _resetCaches();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when oauth_creds.json is missing', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const result = await fetchGeminiBilling(TEST_ACCOUNT, true);

    expect(result).toBeNull();
    expect(mockFetchFn).not.toHaveBeenCalled();
  });

  it('returns null when refresh_token is missing from creds', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ access_token: 'tok' }));

    const result = await fetchGeminiBilling(TEST_ACCOUNT, true);

    expect(result).toBeNull();
  });

  it('returns null when token refresh fails', async () => {
    mockReadFile.mockResolvedValue(OAUTH_CREDS);
    mockFetchFn.mockResolvedValueOnce(new Response('', { status: 401 }));

    const result = await fetchGeminiBilling(TEST_ACCOUNT, true);

    expect(result).toBeNull();
  });

  it('returns null when loadCodeAssist fails', async () => {
    mockReadFile.mockResolvedValue(OAUTH_CREDS);
    mockFetchFn
      .mockResolvedValueOnce(mockTokenRefreshResponse('new-token'))
      .mockResolvedValueOnce(new Response('', { status: 500 }));

    const result = await fetchGeminiBilling(TEST_ACCOUNT, true);

    expect(result).toBeNull();
  });

  it('returns null when retrieveUserQuota fails', async () => {
    mockReadFile.mockResolvedValue(OAUTH_CREDS);
    mockFetchFn
      .mockResolvedValueOnce(mockTokenRefreshResponse('new-token'))
      .mockResolvedValueOnce(mockLoadCodeAssistResponse('projects/my-project'))
      .mockResolvedValueOnce(new Response('', { status: 429 }));

    const result = await fetchGeminiBilling(TEST_ACCOUNT, true);

    expect(result).toBeNull();
  });

  it('fetches quota buckets successfully', async () => {
    mockReadFile.mockResolvedValue(OAUTH_CREDS);
    mockFetchFn
      .mockResolvedValueOnce(mockTokenRefreshResponse('new-token'))
      .mockResolvedValueOnce(mockLoadCodeAssistResponse('projects/my-project'))
      .mockResolvedValueOnce(mockQuotaResponse([
        { modelId: 'gemini-2.5-pro', remainingFraction: 0.8, resetTime: '2026-04-10T00:00:00Z' },
        { modelId: 'gemini-2.5-flash', remainingFraction: 0.6 },
      ]));

    const result = await fetchGeminiBilling(TEST_ACCOUNT, true);

    expect(result).not.toBeNull();
    expect(result!.buckets).toHaveLength(2);
    expect(result!.buckets[0]).toEqual({
      modelId: 'gemini-2.5-pro',
      remainingFraction: 0.8,
      resetTime: '2026-04-10T00:00:00Z',
    });
    expect(result!.buckets[1]).toEqual({
      modelId: 'gemini-2.5-flash',
      remainingFraction: 0.6,
      resetTime: null,
    });
    expect(result!.fetchedAt).toBeDefined();
  });

  it('calls correct endpoints with correct auth headers', async () => {
    mockReadFile.mockResolvedValue(OAUTH_CREDS);
    mockFetchFn
      .mockResolvedValueOnce(mockTokenRefreshResponse('fresh-token'))
      .mockResolvedValueOnce(mockLoadCodeAssistResponse('projects/p1'))
      .mockResolvedValueOnce(mockQuotaResponse([]));

    await fetchGeminiBilling(TEST_ACCOUNT, true);

    // Token refresh call
    expect(mockFetchFn).toHaveBeenNthCalledWith(1,
      'https://oauth2.googleapis.com/token',
      expect.objectContaining({ method: 'POST' }),
    );

    // loadCodeAssist call with bearer token
    expect(mockFetchFn).toHaveBeenNthCalledWith(2,
      'https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
      }),
    );

    // retrieveUserQuota call
    expect(mockFetchFn).toHaveBeenNthCalledWith(3,
      'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer fresh-token' }),
      }),
    );
  });

  it('falls back to macOS Keychain when file is missing (darwin only)', async () => {
    // Simulate darwin platform
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    // File read fails
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    // Keychain returns creds
    mockExecFileAsync.mockResolvedValueOnce({ stdout: OAUTH_CREDS, stderr: '' });
    mockFetchFn
      .mockResolvedValueOnce(mockTokenRefreshResponse('kc-token'))
      .mockResolvedValueOnce(mockLoadCodeAssistResponse('projects/kc'))
      .mockResolvedValueOnce(mockQuotaResponse([
        { modelId: 'gemini-2.5-pro', remainingFraction: 0.9 },
      ]));

    const result = await fetchGeminiBilling(TEST_ACCOUNT, true);

    expect(result).not.toBeNull();
    expect(result!.buckets[0].modelId).toBe('gemini-2.5-pro');
    expect(mockExecFileAsync).toHaveBeenCalledWith('security', [
      'find-generic-password', '-s', 'gemini-cli-oauth', '-a', 'main-account', '-w',
    ]);

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('filters out buckets without modelId or remainingFraction', async () => {
    mockReadFile.mockResolvedValue(OAUTH_CREDS);
    mockFetchFn
      .mockResolvedValueOnce(mockTokenRefreshResponse('tok'))
      .mockResolvedValueOnce(mockLoadCodeAssistResponse('projects/p'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        buckets: [
          { modelId: 'gemini-2.5-pro', remainingFraction: 0.5 },
          { remainingFraction: 0.5 },           // missing modelId
          { modelId: 'gemini-2.5-flash' },       // missing remainingFraction
          {},                                     // empty
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

    const result = await fetchGeminiBilling(TEST_ACCOUNT, true);

    expect(result!.buckets).toHaveLength(1);
    expect(result!.buckets[0].modelId).toBe('gemini-2.5-pro');
  });
});
