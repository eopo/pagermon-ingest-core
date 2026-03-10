/**
 * Metrics Module
 *
 * Metrics are always collected internally.
 * The HTTP server (and expose()) is only active when enabled via config.
 */

import * as client from 'prom-client';
import http from 'http';
import logger from './logger.js';

const metricsLogger = logger.child({ component: 'metrics' });

class Metrics {
  /**
   * @param {Object} config
   * @param {boolean} config.enabled - Whether the metrics HTTP endpoint is exposed
   * @param {string} config.prefix - Metric name prefix
   * @param {Object} config.defaultLabels - Static labels for all metrics
   * @param {boolean} config.collectDefaults - Whether to collect Node.js default metrics
   */
  constructor(config = {}) {
    this.enabled = config.enabled !== false;
    this.prefix = config.prefix || 'pagermon_ingest_';
    this.collectDefaults = config.collectDefaults !== false;
    this.registry = new client.Registry();
    this.metrics = {};
    this.server = null;

    if (this.collectDefaults) {
      client.collectDefaultMetrics({ register: this.registry, prefix: this.prefix });
    }
  }

  /**
   * Register or retrieve a metric (idempotent).
   * Ensures each name is only registered once per registry.
   * @private
   */
  _register(Type, options) {
    const { name: key } = options;
    if (!this.metrics[key]) {
      const name = `${this.prefix}${key}`;
      this.metrics[key] = new Type({ ...options, name, registers: [this.registry] });
    }
    return this.metrics[key];
  }

  /** @param {Object} options */
  counter(options) {
    return this._register(client.Counter, options);
  }

  /** @param {Object} options */
  gauge(options) {
    return this._register(client.Gauge, options);
  }

  /** @param {Object} options */
  histogram(options) {
    return this._register(client.Histogram, options);
  }

  /**
   * Start the metrics HTTP server.
   * No-op when this instance is disabled.
   * @param {number} port
   * @param {string} host
   * @param {string} path
   */
  async listen(port, host, path) {
    if (!this.enabled) return;

    this.server = http.createServer(async (req, res) => {
      if (req.url === path && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(await this.expose());
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.server.on('error', (err) => {
      metricsLogger.error('Server error:', err.message);
    });

    await new Promise((resolve) => this.server.listen(port, host, resolve));
    metricsLogger.info(`Listening on http://${host}:${port}${path}`);
  }

  /**
   * Stop the metrics HTTP server.
   */
  close() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /**
   * Expose metrics in Prometheus text format.
   * Returns null if the HTTP endpoint is disabled.
   */
  async expose() {
    if (!this.enabled) return null;
    return await this.registry.metrics();
  }

  /**
   * Get the underlying registry
   */
  getRegistry() {
    return this.registry;
  }
}

/**
 * Create a metrics instance.
 * Metrics are always collected; the HTTP server is started separately by service.js
 * only when config.metricsEnabled is true.
 */
export function createMetrics(config) {
  return new Metrics(config);
}

export { Metrics };
