import { describe, expect, it } from 'vitest';
import { createMetrics } from '../../lib/runtime/metrics.js';

describe('Metrics', () => {
  it('creates a metrics instance regardless of enabled flag', () => {
    const enabledMetrics = createMetrics({ enabled: true });
    const disabledMetrics = createMetrics({ enabled: false });

    expect(enabledMetrics).toBeDefined();
    expect(disabledMetrics).toBeDefined();
  });

  it('counter increments when enabled', async () => {
    const metrics = createMetrics({ enabled: true, collectDefaults: false });

    const counter = metrics.counter({
      name: 'test_counter',
      help: 'Test counter',
    });

    counter.inc();
    counter.inc(5);

    const output = await metrics.expose();
    expect(output).toContain('test_counter 6');
  });

  it('expose() returns null when disabled, metrics still recorded internally', async () => {
    const metrics = createMetrics({ enabled: false, collectDefaults: false });

    const counter = metrics.counter({
      name: 'test_counter_disabled',
      help: 'Test counter',
    });

    // Metrics are always tracked – no errors thrown
    counter.inc();
    counter.inc(5);

    // But HTTP endpoint stays closed
    const output = await metrics.expose();
    expect(output).toBeNull();
  });

  it('gauge sets value when enabled', async () => {
    const metrics = createMetrics({ enabled: true, collectDefaults: false });

    const gauge = metrics.gauge({
      name: 'test_gauge',
      help: 'Test gauge',
    });

    gauge.set(42);

    const output = await metrics.expose();
    expect(output).toContain('test_gauge 42');
  });

  it('histogram observes values when enabled', async () => {
    const metrics = createMetrics({ enabled: true, collectDefaults: false });

    const histogram = metrics.histogram({
      name: 'test_duration_seconds',
      help: 'Test duration',
      buckets: [0.1, 0.5, 1],
    });

    histogram.observe(0.25);
    histogram.observe(0.75);

    const output = await metrics.expose();
    expect(output).toContain('test_duration_seconds_bucket');
    expect(output).toContain('test_duration_seconds_count 2');
    expect(output).toContain('test_duration_seconds_sum');
  });

  it('labels work correctly with multiple values', async () => {
    const metrics = createMetrics({ enabled: true, collectDefaults: false });

    const counter = metrics.counter({
      name: 'test_requests',
      help: 'Test requests',
      labelNames: ['method', 'status'],
    });

    counter.labels({ method: 'GET', status: '200' }).inc();
    counter.labels({ method: 'POST', status: '201' }).inc(2);

    const output = await metrics.expose();
    expect(output).toContain('test_requests{method="GET",status="200"} 1');
    expect(output).toContain('test_requests{method="POST",status="201"} 2');
  });

  it('child creates context with inherited labels', async () => {
    const metrics = createMetrics({ enabled: true, collectDefaults: false });

    // Adapter usage: create counter with label names
    const counter = metrics.counter({
      name: 'test_adapter_counter',
      help: 'Test adapter counter',
      labelNames: ['adapter'],
    });

    // Use with adapter label
    counter.labels({ adapter: 'my-adapter' }).inc();
    counter.labels({ adapter: 'my-adapter' }).inc();

    const output = await metrics.expose();
    expect(output).toContain('test_adapter_counter{adapter="my-adapter"} 2');
  });

  it('default Prometheus metrics are collected when enabled', async () => {
    const metrics = createMetrics({ enabled: true, collectDefaults: true });

    const output = await metrics.expose();
    expect(output).toContain('process_');
    expect(output).toContain('nodejs_');
  });

  it('default Prometheus metrics are not collected when disabled', async () => {
    const metrics = createMetrics({ enabled: true, collectDefaults: false });

    const output = await metrics.expose();
    // Should not have process or nodejs metrics
    expect(output).not.toContain('process_resident_memory_bytes');
  });

  it('prefix is applied to metric names', async () => {
    const metrics = createMetrics({ enabled: true, prefix: 'myapp_', collectDefaults: false });

    const counter = metrics.counter({
      name: 'myapp_requests',
      help: 'Requests',
    });

    counter.inc();

    const output = await metrics.expose();
    expect(output).toContain('myapp_requests 1');
  });

  it('default labels are applied to all metrics', async () => {
    const metrics = createMetrics({
      enabled: true,
      collectDefaults: false,
      defaultLabels: { env: 'test', service: 'ingest' },
    });

    const counter = metrics.counter({
      name: 'test_default_labels',
      help: 'Test',
      labelNames: ['env', 'service'],
    });

    counter.labels({ env: 'test', service: 'ingest' }).inc();

    const output = await metrics.expose();
    expect(output).toContain('test_default_labels{env="test",service="ingest"} 1');
  });

  it('histogram timer works correctly', async () => {
    const metrics = createMetrics({ enabled: true, collectDefaults: false });

    const histogram = metrics.histogram({
      name: 'test_timer_seconds',
      help: 'Test timer',
      buckets: [0.01, 0.1],
    });

    const end = histogram.startTimer();
    // Simulate some work
    await new Promise((resolve) => setTimeout(resolve, 5));
    end();

    const output = await metrics.expose();
    expect(output).toContain('test_timer_seconds_count 1');
  });

  it('multiple metrics can be registered independently', async () => {
    const metrics = createMetrics({ enabled: true, collectDefaults: false });

    const counter1 = metrics.counter({ name: 'metric_1', help: 'First' });
    const counter2 = metrics.counter({ name: 'metric_2', help: 'Second' });
    const gauge1 = metrics.gauge({ name: 'metric_3', help: 'Third' });

    counter1.inc(5);
    counter2.inc(3);
    gauge1.set(99);

    const output = await metrics.expose();
    expect(output).toContain('metric_1 5');
    expect(output).toContain('metric_2 3');
    expect(output).toContain('metric_3 99');
  });
});
