/**
 * Test helper for metrics – returns a vi.fn()-based mock that satisfies the
 * Metrics interface (counter / gauge / histogram).
 *
 * Each factory call (counter/gauge/histogram) is a spy, and each returned
 * metric instance is also a spy, so tests can assert:
 *   expect(metrics.gauge).toHaveBeenCalledWith(expect.objectContaining({ name: 'api_up' }))
 *   const g = metrics.gauge.mock.results[0].value;
 *   expect(g.set).toHaveBeenCalledWith(1);
 */

import { vi } from 'vitest';

function makeMetricInstance() {
  const m = {
    inc: vi.fn(),
    dec: vi.fn(),
    set: vi.fn(),
    observe: vi.fn(),
  };
  // labels() returns the same spy instance so callers can chain .inc()/.observe()
  m.labels = vi.fn(() => m);
  return m;
}

export function makeMetrics() {
  return {
    counter: vi.fn(() => makeMetricInstance()),
    gauge: vi.fn(() => makeMetricInstance()),
    histogram: vi.fn(() => makeMetricInstance()),
  };
}
