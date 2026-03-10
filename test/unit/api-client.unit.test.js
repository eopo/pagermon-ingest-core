import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const httpRequestMock = vi.fn();
const httpsRequestMock = vi.fn();
const scenarios = [];

vi.mock('http', () => ({
  default: {
    request: (...args) => httpRequestMock(...args),
  },
}));

vi.mock('https', () => ({
  default: {
    request: (...args) => httpsRequestMock(...args),
  },
}));

import ApiClient from '../../lib/core/ApiClient.js';

function queueScenario(scenario) {
  scenarios.push(scenario);
}

function buildRequestMock() {
  return vi.fn((_url, _options, callback) => {
    const scenario = scenarios.shift() || { statusCode: 200, data: '{}' };
    const req = new EventEmitter();

    req.write = vi.fn();
    req.destroy = vi.fn();
    req.end = vi.fn(() => {
      queueMicrotask(() => {
        if (scenario.timeout) {
          req.emit('timeout');
          return;
        }

        if (scenario.error) {
          const err = scenario.error;
          req.emit('error', err);
          return;
        }

        const res = new EventEmitter();
        res.statusCode = scenario.statusCode;
        callback(res);

        if (scenario.data !== undefined) {
          res.emit('data', scenario.data);
        }
        res.emit('end');
      });
    });

    return req;
  });
}

describe('ApiClient unit behavior', () => {
  beforeEach(() => {
    scenarios.length = 0;
    httpRequestMock.mockReset();
    httpsRequestMock.mockReset();
    httpRequestMock.mockImplementation(buildRequestMock());
    httpsRequestMock.mockImplementation(buildRequestMock());
  });

  it('validates required constructor config', () => {
    expect(() => new ApiClient({}, {})).toThrow('ApiClient requires config.url');
    expect(() => new ApiClient({ url: 'http://x' }, {})).toThrow('ApiClient requires config.apiKey');
  });

  it('submits payload successfully and sends JSON body', async () => {
    const client = new ApiClient({ url: 'http://localhost:3000', apiKey: 'k' }, { retries: 0 });
    queueScenario({ statusCode: 200, data: '{"accepted":true}' });

    const result = await client.submitMessage({
      toPayload() {
        return { address: '123', source: 's', timestamp: 1 };
      },
    });

    expect(result).toEqual({ success: true, data: { accepted: true } });
    expect(httpRequestMock).toHaveBeenCalledTimes(1);
  });

  it('returns false result on auth/client errors without retries', async () => {
    const client = new ApiClient({ url: 'http://localhost:3000', apiKey: 'k' }, { retries: 3, retryDelay: 0 });
    queueScenario({ statusCode: 401, data: 'denied' });

    const result = await client.submitMessage({ address: 'x' });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unauthorized');
    expect(httpRequestMock).toHaveBeenCalledTimes(1);
  });

  it('retries transient server failures and eventually succeeds', async () => {
    const client = new ApiClient({ url: 'http://localhost:3000', apiKey: 'k' }, { retries: 2, retryDelay: 0 });
    queueScenario({ statusCode: 500, data: 'boom' });
    queueScenario({ statusCode: 503, data: 'still-boom' });
    queueScenario({ statusCode: 200, data: '{"ok":true}' });

    const result = await client._request('GET', '/api/health');

    expect(result).toEqual({ ok: true });
    expect(httpRequestMock).toHaveBeenCalledTimes(3);
  });

  it('marks connectivity errors as transient', () => {
    const client = new ApiClient({ url: 'http://localhost:3000', apiKey: 'k' }, { retries: 0 });
    expect(client._isTransientError({ code: 'ECONNREFUSED' })).toBe(true);
    expect(client._isTransientError({ code: 'ETIMEDOUT' })).toBe(true);
    expect(client._isTransientError({ code: 'EHOSTUNREACH' })).toBe(true);
    expect(client._isTransientError({ code: 'ENOENT' })).toBe(false);
  });

  it('handles timeout and health check fallback', async () => {
    const client = new ApiClient({ url: 'http://localhost:3000', apiKey: 'k' }, { retries: 0 });
    queueScenario({ timeout: true });

    const healthy = await client.checkHealth();
    expect(healthy).toBe(false);
  });

  it('uses https transport for secure endpoints', async () => {
    const client = new ApiClient({ url: 'https://example.test', apiKey: 'k' }, { retries: 0 });
    queueScenario({ statusCode: 200, data: '{"status":"ok"}' });

    const result = await client._request('GET', '/api/health');

    expect(result.status).toBe('ok');
    expect(httpsRequestMock).toHaveBeenCalledTimes(1);
  });
});
