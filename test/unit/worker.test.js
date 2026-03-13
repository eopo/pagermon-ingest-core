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

  const apiClients = {
    'target-a': {
      submitMessage: vi.fn(),
    },
    'target-b': {
      submitMessage: vi.fn(),
    },
  };

  const health = {
    isHealthy: true,
  };

  const healthByTarget = {
    'target-a': { isHealthy: true },
    'target-b': { isHealthy: true },
  };

  const targetNamesById = {
    'target-a': 'pm-prod-a',
    'target-b': 'pm-prod-b',
  };

  return {
    queue,
    apiClients,
    health,
    healthByTarget,
    targetNamesById,
    metrics: createMockMetrics(),
    startProcessing,
    closeFn,
  };
}

describe('Worker', () => {
  it('validates constructor config', () => {
    expect(() => new Worker({})).toThrow('Worker requires config.queue');
    expect(() => new Worker({ queue: {} })).toThrow('Worker requires config.apiClients');
    expect(() => new Worker({ queue: {}, apiClients: {} })).toThrow(
      'Worker requires config.healthByTarget or config.health'
    );
  });

  it('starts and registers queue processor', async () => {
    const { queue, apiClients, healthByTarget, targetNamesById, metrics, startProcessing } = createWorkerDeps();
    const worker = new Worker({ queue, apiClients, healthByTarget, targetNamesById, metrics });

    await worker.start();

    expect(worker.processing).toBe(true);
    expect(startProcessing).toHaveBeenCalledTimes(1);
  });

  it('emits processed callback on success', async () => {
    const { queue, apiClients, healthByTarget, targetNamesById, metrics } = createWorkerDeps();
    apiClients['target-a'].submitMessage.mockResolvedValue({ ok: true });

    const worker = new Worker({ queue, apiClients, healthByTarget, targetNamesById, metrics });
    // counter() is called twice in constructor (processedCounter, failedCounter)
    const processedCounter = metrics.counter.mock.results[0].value;
    const durationHistogram = metrics.histogram.mock.results[0].value;
    const lastMessageTimestamp = metrics.gauge.mock.results[0].value;
    const cb = vi.fn();
    worker.on('messageProcessed', cb);

    const result = await worker._processMessage({ id: '1', data: { address: '123', targetId: 'target-a' } });
    expect(result).toEqual({ ok: true });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(processedCounter.labels).toHaveBeenCalledWith({ status: 'success', target_name: 'pm-prod-a' });
    expect(processedCounter.inc).toHaveBeenCalledTimes(1);
    expect(durationHistogram.labels).toHaveBeenCalledWith({ status: 'success', target_name: 'pm-prod-a' });
    expect(durationHistogram.observe).toHaveBeenCalledTimes(1);
    expect(lastMessageTimestamp.labels).toHaveBeenCalledWith({ target_name: 'pm-prod-a' });
    expect(lastMessageTimestamp.set).toHaveBeenCalledTimes(1);
  });

  it('routes message by targetId when multiple targets are configured', async () => {
    const { queue, apiClients, healthByTarget, targetNamesById, metrics } = createWorkerDeps();
    apiClients['target-b'].submitMessage.mockResolvedValue({ ok: true });

    const worker = new Worker({ queue, apiClients, healthByTarget, targetNamesById, metrics });
    const result = await worker._processMessage({
      id: '1',
      data: { address: '123', targetId: 'target-b', source: 'x', timestamp: 1 },
    });

    expect(result).toEqual({ ok: true });
    expect(apiClients['target-b'].submitMessage).toHaveBeenCalledWith({
      address: '123',
      source: 'x',
      timestamp: 1,
    });
  });

  it('returns without throwing for non-retryable 4xx and emits failed callback', async () => {
    const { queue, apiClients, healthByTarget, targetNamesById, metrics } = createWorkerDeps();
    const clientError = new Error('404 not found');
    clientError.name = 'ApiError';
    clientError.statusCode = 404;
    clientError.retryable = false;
    apiClients['target-a'].submitMessage.mockRejectedValue(clientError);
    const worker = new Worker({ queue, apiClients, healthByTarget, targetNamesById, metrics });
    const failedCounter = metrics.counter.mock.results[1].value;
    const durationHistogram = metrics.histogram.mock.results[0].value;

    const cb = vi.fn();
    worker.on('messageFailed', cb);

    const result = await worker._processMessage({ id: '1', data: { address: '123', targetId: 'target-a' } });
    expect(result).toBeUndefined();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ retryable: false, statusCode: 404 }));
    expect(failedCounter.labels).toHaveBeenCalledWith({ reason: 'http_404', target_name: 'pm-prod-a' });
    expect(failedCounter.inc).toHaveBeenCalledTimes(1);
    expect(durationHistogram.labels).toHaveBeenCalledWith({ status: 'failure', target_name: 'pm-prod-a' });
    expect(durationHistogram.observe).toHaveBeenCalledTimes(1);
  });

  it('stops and closes queue', async () => {
    const { queue, apiClients, healthByTarget, targetNamesById, metrics, closeFn } = createWorkerDeps();
    const worker = new Worker({ queue, apiClients, healthByTarget, targetNamesById, metrics });

    await worker.stop();

    expect(worker.processing).toBe(false);
    expect(closeFn).toHaveBeenCalledTimes(1);
  });

  it('returns without throwing for authentication failures (non-retryable)', async () => {
    const { queue, apiClients, healthByTarget, targetNamesById, metrics } = createWorkerDeps();
    const authError = new Error('401 Unauthorized');
    authError.name = 'ApiError';
    authError.statusCode = 401;
    authError.retryable = false;
    apiClients['target-a'].submitMessage.mockRejectedValue(authError);
    const worker = new Worker({ queue, apiClients, healthByTarget, targetNamesById, metrics });

    const cb = vi.fn();
    worker.on('messageFailed', cb);

    const result = await worker._processMessage({ id: '1', data: { address: '123', targetId: 'target-a' } });
    expect(result).toBeUndefined();
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ retryable: false, statusCode: 401 }));
  });

  it('throws server-side failures for BullMQ retry with exponential backoff', async () => {
    const { queue, apiClients, healthByTarget, targetNamesById, metrics } = createWorkerDeps();
    const serverError = new Error('500 Internal Server Error');
    serverError.name = 'ApiError';
    serverError.statusCode = 500;
    serverError.retryable = true;
    apiClients['target-a'].submitMessage.mockRejectedValue(serverError);
    const worker = new Worker({ queue, apiClients, healthByTarget, targetNamesById, metrics });

    const cb = vi.fn();
    worker.on('messageFailed', cb);

    await expect(worker._processMessage({ id: '1', data: { address: '123', targetId: 'target-a' } })).rejects.toThrow(
      '500 Internal Server Error'
    );
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ retryable: true, statusCode: 500 }));
  });

  it('retries only unhealthy target jobs based on target-specific health state', async () => {
    const { queue, apiClients, healthByTarget, targetNamesById, metrics } = createWorkerDeps();
    apiClients['target-a'].submitMessage.mockResolvedValue({ ok: true });
    healthByTarget['target-b'].isHealthy = false;

    const worker = new Worker({ queue, apiClients, healthByTarget, targetNamesById, metrics });

    await expect(worker._processMessage({ id: '2', data: { address: '999', targetId: 'target-b' } })).rejects.toThrow(
      'API target unhealthy: target-b'
    );

    const result = await worker._processMessage({ id: '3', data: { address: '111', targetId: 'target-a' } });
    expect(result).toEqual({ ok: true });
  });
});
