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

  it('submits payload successfully and returns API response', async () => {
    const client = new ApiClient({ url: 'http://localhost:3000', apiKey: 'k' });
    queueScenario({ statusCode: 200, data: '{"status":"ok","id":42,"reason":"created"}' });

    const result = await client.submitMessage({
      toPayload() {
        return { address: '123', source: 's', timestamp: 1 };
      },
    });

    expect(result).toEqual({ status: 'ok', id: 42, reason: 'created' });
    expect(httpRequestMock).toHaveBeenCalledTimes(1);
  });

  it('throws ApiError with retryable=false on 401', async () => {
    const client = new ApiClient({ url: 'http://localhost:3000', apiKey: 'k' });
    queueScenario({ statusCode: 401, data: 'denied' });

    await expect(client.submitMessage({ address: 'x' })).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 401,
      retryable: false,
    });
  });

  it('throws ApiError with retryable=false on 4xx', async () => {
    const client = new ApiClient({ url: 'http://localhost:3000', apiKey: 'k' });
    queueScenario({ statusCode: 404, data: 'not found' });

    await expect(client._request('GET', '/api/test')).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 404,
      retryable: false,
    });
  });

  it('throws ApiError with retryable=true on 5xx', async () => {
    const client = new ApiClient({ url: 'http://localhost:3000', apiKey: 'k' });
    queueScenario({ statusCode: 500, data: 'boom' });

    await expect(client._request('GET', '/api/health')).rejects.toMatchObject({
      name: 'ApiError',
      statusCode: 500,
      retryable: true,
    });
  });

  it('throws TimeoutError with retryable=true on timeout', async () => {
    const client = new ApiClient({ url: 'http://localhost:3000', apiKey: 'k' });
    queueScenario({ timeout: true });

    await expect(client._request('GET', '/api/test')).rejects.toMatchObject({
      name: 'TimeoutError',
      retryable: true,
    });
  });

  it('handles timeout and health check fallback', async () => {
    const client = new ApiClient({ url: 'http://localhost:3000', apiKey: 'k' });
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

  it('throws NetworkError on underlying request errors', async () => {
    const client = new ApiClient({ url: 'http://localhost:3000', apiKey: 'k' });
    queueScenario({ error: new Error('ECONNREFUSED') });

    await expect(client._request('GET', '/api/test')).rejects.toMatchObject({
      name: 'NetworkError',
      retryable: true,
      message: 'Network error: ECONNREFUSED',
    });
  });

  it('rejects correctly when JSON parsing fails for API responses', async () => {
    const client = new ApiClient({ url: 'http://localhost:3000', apiKey: 'k' });
    queueScenario({ statusCode: 200, data: 'not-json' });

    await expect(client._request('GET', '/api/test')).rejects.toThrow(SyntaxError);
  });
});
