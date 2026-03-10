/**
 * API Client - PagerMon API communication
 *
 * Handles HTTP communication with the PagerMon API.
 */

import http from 'http';
import https from 'https';

// Error classes
class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
  }
}

class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
    this.isAuth = true;
  }
}

class ClientError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ClientError';
  }
}

class ServerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ServerError';
  }
}

class ApiClient {
  /**
   * @param {Object} config
   * @param {string} config.url - API Base URL
   * @param {string} config.apiKey - API key for authentication
   * @param {Object} [options] - Additional options
   */
  constructor(config, options = {}) {
    if (!config.url) throw new Error('ApiClient requires config.url');
    if (!config.apiKey) throw new Error('ApiClient requires config.apiKey');

    this.url = config.url;
    this.apiKey = config.apiKey;
    this.timeout = options.timeout || 10000;
    this.retries = options.retries || 3;
    this.retryDelay = options.retryDelay || 1000;
  }

  /**
   * Submit a message to the API
   * @param {Message|Object} message - Message with address, message, format, etc.
   * @returns {Promise<Object>} API response
   */
  async submitMessage(message) {
    const payload = message.toPayload ? message.toPayload() : message;

    try {
      const result = await this._request('POST', '/api/messages', payload);
      return { success: true, data: result };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Check API health
   * @returns {Promise<boolean>}
   */
  async checkHealth() {
    try {
      const result = await this._request('GET', '/api/health', null, {
        timeout: 5000,
        retries: 1,
      });
      return result && result.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Make HTTP request with retry logic
   * @private
   */
  async _request(method, path, body = null, options = {}) {
    const timeout = options.timeout || this.timeout;
    const maxRetries = options.retries !== undefined ? options.retries : this.retries;

    let lastErr;

    // Sequential retry with exponential backoff is intentional here.
    /* eslint-disable no-await-in-loop */
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this._makeRequest(method, path, body, timeout);
      } catch (err) {
        lastErr = err;

        // Only retry on transient errors
        if (!this._isTransientError(err)) {
          throw err;
        }

        if (attempt < maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt); // Exponential backoff
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    /* eslint-enable no-await-in-loop */

    throw lastErr;
  }

  /**
   * Actually execute the HTTP request
   * @private
   */
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
          'X-API-Key': this.apiKey,
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
            } else if (res.statusCode === 401) {
              reject(new AuthError('Unauthorized'));
            } else if (res.statusCode >= 400 && res.statusCode < 500) {
              reject(new ClientError(`${res.statusCode}: ${data}`));
            } else {
              reject(new ServerError(`${res.statusCode}: ${data}`));
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
        reject(err);
      });

      if (bodyStr) {
        req.write(bodyStr);
      }

      req.end();
    });
  }

  /**
   * Determine if an error is transient (retryable)
   * @private
   */
  _isTransientError(err) {
    if (err instanceof TimeoutError) return true;
    if (err instanceof ServerError) return true;
    if (err instanceof ClientError) return false; // 4xx errors don't retry
    if (err instanceof AuthError) return false; // 401 doesn't retry
    if (err.code === 'ECONNREFUSED') return true;
    if (err.code === 'ETIMEDOUT') return true;
    if (err.code === 'EHOSTUNREACH') return true;
    return false;
  }
}

export default ApiClient;
