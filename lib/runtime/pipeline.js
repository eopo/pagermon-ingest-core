/**
 * Orchestration Pipeline
 *
 * Orchestrates a unified source adapter.
 * Used by the main application and contains no business logic.
 */

import { createAdapter } from './adapter-loader.js';

class Orchestrator {
  /**
   * @param {Object} config
   * @param {Object} config.adapter - Adapter configuration object
   */
  constructor(config) {
    if (!config.adapter) {
      throw new Error('Orchestrator requires adapter config');
    }

    this.config = config;
    this.adapterFactory = config.adapterFactory || createAdapter;
    this.adapter = null;
  }

  /**
   * Initialize source adapter
   */
  async initialize() {
    this.adapter = await this.adapterFactory(this.config.adapter);
    console.log(`[ORCHESTRATOR] Source adapter: ${this.adapter.getName()}`);
  }

  /**
   * Start reading messages from the adapter
   * @param {Function} onMessage - Callback for each parsed message
   * @param {Function} onClose - Callback when stream closes
   * @param {Function} onError - Callback on stream error
   */
  async startReadingMessages(onMessage, onClose, onError) {
    await this.adapter.start(onMessage, onClose, onError);
  }

  /**
   * Stop the pipeline
   */
  async shutdown() {
    console.log('[ORCHESTRATOR] Shutting down...');

    if (this.adapter) {
      await this.adapter.stop();
    }

    console.log('[ORCHESTRATOR] Shutdown complete');
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
