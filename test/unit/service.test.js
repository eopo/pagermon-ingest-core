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
      const message = { address: '123', metadata: { source: 'old-source' } };
      await onMessage(message);

      if (triggerOnError) {
        onError(new Error('stream failed'));
      }
    }),
  };

  return { queue, health, worker, orchestrator };
}

async function loadRunService({ queueInitReject = null, triggerOnError = false, apiTargets } = {}) {
  vi.resetModules();

  const services = buildServiceMocks({ queueInitReject, triggerOnError });
  const orchestratorCtorArgs = [];
  const configuredApiTargets = apiTargets || [{ id: 'default', url: 'http://api:3000', apiKey: 'test-key' }];

  vi.doMock('../../lib/config.js', () => ({
    default: {
      label: 'test-label',
      apiTargets: configuredApiTargets,
      redisUrl: 'redis://redis:6379',
      enableDLQ: true,
      healthCheckInterval: 100,
      healthCheckUnhealthyThreshold: 2,
      metricsEnabled: false,
      metricsPort: 9464,
      metricsHost: '0.0.0.0',
      metricsPath: '/metrics',
      metricsPrefix: 'pagermon_ingest_',
      metricsCollectDefault: true,
      metricQueuePollInterval: 5000,
      validate: vi.fn(),
      buildAdapterConfig: vi.fn(() => ({ adapter: { frequencies: '123' } })),
      buildMetricsConfig: vi.fn(() => ({ enabled: false })),
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

  vi.doMock('../../lib/runtime/metrics.js', () => ({
    createMetrics: vi.fn(() => ({
      counter: vi.fn(() => ({ labels: vi.fn(() => ({ inc: vi.fn() })), inc: vi.fn() })),
      gauge: vi.fn(() => ({ labels: vi.fn(() => ({ set: vi.fn() })), set: vi.fn() })),
      histogram: vi.fn(() => ({ labels: vi.fn(() => ({ observe: vi.fn() })), observe: vi.fn() })),
      expose: vi.fn(() => Promise.resolve('# HELP test\ntest 1')),
      listen: vi.fn(() => Promise.resolve()),
      close: vi.fn(),
    })),
  }));

  const { runService } = await import('../../lib/runtime/service.js');
  return { runService, services, orchestratorCtorArgs, configuredApiTargets };
}

describe('runService', () => {
  it('initializes services, uses metadata.source override and handles graceful shutdown on SIGTERM', async () => {
    const onListeners = {};
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event, cb) => {
      onListeners[event] = cb;
      return process;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    const { runService, services, orchestratorCtorArgs, configuredApiTargets } = await loadRunService();
    const adapterFactory = vi.fn();

    await runService({ adapterFactory });

    expect(services.queue.initialize).toHaveBeenCalledTimes(1);
    expect(services.worker.start).toHaveBeenCalledTimes(1);
    expect(services.queue.addMessage).toHaveBeenCalledTimes(1);

    const [queuedMessage] = services.queue.addMessage.mock.calls[0];
    expect(queuedMessage.source).toBe('old-source');

    expect(orchestratorCtorArgs).toHaveLength(1);
    expect(orchestratorCtorArgs[0].adapterFactory).toBe(adapterFactory);
    expect(typeof onListeners.SIGTERM).toBe('function');

    onListeners.SIGTERM();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(services.orchestrator.shutdown).toHaveBeenCalledTimes(1);
    expect(services.worker.stop).toHaveBeenCalledTimes(1);
    expect(services.queue.close).toHaveBeenCalledTimes(1);
    expect(services.health.stop).toHaveBeenCalledTimes(configuredApiTargets.length);
    expect(exitSpy).toHaveBeenCalledWith(0);

    onSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('defaults source to config.label when adapter omits it', async () => {
    const onListeners = {};
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event, cb) => {
      onListeners[event] = cb;
      return process;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    const { runService, services } = await loadRunService();
    services.orchestrator.startReadingMessages = vi.fn(async (onMessage) => {
      await onMessage({ address: '123' });
    });

    await runService();

    const [queuedMessage] = services.queue.addMessage.mock.calls[0];
    expect(queuedMessage.source).toBe('test-label');

    onSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('ignores legacy top-level source and still defaults to label', async () => {
    const onListeners = {};
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event, cb) => {
      onListeners[event] = cb;
      return process;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    const { runService, services } = await loadRunService();
    services.orchestrator.startReadingMessages = vi.fn(async (onMessage) => {
      await onMessage({ address: '123', source: 'legacy-source' });
    });

    await runService();

    const [queuedMessage] = services.queue.addMessage.mock.calls[0];
    expect(queuedMessage.source).toBe('test-label');

    onSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('infers alpha format for raw adapter objects with message text', async () => {
    const onListeners = {};
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event, cb) => {
      onListeners[event] = cb;
      return process;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    const { runService, services } = await loadRunService();
    services.orchestrator.startReadingMessages = vi.fn(async (onMessage) => {
      await onMessage({ address: '123', message: 'HELLO' });
    });

    await runService();

    const [queuedMessage] = services.queue.addMessage.mock.calls[0];
    expect(queuedMessage.format).toBe('alpha');
    expect(queuedMessage.source).toBe('test-label');

    onSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('uses metadata.format for raw adapter objects when provided', async () => {
    const onListeners = {};
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event, cb) => {
      onListeners[event] = cb;
      return process;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    const { runService, services } = await loadRunService();
    services.orchestrator.startReadingMessages = vi.fn(async (onMessage) => {
      await onMessage({ address: '123', message: '42', metadata: { format: 'numeric' } });
    });

    await runService();

    const [queuedMessage] = services.queue.addMessage.mock.calls[0];
    expect(queuedMessage.format).toBe('numeric');
    expect(queuedMessage.metadata).toBeUndefined();

    onSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('fans out one incoming message to all configured API targets', async () => {
    const onListeners = {};
    const onSpy = vi.spyOn(process, 'on').mockImplementation((event, cb) => {
      onListeners[event] = cb;
      return process;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    const { runService, services } = await loadRunService({
      apiTargets: [
        { id: 'primary', url: 'http://api-a:3000', apiKey: 'k-a' },
        { id: 'backup', url: 'http://api-b:3000', apiKey: 'k-b' },
      ],
    });

    services.orchestrator.startReadingMessages = vi.fn(async (onMessage) => {
      await onMessage({ address: '123', message: 'HELLO', metadata: { source: 'sdr-a' } });
    });

    await runService();

    expect(services.queue.addMessage).toHaveBeenCalledTimes(2);
    const firstPayload = services.queue.addMessage.mock.calls[0][0];
    const secondPayload = services.queue.addMessage.mock.calls[1][0];
    expect(firstPayload.targetId).toBe('primary');
    expect(secondPayload.targetId).toBe('backup');
    expect(firstPayload.source).toBe('sdr-a');
    expect(secondPayload.source).toBe('sdr-a');

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

    const { runService, services, configuredApiTargets } = await loadRunService({ triggerOnError: true });

    await runService();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(services.orchestrator.shutdown).toHaveBeenCalledTimes(1);
    expect(services.worker.stop).toHaveBeenCalledTimes(1);
    expect(services.queue.close).toHaveBeenCalledTimes(1);
    expect(services.health.stop).toHaveBeenCalledTimes(configuredApiTargets.length);
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});
