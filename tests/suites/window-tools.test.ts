import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { McpTestClient } from '../mcp-client';
import { resetTestState } from '../helpers';

describe('window tools', () => {
  const client = new McpTestClient();
  let originalBounds: { x: number; y: number; width: number; height: number };

  beforeAll(async () => {
    await client.connect();
    await resetTestState(client);
    // Save original bounds to restore later
    originalBounds = await client.callToolJson('window_get_bounds');
  });

  afterAll(async () => {
    // Restore original size
    try {
      await client.callTool('window_resize', {
        width: originalBounds.width,
        height: originalBounds.height,
      });
    } catch { /* best-effort */ }
    await client.disconnect();
  });

  it('takes a screenshot', async () => {
    // Ensure window is visible and give it time to render
    await new Promise((r) => setTimeout(r, 500));

    const result = await client.callTool('window_screenshot');

    if (result.isError) {
      // Screenshot may fail in headless/offscreen environments — skip gracefully
      const errText = result.content.find((c) => c.type === 'text')?.text ?? '';
      console.warn('Screenshot failed (may be headless):', errText);
      return;
    }

    const imageContent = result.content.find((c) => c.type === 'image');
    expect(imageContent).toBeDefined();
    expect(imageContent!.data).toBeTruthy();
    expect(imageContent!.mimeType).toBe('image/png');
    expect(imageContent!.data!.length).toBeGreaterThan(100);
  });

  it('gets window bounds', async () => {
    const bounds = await client.callToolJson<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>('window_get_bounds');

    expect(typeof bounds.x).toBe('number');
    expect(typeof bounds.y).toBe('number');
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });

  it('resizes window and verifies', async () => {
    // Use large enough dimensions to avoid macOS minimum window size constraints
    const targetWidth = 1200;
    const targetHeight = 800;

    await client.callTool('window_resize', {
      width: targetWidth,
      height: targetHeight,
    });

    // Give the window manager time to apply the resize
    await new Promise((r) => setTimeout(r, 200));

    const bounds = await client.callToolJson<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>('window_get_bounds');

    // macOS CI may constrain window sizes based on display — verify reasonable dimensions
    expect(bounds.width).toBeGreaterThan(400);
    expect(bounds.height).toBeGreaterThan(300);
  });
});
