import { describe, expect, it, vi } from 'vitest';
import Worker from '../../lib/core/Worker.js';

function createWorkerDeps() {
  const startProcessing = vi.fn();
  const closeFn = vi.fn().mockResolvedValue(undefined);

  const queue = {
    queue: {},
    startProcessing,
    close: closeFn,
    initialize: vi.fn().mockResolvedValue(undefined),
  };

  const apiClient = {
    submitMessage: vi.fn(),
  };

  const health = {
    isHealthy: true,
  };

  return { queue, apiClient, health, startProcessing, closeFn };
}

describe('Worker', () => {
  it('validates constructor config', () => {
    expect(() => new Worker({})).toThrow('Worker requires config.queue');
    expect(() => new Worker({ queue: {} })).toThrow('Worker requires config.apiClient');
    expect(() => new Worker({ queue: {}, apiClient: {} })).toThrow('Worker requires config.health');
  });

  it('starts and registers queue processor', async () => {
    const { queue, apiClient, health, startProcessing } = createWorkerDeps();
    const worker = new Worker({ queue, apiClient, health });

    await worker.start();

    expect(worker.processing).toBe(true);
    expect(startProcessing).toHaveBeenCalledTimes(1);
  });

  it('emits processed callback on success', async () => {
    const { queue, apiClient, health } = createWorkerDeps();
    apiClient.submitMessage.mockResolvedValue({ success: true, data: { ok: true } });

    const worker = new Worker({ queue, apiClient, health });
    const cb = vi.fn();
    worker.on('messageProcessed', cb);

    const result = await worker._processMessage({ id: '1', data: { address: '123' } });
    expect(result.success).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('throws when API unhealthy', async () => {
    const { queue, apiClient, health } = createWorkerDeps();
    apiClient.submitMessage.mockResolvedValue({ success: false, error: '500 error' });
    health.isHealthy = false;

    const worker = new Worker({ queue, apiClient, health });
    await expect(worker._processMessage({ id: '1', data: { address: '123' } })).rejects.toThrow('API unhealthy');
  });

  it('returns soft failure for non-retryable 4xx and emits failed callback', async () => {
    const { queue, apiClient, health } = createWorkerDeps();
    apiClient.submitMessage.mockResolvedValue({ success: false, error: '404 not found' });
    const worker = new Worker({ queue, apiClient, health });

    const cb = vi.fn();
    worker.on('messageFailed', cb);

    const result = await worker._processMessage({ id: '1', data: { address: '123' } });
    expect(result.failed).toBe(true);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('stops and closes queue', async () => {
    const { queue, apiClient, health, closeFn } = createWorkerDeps();
    const worker = new Worker({ queue, apiClient, health });

    await worker.stop();

    expect(worker.processing).toBe(false);
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it('throws authentication failures for retry policy handling', async () => {
    const { queue, apiClient, health } = createWorkerDeps();
    apiClient.submitMessage.mockResolvedValue({ success: false, error: '401 Unauthorized' });
    const worker = new Worker({ queue, apiClient, health });

    await expect(worker._processMessage({ id: '1', data: { address: '123' } })).rejects.toThrow(
      'API Authentication failed - will not retry'
    );
  });

  it('throws server-side failures for queue retry', async () => {
    const { queue, apiClient, health } = createWorkerDeps();
    apiClient.submitMessage.mockResolvedValue({ success: false, error: '500 Internal Server Error' });
    const worker = new Worker({ queue, apiClient, health });

    await expect(worker._processMessage({ id: '1', data: { address: '123' } })).rejects.toThrow(
      '500 Internal Server Error'
    );
  });
});
