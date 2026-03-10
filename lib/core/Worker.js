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
   * @param {import('../runtime/metrics.js').Metrics} config.metrics - Metrics instance
   */
  constructor(config) {
    if (!config.queue) throw new Error('Worker requires config.queue');
    if (!config.apiClient) throw new Error('Worker requires config.apiClient');
    if (!config.health) throw new Error('Worker requires config.health');
    if (!config.metrics) throw new Error('Worker requires config.metrics');

    this.queue = config.queue;
    this.apiClient = config.apiClient;
    this.health = config.health;
    this.processing = false;
    this.callbacks = {
      onMessageProcessed: null,
      onMessageFailed: null,
    };

    const m = config.metrics;
    this.processedCounter = m.counter({
      name: 'messages_processed_total',
      help: 'Total number of messages processed successfully',
      labelNames: ['status'],
    });
    this.failedCounter = m.counter({
      name: 'messages_failed_total',
      help: 'Total number of messages that failed processing',
      labelNames: ['reason'],
    });
    this.durationHistogram = m.histogram({
      name: 'message_process_duration_seconds',
      help: 'Duration of message processing in seconds',
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      labelNames: ['status'],
    });
    this.lastMessageTimestamp = m.gauge({
      name: 'last_message_timestamp_seconds',
      help: 'Unix timestamp of the last message processed',
    });
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
    const startTime = Date.now() / 1000; // seconds for prometheus

    try {
      const result = await this.apiClient.submitMessage(messageData);

      console.debug(`[WORKER] Message sent: ${messageData.address}`);

      // Update success metrics
      this.processedCounter.labels({ status: 'success' }).inc();

      // Record duration
      const duration = Date.now() / 1000 - startTime;
      this.durationHistogram.labels({ status: 'success' }).observe(duration);

      // Update last message timestamp
      this.lastMessageTimestamp.set(Math.floor(Date.now() / 1000));

      if (this.callbacks.onMessageProcessed) {
        this.callbacks.onMessageProcessed({
          jobId: job.id,
          message: messageData,
          response: result,
        });
      }

      return result;
    } catch (error) {
      console.warn(`[WORKER] Message failed: ${messageData.address} - ${error.message}`);

      // Update failure metrics
      const reason = error.statusCode ? `http_${error.statusCode}` : 'network_error';
      this.failedCounter.labels({ reason }).inc();

      // Record duration
      const duration = Date.now() / 1000 - startTime;
      this.durationHistogram.labels({ status: 'failure' }).observe(duration);

      // Emit failure callback with retry information
      if (this.callbacks.onMessageFailed) {
        this.callbacks.onMessageFailed({
          jobId: job.id,
          message: messageData,
          error: error.message,
          statusCode: error.statusCode,
          retryable: error.retryable ?? true, // Default to retryable for unknown errors
        });
      }

      // Check if API is unhealthy - always retry regardless of error type
      if (!this.health.isHealthy) {
        throw new Error(`API unhealthy: ${error.message}`, { cause: error });
      }

      // Use error.retryable property to decide if BullMQ should retry
      if (error.retryable === false) {
        // Non-retryable error (auth, client errors) - complete without retry
        return;
      }

      // Retryable error - throw so BullMQ handles exponential backoff
      throw error;
    }
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
