import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promisify } from 'node:util';

// Create a hoisted mock for the promisified execFile function
const { mockExecFileAsync } = vi.hoisted(() => ({
  mockExecFileAsync: vi.fn(),
}));

vi.mock('node:child_process', () => {
  // Attach the custom promisify symbol so `promisify(execFile)` returns our mock
  const execFile = Object.assign(vi.fn(), {
    [promisify.custom]: mockExecFileAsync,
  });
  return { execFile };
});

vi.mock('../../../src/main/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { fetchCopilotBilling, parseBillingResponse } from '../../../src/main/copilot-billing-fetcher';

/**
 * Helper: queue sequential responses for ghExec calls.
 * Success: { stdout, stderr }. Failure: Error with optional .stderr property.
 */
function setExecSequence(...calls: Array<{ stdout: string; stderr: string } | Error>): void {
  for (const call of calls) {
    if (call instanceof Error) {
      mockExecFileAsync.mockRejectedValueOnce(call);
    } else {
      mockExecFileAsync.mockResolvedValueOnce(call);
    }
  }
}

describe('copilot-billing-fetcher', () => {
  beforeEach(() => {
    mockExecFileAsync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchCopilotBilling', () => {
    it('returns gh-not-installed when gh binary is missing', async () => {
      const err = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
      setExecSequence(err);

      const result = await fetchCopilotBilling(true);

      expect(result.billing).toBeNull();
      expect(result.error).toBe('gh-not-installed');
    });

    it('returns gh-not-authenticated when gh is not logged in', async () => {
      const err = Object.assign(new Error('gh: auth login required'), {
        stderr: 'gh: To get started with GitHub CLI, please run: gh auth login',
      });
      setExecSequence(err);

      const result = await fetchCopilotBilling(true);

      expect(result.billing).toBeNull();
      expect(result.error).toBe('gh-not-authenticated');
    });

    it('returns scope-missing when billing endpoint returns 404 with scope hint', async () => {
      const scopeErr = Object.assign(new Error('HTTP 404'), {
        stderr: 'gh: Not Found (HTTP 404)\ngh: This API operation needs the "user" scope. To request it, run:  gh auth refresh -h github.com -s user',
      });
      setExecSequence(
        { stdout: 'testuser\n', stderr: '' },
        scopeErr,
      );

      const result = await fetchCopilotBilling(true);

      expect(result.billing).toBeNull();
      expect(result.error).toBe('scope-missing');
    });

    it('returns billing data on success', async () => {
      const billingJson = JSON.stringify({
        usageItems: [
          { date: '2026-04-01', grossQuantity: 100, sku: 'copilot_pro' },
          { date: '2026-04-02', grossQuantity: 50, sku: 'copilot_pro' },
        ],
      });
      setExecSequence(
        { stdout: 'testuser\n', stderr: '' },
        { stdout: billingJson, stderr: '' },
      );

      const result = await fetchCopilotBilling(true);

      expect(result.error).toBeNull();
      expect(result.billing).toMatchObject({
        username: 'testuser',
        usedRequests: 150,
        limitRequests: 500,
        utilization: 30,
      });
    });

    it('returns api-error when response is unparseable', async () => {
      setExecSequence(
        { stdout: 'testuser\n', stderr: '' },
        { stdout: 'not json at all', stderr: '' },
      );

      const result = await fetchCopilotBilling(true);

      expect(result.billing).toBeNull();
      expect(result.error).toBe('api-error');
    });

    it('returns gh-not-authenticated when username is empty', async () => {
      setExecSequence({ stdout: '\n', stderr: '' });

      const result = await fetchCopilotBilling(true);

      expect(result.billing).toBeNull();
      expect(result.error).toBe('gh-not-authenticated');
    });
  });

  describe('parseBillingResponse', () => {
    it('parses usageItems array in object', () => {
      const raw = JSON.stringify({
        usageItems: [{ grossQuantity: 200, sku: 'copilot_pro' }],
      });

      const result = parseBillingResponse(raw, 'user1');

      expect(result).toMatchObject({
        username: 'user1',
        usedRequests: 200,
        limitRequests: 500,
        utilization: 40,
      });
    });

    it('parses usage_items (snake_case) array', () => {
      const raw = JSON.stringify({ usage_items: [{ quantity: 75 }] });

      const result = parseBillingResponse(raw, 'user1');

      expect(result).toMatchObject({ usedRequests: 75 });
    });

    it('parses raw array response', () => {
      const raw = JSON.stringify([{ grossQuantity: 30 }, { grossQuantity: 20 }]);

      const result = parseBillingResponse(raw, 'user1');

      expect(result).toMatchObject({ usedRequests: 50 });
    });

    it('returns zero utilization for empty items array', () => {
      const raw = JSON.stringify({ usageItems: [] });

      const result = parseBillingResponse(raw, 'user1');

      expect(result).toMatchObject({ usedRequests: 0, utilization: 0 });
    });

    it('returns null for invalid JSON', () => {
      expect(parseBillingResponse('{{bad', 'user1')).toBeNull();
    });

    it('returns null when no known array key found', () => {
      const raw = JSON.stringify({ unknownKey: [{ grossQuantity: 10 }] });

      expect(parseBillingResponse(raw, 'user1')).toBeNull();
    });

    it('uses explicit limit from items when available', () => {
      const raw = JSON.stringify({ usageItems: [{ grossQuantity: 300, limit: 1000 }] });

      const result = parseBillingResponse(raw, 'user1');

      expect(result).toMatchObject({
        usedRequests: 300,
        limitRequests: 1000,
        utilization: 30,
      });
    });

    it('infers enterprise limit from sku', () => {
      const raw = JSON.stringify({ usageItems: [{ grossQuantity: 500, sku: 'copilot_enterprise' }] });

      const result = parseBillingResponse(raw, 'user1');

      expect(result?.limitRequests).toBe(1000);
    });

    it('computes resetsAt as 1st of next month UTC', () => {
      const raw = JSON.stringify({ usageItems: [{ grossQuantity: 10 }] });

      const result = parseBillingResponse(raw, 'user1');

      expect(result?.resetsAt).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    });

    it('handles utilization exceeding 100% (overage)', () => {
      const raw = JSON.stringify({ usageItems: [{ grossQuantity: 750, sku: 'copilot_pro' }] });

      const result = parseBillingResponse(raw, 'user1');

      expect(result).toMatchObject({
        usedRequests: 750,
        limitRequests: 500,
        utilization: 150,
      });
    });
  });
});
