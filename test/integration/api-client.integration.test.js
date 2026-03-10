import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { once } from 'events';
import http from 'http';
import ApiClient from '../../lib/core/ApiClient.js';

async function readRequestBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk.toString();
  }
  return body;
}

describe('ApiClient integration', () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    server = http.createServer(async (req, res) => {
      if (req.url === '/api/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      if (req.url === '/api/messages' && req.method === 'POST') {
        const body = await readRequestBody(req);
        const parsed = JSON.parse(body || '{}');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', id: 42, reason: 'created', address: parsed.address }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');

    const address = server.address();
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (!server) return;
    server.close();
    await once(server, 'close');
  });

  it('submits a message successfully', async () => {
    const client = new ApiClient({ url: baseUrl, apiKey: 'test-key' });

    const result = await client.submitMessage({
      address: '12345',
      message: 'hello',
      format: 'alpha',
      source: 'integration-test',
    });

    expect(result.status).toBe('ok');
    expect(result.id).toBe(42);
    expect(result.reason).toBe('created');
    expect(result.address).toBe('12345');
  });

  it('reports healthy endpoint correctly', async () => {
    const client = new ApiClient({ url: baseUrl, apiKey: 'test-key' });
    await expect(client.checkHealth()).resolves.toBe(true);
  });
});
