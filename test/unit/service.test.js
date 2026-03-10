import { describe, expect, it, vi } from 'vitest';

function buildServiceMocks({ queueInitReject = null, triggerOnError = false } = {}) {
  const queue = {
    initialize: queueInitReject ? vi.fn(() => Promise.reject(queueInitReject)) : vi.fn(() => Promise.resolve()),
    addMessage: vi.fn(() => Promise.resolve()),
    close: vi.fn(() => Promise.resolve()),
  };

  const health = {
    start: vi.fn(),
    stop: vi.fn(),
  };

  const worker = {
    on: vi.fn(),
    start: vi.fn(() => Promise.resolve()),
    stop: vi.fn(() => Promise.resolve()),
  };

  const orchestrator = {
    initialize: vi.fn(() => Promise.resolve()),
    shutdown: vi.fn(() => Promise.resolve()),
    startReadingMessages: vi.fn(async (onMessage, onClose, onError) => {
      const message = { address: '123', source: 'old-source' };
      await onMessage(message);

      if (triggerOnError) {
        onError(new Error('stream failed'));
      }
    }),
  };

  return { queue, health, worker, orchestrator };
}

async function loadRunService({ queueInitReject = null, triggerOnError = false } = {}) {
  vi.resetModules();

  const services = buildServiceMocks({ queueInitReject, triggerOnError });
  const orchestratorCtorArgs = [];

  vi.doMock('../../lib/config.js', () => ({
    default: {
      label: 'test-label',
      apiUrl: 'http://api:3000',
      apiKey: 'test-key',
      redisUrl: 'redis://redis:6379',
      enableDLQ: true,
      healthCheckInterval: 100,
      healthCheckUnhealthyThreshold: 2,
      validate: vi.fn(),
      buildAdapterConfig: vi.fn(() => ({ adapter: { frequencies: '123' } })),
    },
  }));

  vi.doMock('../../lib/core/ApiClient.js', () => ({
    default: class {
      constructor() {}
    },
  }));

  vi.doMock('../../lib/core/QueueManager.js', () => ({
    default: class {
      constructor() {
        return services.queue;
      }
    },
  }));

  vi.doMock('../../lib/core/HealthMonitor.js', () => ({
    default: class {
      constructor() {
        return services.health;
      }
    },
  }));

  vi.doMock('../../lib/core/Worker.js', () => ({
    default: class {
      constructor() {
        return services.worker;
      }
    },
  }));

  vi.doMock('../../lib/runtime/pipeline.js', () => ({
    default: class {
      constructor(args) {
        orchestratorCtorArgs.push(args);
        return services.orchestrator;
      }
    },
  }));

  const { runService } = await import('../../lib/runtime/service.js');
  return { runService, services, orchestratorCtorArgs };
}

describe('runService', () => {
  it('initializes services, enqueues messages and handles graceful shutdown on SIGTERM', async () => {
    const onListeners = {};
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event, cb) => {
      onListeners[event] = cb;
      return process;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    const { runService, services, orchestratorCtorArgs } = await loadRunService();
    const adapterFactory = vi.fn();

    await runService({ adapterFactory });

    expect(services.queue.initialize).toHaveBeenCalledTimes(1);
    expect(services.worker.start).toHaveBeenCalledTimes(1);
    expect(services.queue.addMessage).toHaveBeenCalledTimes(1);

    const [queuedMessage] = services.queue.addMessage.mock.calls[0];
    expect(queuedMessage.source).toBe('test-label');

    expect(orchestratorCtorArgs).toHaveLength(1);
    expect(orchestratorCtorArgs[0].adapterFactory).toBe(adapterFactory);
    expect(typeof onListeners.SIGTERM).toBe('function');

    onListeners.SIGTERM();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(services.orchestrator.shutdown).toHaveBeenCalledTimes(1);
    expect(services.worker.stop).toHaveBeenCalledTimes(1);
    expect(services.queue.close).toHaveBeenCalledTimes(1);
    expect(services.health.stop).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);

    onSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('exits with code 1 when initialization fails', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    const { runService, services } = await loadRunService({ queueInitReject: new Error('queue init failed') });

    await runService();

    expect(services.queue.initialize).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it('shuts down with code 1 when adapter stream reports an error', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    const { runService, services } = await loadRunService({ triggerOnError: true });

    await runService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(services.orchestrator.shutdown).toHaveBeenCalledTimes(1);
    expect(services.worker.stop).toHaveBeenCalledTimes(1);
    expect(services.queue.close).toHaveBeenCalledTimes(1);
    expect(services.health.stop).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});
