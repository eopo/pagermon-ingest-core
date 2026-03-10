/**
 * Health Monitor - API availability monitoring
 *
 * Tracks API availability only.
 */

class HealthMonitor {
  /**
   * @param {Object} config
   * @param {ApiClient} config.apiClient - API client for health checks
   * @param {Object} [options] - Additional options
   * @param {import('../runtime/metrics.js').Metrics} options.metrics - Metrics instance
   */
  constructor(config, options = {}) {
    if (!config.apiClient) throw new Error('HealthMonitor requires config.apiClient');
    if (!options.metrics) throw new Error('HealthMonitor requires options.metrics');

    this.apiClient = config.apiClient;
    this.checkInterval = options.checkInterval || 10000;
    this.unhealthyThreshold = options.unhealthyThreshold || 3;

    this.isHealthy = true;
    this.failureCount = 0;
    this.lastCheckTime = null;
    this.timer = null;
    this.callbacks = {
      onHealthChange: null,
      onCheck: null,
    };

    const m = options.metrics;
    this.healthGauge = m.gauge({
      name: 'api_up',
      help: 'API availability (1=up, 0=down)',
    });
    this.failureCounter = m.counter({
      name: 'health_check_failures_total',
      help: 'Total number of failed health checks',
    });
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
    console.log('[HEALTH] Starting health monitor');
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
    console.log('[HEALTH] Health monitor stopped');
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

      // Update health gauge
      this.healthGauge.set(this.isHealthy ? 1 : 0);

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
      console.error('[HEALTH] Check error:', err.message);
      this.failureCount++;

      this.failureCounter.inc();

      if (this.failureCount >= this.unhealthyThreshold && this.isHealthy) {
        this.isHealthy = false;
        this.healthGauge.set(0);
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
