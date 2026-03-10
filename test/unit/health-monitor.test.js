import { describe, expect, it, vi } from 'vitest';
import HealthMonitor from '../../lib/core/HealthMonitor.js';
import { makeMetrics } from '../helpers/metrics.js';

describe('HealthMonitor', () => {
  it('throws when apiClient is missing', () => {
    expect(() => new HealthMonitor({})).toThrow('HealthMonitor requires config.apiClient');
  });

  it('throws when metrics is missing', () => {
    expect(() => new HealthMonitor({ apiClient: {} })).toThrow('HealthMonitor requires options.metrics');
  });

  it('marks unhealthy after threshold and emits callbacks', async () => {
    const apiClient = { checkHealth: vi.fn().mockResolvedValue(false) };
    const metrics = makeMetrics();
    const monitor = new HealthMonitor({ apiClient }, { unhealthyThreshold: 2, metrics });
    const healthGauge = metrics.gauge.mock.results[0].value;
    const failureCounter = metrics.counter.mock.results[0].value;

    const onCheck = vi.fn();
    const onHealthChange = vi.fn();
    monitor.on('check', onCheck);
    monitor.on('healthChange', onHealthChange);

    await monitor.perform();
    expect(monitor.isHealthy).toBe(true);
    expect(monitor.failureCount).toBe(1);
    expect(healthGauge.set).toHaveBeenLastCalledWith(1);
    expect(failureCounter.inc).not.toHaveBeenCalled();

    await monitor.perform();
    expect(monitor.isHealthy).toBe(false);
    expect(monitor.failureCount).toBe(2);
    expect(healthGauge.set).toHaveBeenLastCalledWith(0);
    expect(onCheck).toHaveBeenCalledTimes(2);
    expect(onHealthChange).toHaveBeenCalledTimes(1);
  });

  it('recovers to healthy state after successful check', async () => {
    const apiClient = { checkHealth: vi.fn() };
    const monitor = new HealthMonitor({ apiClient }, { unhealthyThreshold: 1, metrics: makeMetrics() });

    apiClient.checkHealth.mockResolvedValueOnce(false);
    await monitor.perform();
    expect(monitor.isHealthy).toBe(false);

    apiClient.checkHealth.mockResolvedValueOnce(true);
    await monitor.perform();
    expect(monitor.isHealthy).toBe(true);
    expect(monitor.failureCount).toBe(0);
  });

  it('handles check exceptions as failures', async () => {
    const apiClient = { checkHealth: vi.fn().mockRejectedValue(new Error('boom')) };
    const metrics = makeMetrics();
    const monitor = new HealthMonitor({ apiClient }, { unhealthyThreshold: 1, metrics });
    const failureCounter = metrics.counter.mock.results[0].value;

    await monitor.perform();
    expect(monitor.isHealthy).toBe(false);
    expect(monitor.failureCount).toBe(1);
    expect(failureCounter.inc).toHaveBeenCalledTimes(1);
  });

  it('starts interval polling and can be stopped safely', () => {
    vi.useFakeTimers();
    const apiClient = { checkHealth: vi.fn().mockResolvedValue(true) };
    const monitor = new HealthMonitor({ apiClient }, { checkInterval: 50, metrics: makeMetrics() });

    const performSpy = vi.spyOn(monitor, 'perform').mockResolvedValue(undefined);

    monitor.start();
    expect(performSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(120);
    expect(performSpy).toHaveBeenCalledTimes(3);

    monitor.stop();
    expect(monitor.timer).toBe(null);

    vi.useRealTimers();
  });

  it('ignores unknown callback events and exposes status snapshot', async () => {
    const apiClient = { checkHealth: vi.fn().mockResolvedValue(true) };
    const monitor = new HealthMonitor({ apiClient }, { metrics: makeMetrics() });

    monitor.on('unknown', vi.fn());
    await monitor.perform();

    const status = monitor.getStatus();
    expect(status.healthy).toBe(true);
    expect(status.failureCount).toBe(0);
    expect(status.lastCheck).toBeInstanceOf(Date);
  });
});
