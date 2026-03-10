import http from 'http';
import https from 'https';

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.retryable = statusCode >= 500;
  }
}

class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
    this.retryable = true;
  }
}

class NetworkError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = 'NetworkError';
    this.retryable = true;
    this.originalError = originalError;
  }
}

class ApiClient {
  constructor(config, options = {}) {
    if (!config.url) throw new Error('ApiClient requires config.url');
    if (!config.apiKey) throw new Error('ApiClient requires config.apiKey');

    this.url = config.url;
    this.apiKey = config.apiKey;
    this.timeout = options.timeout || 10000;
  }

  async submitMessage(message) {
    const payload = message.toPayload ? message.toPayload() : message;
    return await this._request('POST', '/api/messages', payload);
  }

  async checkHealth() {
    try {
      const result = await this._request('GET', '/api/health', null, { timeout: 5000 });
      return result && result.status === 'ok';
    } catch {
      return false;
    }
  }

  async _request(method, path, body = null, options = {}) {
    const timeout = options.timeout || this.timeout;
    return await this._makeRequest(method, path, body, timeout);
  }

  _makeRequest(method, path, body, timeout) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, this.url);
      const isHttps = url.protocol === 'https:';
      const client = isHttps ? https : http;

      const bodyStr = body ? JSON.stringify(body) : null;

      const options = {
        method,
        timeout,
        headers: {
          'Content-Type': 'application/json',
          apikey: this.apiKey,
        },
      };

      if (bodyStr) {
        options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
      }

      const req = client.request(url, options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const parsed = data ? JSON.parse(data) : {};
              resolve(parsed);
            } else {
              reject(new ApiError(res.statusCode, `${res.statusCode}: ${data}`));
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new TimeoutError('Request timeout'));
      });

      req.on('error', (err) => {
        reject(new NetworkError(`Network error: ${err.message}`, err));
      });

      if (bodyStr) {
        req.write(bodyStr);
      }

      req.end();
    });
  }
}

export default ApiClient;
