/**
 * Orchestration Pipeline
 *
 * Orchestrates a unified source adapter.
 * Used by the main application and contains no business logic.
 */

import { createAdapter } from './adapter-loader.js';
import logger from './logger.js';

const orchestratorLogger = logger.child({ component: 'orchestrator' });

class Orchestrator {
  /**
   * @param {Object} config
   * @param {Object} config.adapter - Adapter configuration object
   * @param {Function} [config.adapterFactory] - Factory function to create adapter
   * @param {import('./metrics.js').Metrics} config.metrics - Metrics instance
   */
  constructor(config) {
    if (!config.adapter) {
      throw new Error('Orchestrator requires adapter config');
    }
    if (!config.metrics) {
      throw new Error('Orchestrator requires config.metrics');
    }

    this.config = config;
    this.adapterFactory = config.adapterFactory || createAdapter;
    this.adapter = null;

    this.adapterRunning = config.metrics.gauge({
      name: 'adapter_up',
      help: 'Adapter availability (1=running, 0=stopped)',
    });
  }

  /**
   * Initialize source adapter
   */
  async initialize() {
    this.adapter = await this.adapterFactory(this.config.adapter);
    orchestratorLogger.info(`Source adapter: ${this.adapter.getName()}`);

    this.adapterRunning.set(this.adapter.isRunning() ? 1 : 0);
  }

  /**
   * Start reading messages from the adapter
   * @param {Function} onMessage - Callback for each parsed message
   * @param {Function} onClose - Callback when stream closes
   * @param {Function} onError - Callback on stream error
   */
  async startReadingMessages(onMessage, onClose, onError) {
    this.adapterRunning.set(1);
    await this.adapter.start(onMessage, onClose, onError);
  }

  /**
   * Stop the pipeline
   */
  async shutdown() {
    orchestratorLogger.info('Shutting down...');

    if (this.adapter) {
      await this.adapter.stop();
    }

    this.adapterRunning.set(0);

    orchestratorLogger.info('Shutdown complete');
  }

  /**
   * Check status
   */
  getStatus() {
    return {
      adapterRunning: this.adapter && this.adapter.isRunning(),
      adapterConfigured: !!this.config.adapter,
    };
  }
}

export default Orchestrator;
