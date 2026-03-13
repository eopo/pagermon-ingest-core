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

  it('initializes queue and dlq with defaults', () => {
    const manager = new QueueManager({ redisUrl: 'redis://localhost:6379' }, { metrics: createMockMetrics() });
    manager.initialize();

    expect(redisInstances).toHaveLength(1);
    expect(queueInstances).toHaveLength(2);
    expect(queueInstances[0].name).toBe('sdr-messages');
    expect(queueInstances[1].name).toBe('sdr-messages-dlq');
  });

  it('adds message with Message-like payload and builds deterministic job id', async () => {
    const metrics = createMockMetrics();
    const manager = new QueueManager({ redisUrl: 'redis://localhost:6379' }, { queueName: 'test-q', metrics });
    manager.initialize();
    const enqueuedCounter = metrics.counter.mock.results[0].value;
    const queueDepthGauge = metrics.gauge.mock.results[0].value;

    const payload = { source: 'rx1', address: '12345', timestamp: 1710000000 };
    await manager.addMessage({ toPayload: () => payload });

    expect(queueInstances[0].add).toHaveBeenCalledWith('message', payload, {
      jobId: 'msg-rx1-12345-1710000000',
    });
    expect(enqueuedCounter.inc).toHaveBeenCalledTimes(1);
    expect(queueDepthGauge.inc).toHaveBeenCalledTimes(1);
  });

  it('throws when adding before initialize', async () => {
    const manager = new QueueManager({ redisUrl: 'redis://localhost:6379' }, { metrics: createMockMetrics() });
    await expect(manager.addMessage({})).rejects.toThrow('Queue not initialized');
  });

  it('returns empty dead letters when DLQ disabled', async () => {
    const manager = new QueueManager(
      { redisUrl: 'redis://localhost:6379' },
      { enableDLQ: false, metrics: createMockMetrics() }
    );
    manager.initialize();

    const jobs = await manager.getDeadLetters(10);
    expect(jobs).toEqual([]);
  });

  it('maps dead letter jobs with limit handling', async () => {
    const manager = new QueueManager({ redisUrl: 'redis://localhost:6379' }, { metrics: createMockMetrics() });
    manager.initialize();

    queueInstances[1].getJobs.mockResolvedValue([
      {
        id: 'a',
        data: { x: 1 },
        failedReason: 'boom',
        attemptsMade: 2,
      },
    ]);

    const jobs = await manager.getDeadLetters(0);
    expect(queueInstances[1].getJobs).toHaveBeenCalledWith(['failed'], 0, 0);
    expect(jobs).toEqual([
      {
        id: 'a',
        data: { x: 1 },
        failedReason: 'boom',
        attemptsMade: 2,
      },
    ]);
  });

  it('returns queue size 0 when queue is not initialized', async () => {
    const manager = new QueueManager({ redisUrl: 'redis://localhost:6379' }, { metrics: createMockMetrics() });
    await expect(manager.getQueueSize()).resolves.toBe(0);
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
    expect(queueInstances[1].close).toHaveBeenCalledTimes(1);
    expect(redisInstances[0].quit).toHaveBeenCalledTimes(1);
    expect(redisInstances[0].workerConn.quit).toHaveBeenCalledTimes(1);
    expect(manager.worker).toBe(null);
    expect(manager.queue).toBe(null);
    expect(manager.dlq).toBe(null);
    expect(manager.connection).toBe(null);
    expect(manager.workerConnection).toBe(null);
  });
});
