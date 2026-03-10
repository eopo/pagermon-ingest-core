import { describe, expect, it, vi } from 'vitest';

describe('bootstrapWithAdapter', () => {
  it('passes adapter class as factory to runService', async () => {
    vi.resetModules();

    const runService = vi.fn(() => Promise.resolve());
    vi.doMock('../../lib/runtime/service.js', () => ({ runService }));

    class TestAdapter {
      constructor(config) {
        this.config = config;
      }

      getName() {
        return 'test-adapter';
      }

      start() {}

      stop() {}

      isRunning() {
        return false;
      }
    }

    const { bootstrapWithAdapter } = await import('../../bootstrap.js');
    await bootstrapWithAdapter(TestAdapter);

    expect(runService).toHaveBeenCalledTimes(1);
    const [{ adapterFactory }] = runService.mock.calls[0];
    const instance = await adapterFactory({ x: 1 });
    expect(instance).toBeInstanceOf(TestAdapter);
    expect(instance.config.x).toBe(1);
  });

  it('throws for invalid adapter input', async () => {
    vi.resetModules();

    const { bootstrapWithAdapter } = await import('../../bootstrap.js');
    expect(() => bootstrapWithAdapter(null)).toThrow('requires an adapter class/constructor');
  });
});
