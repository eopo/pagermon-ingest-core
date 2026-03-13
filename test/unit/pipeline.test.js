import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAdapterMock } = vi.hoisted(() => ({
  createAdapterMock: vi.fn(),
}));

vi.mock('../../lib/runtime/adapter-loader.js', () => ({
  createAdapter: (...args) => createAdapterMock(...args),
}));

import Orchestrator from '../../lib/runtime/pipeline.js';
import { createMockMetrics } from '../helpers/metrics.js';

describe('Orchestrator', () => {
  beforeEach(() => {
    createAdapterMock.mockReset();
  });

  it('requires adapter config', () => {
    expect(() => new Orchestrator({})).toThrow('Orchestrator requires adapter config');
  });

  it('requires metrics', () => {
    expect(() => new Orchestrator({ adapter: {} })).toThrow('Orchestrator requires config.metrics');
  });

  it('initializes adapter from loader', async () => {
    const adapter = { getName: () => 'fake', isRunning: () => true };
    createAdapterMock.mockResolvedValue(adapter);

    const orchestrator = new Orchestrator({ adapter: { foo: 'bar' }, metrics: createMockMetrics() });
    await orchestrator.initialize();

    expect(createAdapterMock).toHaveBeenCalledWith({ foo: 'bar' });
    expect(orchestrator.getStatus().adapterConfigured).toBe(true);
    expect(orchestrator.getStatus().adapterRunning).toBe(true);
  });

  it('starts reading messages through adapter', async () => {
    const adapter = {
      getName: () => 'fake',
      isRunning: () => true,
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    createAdapterMock.mockResolvedValue(adapter);

    const metrics = createMockMetrics();
    const orchestrator = new Orchestrator({ adapter: { foo: 'bar' }, metrics });
    const adapterUpGauge = metrics.gauge.mock.results[0].value;
    await orchestrator.initialize();

    await orchestrator.startReadingMessages(vi.fn(), vi.fn(), vi.fn());
    expect(adapterUpGauge.set).toHaveBeenCalledWith(1);

    await orchestrator.shutdown();
    expect(adapter.stop).toHaveBeenCalledTimes(1);
    expect(adapterUpGauge.set).toHaveBeenLastCalledWith(0);
  });
});
