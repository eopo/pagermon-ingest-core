import { describe, expect, it, vi } from 'vitest';

describe('index bootstrap', () => {
  it('starts runtime service with default adapter loader', async () => {
    vi.resetModules();

    const runService = vi.fn(() => Promise.resolve());
    vi.doMock('../../lib/runtime/service.js', () => ({ runService }));

    const createAdapter = vi.fn();
    vi.doMock('../../lib/runtime/adapter-loader.js', () => ({ createAdapter }));

    await import('../../index.js');

    expect(runService).toHaveBeenCalledTimes(1);
    expect(runService).toHaveBeenCalledWith({ adapterFactory: createAdapter });
  });
});
