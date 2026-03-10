import { beforeEach, describe, expect, it, vi } from 'vitest';

const { createAdapterMock } = vi.hoisted(() => ({
  createAdapterMock: vi.fn(),
}));

vi.mock('../../lib/runtime/adapter-loader.js', () => ({
  createAdapter: (...args) => createAdapterMock(...args),
}));

import Orchestrator from '../../lib/runtime/pipeline.js';

describe('Orchestrator', () => {
  beforeEach(() => {
    createAdapterMock.mockReset();
  });

  it('requires adapter config', () => {
    expect(() => new Orchestrator({})).toThrow('Orchestrator requires adapter config');
  });

  it('initializes adapter from loader', async () => {
    const adapter = { getName: () => 'fake', isRunning: () => true };
    createAdapterMock.mockResolvedValue(adapter);

    const orchestrator = new Orchestrator({ adapter: { foo: 'bar' } });
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

    const orchestrator = new Orchestrator({ adapter: { foo: 'bar' } });
    await orchestrator.initialize();

    const onMessage = vi.fn();
    const onClose = vi.fn();
    const onError = vi.fn();

    await orchestrator.startReadingMessages(onMessage, onClose, onError);
    expect(adapter.start).toHaveBeenCalledWith(onMessage, onClose, onError);

    await orchestrator.shutdown();
    expect(adapter.stop).toHaveBeenCalledTimes(1);
  });
});
