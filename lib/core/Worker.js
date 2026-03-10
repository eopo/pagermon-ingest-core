/**
 * Worker - queue consumer that submits messages to the API
 *
 * Consumes messages from the queue and submits them to the API.
 */

class Worker {
  /**
   * @param {Object} config
   * @param {QueueManager} config.queue - Queue manager
   * @param {ApiClient} config.apiClient - API client
   * @param {HealthMonitor} config.health - Health monitor
   */
  constructor(config) {
    if (!config.queue) throw new Error('Worker requires config.queue');
    if (!config.apiClient) throw new Error('Worker requires config.apiClient');
    if (!config.health) throw new Error('Worker requires config.health');

    this.queue = config.queue;
    this.apiClient = config.apiClient;
    this.health = config.health;
    this.processing = false;
    this.callbacks = {
      onMessageProcessed: null,
      onMessageFailed: null,
    };
  }

  /**
   * Register callbacks
   */
  on(event, callback) {
    if (event === 'messageProcessed' || event === 'messageFailed') {
      this.callbacks[`on${event.charAt(0).toUpperCase()}${event.slice(1)}`] = callback;
    }
  }

  /**
   * Start the worker and begin processing jobs
   */
  async start() {
    console.log('[WORKER] Starting queue consumer');

    if (!this.queue.queue) {
      await this.queue.initialize();
    }

    this.processing = true;

    // Process each message via QueueManager/BullMQ worker
    this.queue.startProcessing((job) => this._processMessage(job));

    console.log('[WORKER] Queue consumer started');
  }

  /**
   * Process a single message
   * @private
   */
  async _processMessage(job) {
    const messageData = job.data;

    const result = await this.apiClient.submitMessage(messageData);

    if (result.success) {
      console.debug(`[WORKER] Message sent: ${messageData.address}`);

      if (this.callbacks.onMessageProcessed) {
        this.callbacks.onMessageProcessed({
          jobId: job.id,
          message: messageData,
        });
      }

      return result;
    }
    console.warn(`[WORKER] Message failed: ${messageData.address} - ${result.error}`);

    // If API is unhealthy, throw to trigger queue retry
    if (!this.health.isHealthy) {
      throw new Error(`API unhealthy: ${result.error}`);
    }

    // For other failures, throw only for retryable classes
    if (result.error && result.error.includes('401')) {
      throw new Error('API Authentication failed - will not retry');
    }

    if (result.error && !result.error.includes('4')) {
      // Server-side errors should be retried
      throw new Error(result.error);
    }

    if (this.callbacks.onMessageFailed) {
      this.callbacks.onMessageFailed({
        jobId: job.id,
        message: messageData,
        error: result.error,
      });
    }

    // Return a soft-failure payload without throwing
    return { failed: true, error: result.error };
  }

  /**
   * Stop the worker
   */
  async stop() {
    this.processing = false;
    if (this.queue) {
      await this.queue.close();
    }
    console.log('[WORKER] Worker stopped');
  }
}

export default Worker;
