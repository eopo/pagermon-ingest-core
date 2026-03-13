import { describe, expect, it, vi } from 'vitest';
import Worker from '../../lib/core/Worker.js';
import { createMockMetrics } from '../helpers/metrics.js';

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

  return { queue, apiClient, health, metrics: createMockMetrics(), startProcessing, closeFn };
}

describe('Worker', () => {
  it('validates constructor config', () => {
    expect(() => new Worker({})).toThrow('Worker requires config.queue');
    expect(() => new Worker({ queue: {} })).toThrow('Worker requires config.apiClient');
    expect(() => new Worker({ queue: {}, apiClient: {} })).toThrow('Worker requires config.health');
  });

  it('starts and registers queue processor', async () => {
    const { queue, apiClient, health, metrics, startProcessing } = createWorkerDeps();
    const worker = new Worker({ queue, apiClient, health, metrics });

    await worker.start();

    expect(worker.processing).toBe(true);
    expect(startProcessing).toHaveBeenCalledTimes(1);
  });

  it('emits processed callback on success', async () => {
    const { queue, apiClient, health, metrics } = createWorkerDeps();
    apiClient.submitMessage.mockResolvedValue({ ok: true });

    const worker = new Worker({ queue, apiClient, health, metrics });
    // counter() is called twice in constructor (processedCounter, failedCounter)
    const processedCounter = metrics.counter.mock.results[0].value;
    const cb = vi.fn();
    worker.on('messageProcessed', cb);

    const result = await worker._processMessage({ id: '1', data: { address: '123' } });
    expect(result).toEqual({ ok: true });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(processedCounter.labels).toHaveBeenCalledWith({ status: 'success' });
    expect(processedCounter.inc).toHaveBeenCalledTimes(1);
  });

  it('throws when API unhealthy', async () => {
    const { queue, apiClient, health, metrics } = createWorkerDeps();
    apiClient.submitMessage.mockRejectedValue(new Error('500 error'));
    health.isHealthy = false;

    const worker = new Worker({ queue, apiClient, health, metrics });
    await expect(worker._processMessage({ id: '1', data: { address: '123' } })).rejects.toThrow('API unhealthy');
  });

  it('returns without throwing for non-retryable 4xx and emits failed callback', async () => {
    const { queue, apiClient, health, metrics } = createWorkerDeps();
    const clientError = new Error('404 not found');
    clientError.name = 'ApiError';
    clientError.statusCode = 404;
    clientError.retryable = false;
    apiClient.submitMessage.mockRejectedValue(clientError);
    const worker = new Worker({ queue, apiClient, health, metrics });

    const cb = vi.fn();
    worker.on('messageFailed', cb);

    const result = await worker._processMessage({ id: '1', data: { address: '123' } });
    expect(result).toBeUndefined();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ retryable: false, statusCode: 404 }));
  });

  it('stops and closes queue', async () => {
    const { queue, apiClient, health, metrics, closeFn } = createWorkerDeps();
    const worker = new Worker({ queue, apiClient, health, metrics });

    await worker.stop();

    expect(worker.processing).toBe(false);
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it('returns without throwing for authentication failures (non-retryable)', async () => {
    const { queue, apiClient, health, metrics } = createWorkerDeps();
    const authError = new Error('401 Unauthorized');
    authError.name = 'ApiError';
    authError.statusCode = 401;
    authError.retryable = false;
    apiClient.submitMessage.mockRejectedValue(authError);
    const worker = new Worker({ queue, apiClient, health, metrics });

    const cb = vi.fn();
    worker.on('messageFailed', cb);

    const result = await worker._processMessage({ id: '1', data: { address: '123' } });
    expect(result).toBeUndefined();
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ retryable: false, statusCode: 401 }));
  });

  it('throws server-side failures for BullMQ retry with exponential backoff', async () => {
    const { queue, apiClient, health, metrics } = createWorkerDeps();
    const serverError = new Error('500 Internal Server Error');
    serverError.name = 'ApiError';
    serverError.statusCode = 500;
    serverError.retryable = true;
    apiClient.submitMessage.mockRejectedValue(serverError);
    const worker = new Worker({ queue, apiClient, health, metrics });

    const cb = vi.fn();
    worker.on('messageFailed', cb);

    await expect(worker._processMessage({ id: '1', data: { address: '123' } })).rejects.toThrow(
      '500 Internal Server Error'
    );
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ retryable: true, statusCode: 500 }));
  });
});
