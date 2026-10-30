import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockLogger, createMockMetrics } from '../helpers/index.js';

const queueInstances = [];
const workerInstances = [];
const redisInstances = [];

vi.mock('bullmq', () => {
  class QueueMock {
    constructor(name, options) {
      this.name = name;
      this.options = options;
      this.add = vi.fn((_type, payload) => Promise.resolve({ id: 'job-1', data: payload }));
      this.getJobs = vi.fn(() => Promise.resolve([]));
      this.getJob = vi.fn(() => Promise.resolve(null));
      this.count = vi.fn(() => Promise.resolve(3));
      this.close = vi.fn(() => Promise.resolve());
      queueInstances.push(this);
    }
  }

  class WorkerMock {
    constructor(name, processor, options) {
      this.name = name;
      this.processor = processor;
      this.options = options;
      this.handlers = {};
      this.on = vi.fn((event, cb) => {
        this.handlers[event] = cb;
      });
      this.close = vi.fn(() => Promise.resolve());
      workerInstances.push(this);
    }
  }

  return {
    Queue: QueueMock,
    Worker: WorkerMock,
  };
});

vi.mock('ioredis', () => {
  return {
    default: class IORedisMock {
      constructor(url, options) {
        this.url = url;
        this.options = options;
        this.quit = vi.fn(() => Promise.resolve());
        this.workerConn = {
          quit: vi.fn(() => Promise.resolve()),
        };
        redisInstances.push(this);
      }

      duplicate() {
        return this.workerConn;
      }
    },
  };
});

import QueueManager from '../../lib/core/QueueManager.js';

describe('QueueManager', () => {
  beforeEach(() => {
    queueInstances.length = 0;
    workerInstances.length = 0;
    redisInstances.length = 0;
  });

  it('validates redisUrl', () => {
    expect(() => new QueueManager({})).toThrow('QueueManager requires config.redisUrl');
  });

  it('validates metrics', () => {
    expect(() => new QueueManager({ redisUrl: 'redis://localhost:6379' })).toThrow(
      'QueueManager requires options.metrics'
    );
  });

  it('initializes the queue with durable failed-job retention', () => {
    const manager = new QueueManager(
      { redisUrl: 'redis://localhost:6379' },
      { metrics: createMockMetrics(), recoveryBatchSize: 2 }
    );
    manager.initialize();

    expect(redisInstances).toHaveLength(1);
    expect(queueInstances).toHaveLength(1);
    expect(queueInstances[0].name).toBe('sdr-messages');
    expect(queueInstances[0].options.defaultJobOptions.removeOnFail).toBe(false);
  });

  it('adds message with Message-like payload and builds deterministic job id', async () => {
    const metrics = createMockMetrics();
    const manager = new QueueManager({ redisUrl: 'redis://localhost:6379' }, { queueName: 'test-q', metrics });
    manager.initialize();
    const enqueuedCounter = metrics.counter.mock.results[0].value;
    const queueDepthGauge = metrics.gauge.mock.results[0].value;

    const payload = { source: 'rx1', address: '12345', timestamp: 1710000000, targetId: 'target-2' };
    await manager.addMessage({ toPayload: () => payload });

    expect(queueInstances[0].add).toHaveBeenCalledWith('message', payload, {
      jobId: 'msg-target-2-rx1-12345-1710000000',
    });
    expect(enqueuedCounter.inc).toHaveBeenCalledTimes(1);
    expect(queueDepthGauge.inc).toHaveBeenCalledTimes(1);
  });

  it('throws when adding before initialize', async () => {
    const manager = new QueueManager({ redisUrl: 'redis://localhost:6379' }, { metrics: createMockMetrics() });
    await expect(manager.addMessage({})).rejects.toThrow('Queue not initialized');
  });

  it('retains failed jobs when automatic DLQ recovery is disabled', async () => {
    const manager = new QueueManager(
      { redisUrl: 'redis://localhost:6379' },
      { enableDLQ: false, metrics: createMockMetrics() }
    );
    manager.initialize();

    const jobs = await manager.getDeadLetters(10);
    expect(jobs).toEqual([]);
    await expect(manager.recoverFailedJobs('target-a')).resolves.toBe(0);
  });

  it('maps dead letter jobs with limit handling', async () => {
    const manager = new QueueManager({ redisUrl: 'redis://localhost:6379' }, { metrics: createMockMetrics() });
    manager.initialize();

    queueInstances[0].getJobs.mockResolvedValue([
      {
        id: 'a',
        data: { x: 1, __ingestCoreFailure: { retryable: false } },
        failedReason: 'boom',
        attemptsMade: 2,
      },
    ]);

    const jobs = await manager.getDeadLetters(0);
    expect(queueInstances[0].getJobs).not.toHaveBeenCalled();
    expect(jobs).toEqual([]);

    const deadLetters = await manager.getDeadLetters(10);
    expect(queueInstances[0].getJobs).toHaveBeenCalledWith(['failed'], 0, 9);
    expect(deadLetters).toEqual([
      {
        id: 'a',
        data: { x: 1 },
        failedReason: 'boom',
        attemptsMade: 2,
        targetId: 'default',
        retryable: false,
      },
    ]);
  });

  it('replays only retryable failed jobs for the requested target', async () => {
    const manager = new QueueManager({ redisUrl: 'redis://localhost:6379' }, { metrics: createMockMetrics() });
    manager.initialize();
    const retryA = vi.fn();
    const retryAuth = vi.fn();
    const retryB = vi.fn();
    queueInstances[0].getJobs.mockResolvedValue([
      { id: 'a', data: { targetId: 'target-a' }, retry: retryA },
      { id: 'b', data: { targetId: 'target-b' }, retry: retryB },
      {
        id: 'auth',
        data: { targetId: 'target-a', __ingestCoreFailure: { retryable: false, statusCode: 401 } },
        retry: retryAuth,
      },
      {
        id: 'c',
        data: { targetId: 'target-a', __ingestCoreFailure: { retryable: false, statusCode: 400 } },
        retry: vi.fn(),
      },
    ]);

    await expect(manager.recoverFailedJobs('target-a')).resolves.toBe(2);
    expect(retryA).toHaveBeenCalledWith('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
    expect(retryAuth).toHaveBeenCalledWith('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
    expect(retryB).not.toHaveBeenCalled();
    expect(queueInstances[0].getJobs).toHaveBeenCalledWith(['failed'], 0, 99);
  });

  it('manually retries a retained failed job by its existing ID', async () => {
    const manager = new QueueManager({ redisUrl: 'redis://localhost:6379' }, { metrics: createMockMetrics() });
    manager.initialize();
    const retry = vi.fn();
    queueInstances[0].getJob.mockResolvedValue({
      id: 'job-1',
      getState: vi.fn(() => Promise.resolve('failed')),
      retry,
    });

    await expect(manager.retryDeadLetter('job-1')).resolves.toBe(true);
    expect(retry).toHaveBeenCalledWith('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
  });

  it('returns queue size 0 when queue is not initialized', async () => {
    const manager = new QueueManager({ redisUrl: 'redis://localhost:6379' }, { metrics: createMockMetrics() });
    await expect(manager.getQueueSize()).resolves.toBe(0);
  });

  it('does not retry a job that is no longer failed', async () => {
    const manager = new QueueManager({ redisUrl: 'redis://localhost:6379' }, { metrics: createMockMetrics() });
    manager.initialize();
    queueInstances[0].getJob.mockResolvedValue({
      getState: vi.fn(() => Promise.resolve('completed')),
      retry: vi.fn(),
    });

    await expect(manager.retryDeadLetter('job-1')).resolves.toBe(false);
  });

  it('requeues all retained failures without waiting for processing', async () => {
    const manager = new QueueManager(
      { redisUrl: 'redis://localhost:6379' },
      { metrics: createMockMetrics(), recoveryBatchSize: 2 }
    );
    manager.initialize();
    const retryJobs = ['first', 'second', 'third'].map((id) => ({
      id,
      getState: vi.fn(() => Promise.resolve('failed')),
      retry: vi.fn(() => Promise.resolve()),
    }));
    queueInstances[0].getJobs
      .mockResolvedValueOnce(retryJobs.slice(0, 2))
      .mockResolvedValueOnce(retryJobs.slice(2))
      .mockResolvedValueOnce([]);
    queueInstances[0].getJob.mockImplementation((id) => Promise.resolve(retryJobs.find((job) => job.id === id)));

    await expect(manager.retryFailedJobs()).resolves.toBe(3);
    expect(queueInstances[0].getJobs).toHaveBeenNthCalledWith(1, ['failed'], 0, 1);
    expect(queueInstances[0].getJobs).toHaveBeenNthCalledWith(2, ['failed'], 2, 3);
    expect(retryJobs.every((job) => job.retry.mock.calls.length === 1)).toBe(true);
  });

  it('requeues only failures matching error text, including permanent failures', async () => {
    const manager = new QueueManager(
      { redisUrl: 'redis://localhost:6379' },
      { metrics: createMockMetrics(), recoveryBatchSize: 2 }
    );
    manager.initialize();
    const unauthorizedJob = {
      id: 'auth',
      failedReason: 'UnrecoverableError: unauthorized credentials',
      data: { __ingestCoreFailure: { retryable: false, reason: '401 Unauthorized' } },
      getState: vi.fn(() => Promise.resolve('failed')),
      retry: vi.fn(() => Promise.resolve()),
    };
    const badPayloadJob = {
      id: 'payload',
      failedReason: 'UnrecoverableError: invalid payload',
      data: { __ingestCoreFailure: { retryable: false, reason: 'invalid payload' } },
      getState: vi.fn(() => Promise.resolve('failed')),
      retry: vi.fn(() => Promise.resolve()),
    };
    queueInstances[0].getJobs.mockResolvedValueOnce([unauthorizedJob, badPayloadJob]).mockResolvedValueOnce([]);
    queueInstances[0].getJob.mockImplementation((id) =>
      Promise.resolve(id === 'auth' ? unauthorizedJob : badPayloadJob)
    );

    await expect(manager.retryFailedJobs({ reason: '401 unauthorized' })).resolves.toBe(1);
    expect(unauthorizedJob.retry).toHaveBeenCalledTimes(1);
    expect(badPayloadJob.retry).not.toHaveBeenCalled();
  });

  it('starts worker once and wires error handler', () => {
    const mockLogger = createMockLogger(vi);

    const manager = new QueueManager(
      { redisUrl: 'redis://localhost:6379' },
      {
        logger: mockLogger,
        metrics: createMockMetrics(),
      }
    );

    manager.initialize();

    const processor = vi.fn((job) => Promise.resolve({ ok: true, id: job.id }));
    manager.startProcessing(processor);
    manager.startProcessing(processor);

    expect(workerInstances).toHaveLength(1);
    expect(workerInstances[0].name).toBe('sdr-messages');
    expect(workerInstances[0].on).toHaveBeenCalledWith('error', expect.any(Function));

    workerInstances[0].handlers.error(new Error('worker failed'));
    expect(mockLogger.error).toHaveBeenCalledWith('Worker error:', 'worker failed');
  });

  it('closes worker, queues and redis connections', async () => {
    const manager = new QueueManager({ redisUrl: 'redis://localhost:6379' }, { metrics: createMockMetrics() });
    manager.initialize();
    manager.startProcessing(() => Promise.resolve({ ok: true }));

    await manager.close();

    expect(workerInstances[0].close).toHaveBeenCalledTimes(1);
    expect(queueInstances[0].close).toHaveBeenCalledTimes(1);
    expect(queueInstances).toHaveLength(1);
    expect(redisInstances[0].quit).toHaveBeenCalledTimes(1);
    expect(redisInstances[0].workerConn.quit).toHaveBeenCalledTimes(1);
    expect(manager.worker).toBe(null);
    expect(manager.queue).toBe(null);
    expect(manager.connection).toBe(null);
    expect(manager.workerConnection).toBe(null);
  });

  it('decrements queue depth gauge on completing or failing finally', async () => {
    const mockMetrics = createMockMetrics();
    const manager = new QueueManager({ redisUrl: 'redis://localhost:6379' }, { metrics: mockMetrics });
    manager.initialize();

    const processor = vi.fn(() => Promise.resolve('ok'));
    manager.startProcessing(processor);

    const worker = workerInstances[0];
    const gauge = mockMetrics.gauge.mock.results[0].value;

    // Test the processor forwards correctly
    const job = { id: 'x', attemptsMade: 1, opts: { attempts: 1 } };
    const result = await worker.processor(job);
    expect(result).toBe('ok');
    expect(processor).toHaveBeenCalledWith(job);

    // completed event
    worker.handlers.completed(job);
    expect(gauge.dec).toHaveBeenCalledTimes(1);

    // failed event where attempts limit is reached
    worker.handlers.failed(job);
    expect(gauge.dec).toHaveBeenCalledTimes(2);

    // failed event where attempts limit not reached
    job.opts.attempts = 3;
    worker.handlers.failed(job);
    // Gauge should not be decremented again
    expect(gauge.dec).toHaveBeenCalledTimes(2);
  });
});
