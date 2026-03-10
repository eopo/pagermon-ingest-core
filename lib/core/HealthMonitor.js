/**
 * Health Monitor - API availability monitoring
 *
 * Tracks API availability only.
 */

import logger from '../runtime/logger.js';

const healthLogger = logger.child({ component: 'health' });

class HealthMonitor {
  /**
   * @param {Object} config
   * @param {ApiClient} config.apiClient - API client for health checks
   * @param {Object} [options] - Additional options
   */
  constructor(config, options = {}) {
    if (!config.apiClient) throw new Error('HealthMonitor requires config.apiClient');

    this.apiClient = config.apiClient;
    this.checkInterval = options.checkInterval || 10000; // 10 seconds
    this.unhealthyThreshold = options.unhealthyThreshold || 3;

    this.isHealthy = true;
    this.failureCount = 0;
    this.lastCheckTime = null;
    this.timer = null;
    this.callbacks = {
      onHealthChange: null,
      onCheck: null,
    };
  }

  /**
   * Register callbacks
   */
  on(event, callback) {
    if (event === 'healthChange' || event === 'check') {
      this.callbacks[`on${event.charAt(0).toUpperCase()}${event.slice(1)}`] = callback;
    }
  }

  /**
   * Start the monitor
   */
  start() {
    healthLogger.info('Starting health monitor');
    this.perform();
    this.timer = setInterval(() => this.perform(), this.checkInterval);
  }

  /**
   * Stop the monitor
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    healthLogger.info('Health monitor stopped');
  }

  /**
   * Perform one health check cycle
   */
  async perform() {
    try {
      const wasHealthy = this.isHealthy;
      this.lastCheckTime = new Date();

      const healthy = await this.apiClient.checkHealth();

      if (healthy) {
        this.isHealthy = true;
        this.failureCount = 0;
      } else {
        this.failureCount++;
        if (this.failureCount >= this.unhealthyThreshold) {
          this.isHealthy = false;
        }
      }

      if (this.callbacks.onCheck) {
        this.callbacks.onCheck({
          healthy: this.isHealthy,
          failureCount: this.failureCount,
          timestamp: this.lastCheckTime,
        });
      }

      if (wasHealthy !== this.isHealthy && this.callbacks.onHealthChange) {
        this.callbacks.onHealthChange({
          healthy: this.isHealthy,
          timestamp: this.lastCheckTime,
        });
      }
    } catch (err) {
      healthLogger.error('Check error:', err.message);
      this.failureCount++;
      if (this.failureCount >= this.unhealthyThreshold && this.isHealthy) {
        this.isHealthy = false;
        if (this.callbacks.onHealthChange) {
          this.callbacks.onHealthChange({
            healthy: false,
            timestamp: new Date(),
          });
        }
      }
    }
  }

  /**
   * Current status snapshot
   */
  getStatus() {
    return {
      healthy: this.isHealthy,
      failureCount: this.failureCount,
      lastCheck: this.lastCheckTime,
    };
  }
}

export default HealthMonitor;
