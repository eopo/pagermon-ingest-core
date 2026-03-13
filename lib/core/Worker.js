/**
 * Worker - queue consumer that submits messages to the API
 *
 * Consumes messages from the queue and submits them to the API.
 */

import logger from '../runtime/logger.js';

const workerLogger = logger.child({ component: 'worker' });

class Worker {
  /**
   * @param {Object} config
   * @param {QueueManager} config.queue - Queue manager
   * @param {Object.<string, ApiClient>} config.apiClients - API clients mapped by targetId
   * @param {Object.<string, HealthMonitor>} [config.healthByTarget] - Health monitors mapped by targetId
   * @param {HealthMonitor} [config.health] - Legacy single health monitor fallback
   * @param {import('../runtime/metrics.js').Metrics} config.metrics - Metrics instance
   */
  constructor(config) {
    if (!config.queue) throw new Error('Worker requires config.queue');
    if (!config.apiClients) throw new Error('Worker requires config.apiClients');
    if (!config.healthByTarget && !config.health)
      throw new Error('Worker requires config.healthByTarget or config.health');
    if (!config.metrics) throw new Error('Worker requires config.metrics');

    this.queue = config.queue;
    this.apiClients = config.apiClients;
    this.healthByTarget = config.healthByTarget || { default: config.health };
    this.targetNamesById = config.targetNamesById || {};
    this.processing = false;
    this.callbacks = {
      onMessageProcessed: null,
      onMessageFailed: null,
    };

    const m = config.metrics;
    this.processedCounter = m.counter({
      name: 'messages_processed_total',
      help: 'Total number of messages processed successfully',
      labelNames: ['status', 'target_name'],
    });
    this.failedCounter = m.counter({
      name: 'messages_failed_total',
      help: 'Total number of messages that failed processing',
      labelNames: ['reason', 'target_name'],
    });
    this.durationHistogram = m.histogram({
      name: 'message_process_duration_seconds',
      help: 'Duration of message processing in seconds',
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      labelNames: ['status', 'target_name'],
    });
    this.lastMessageTimestamp = m.gauge({
      name: 'last_message_timestamp_seconds',
      help: 'Unix timestamp of the last message processed',
      labelNames: ['target_name'],
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
    workerLogger.info('Starting queue consumer');

    if (!this.queue.queue) {
      await this.queue.initialize();
    }

    this.processing = true;

    // Process each message via QueueManager/BullMQ worker
    this.queue.startProcessing((job) => this._processMessage(job));

    workerLogger.info('Queue consumer started');
  }

  /**
   * Process a single message
   * @private
   */
  async _processMessage(job) {
    const messageData = job.data;
    const hasExplicitTargetId = Object.prototype.hasOwnProperty.call(messageData, 'targetId');
    const targetId = String(messageData.targetId || 'default');
    const targetName = this.targetNamesById[targetId] || targetId;
    const startTime = Date.now() / 1000; // seconds for prometheus

    try {
      const { targetId: _targetId, ...payload } = messageData;
      const apiClient = this.apiClients[targetId];
      const targetHealth = this.healthByTarget[targetId] || this.healthByTarget.default || null;

      if (!apiClient) {
        const missingTargetError = new Error(`No ApiClient configured for targetId=${targetId}`);
        if (hasExplicitTargetId) {
          missingTargetError.retryable = false;
        }
        throw missingTargetError;
      }

      if (targetHealth && targetHealth.isHealthy === false) {
        const unhealthyError = new Error(`API target unhealthy: ${targetId}`);
        unhealthyError.retryable = true;
        throw unhealthyError;
      }

      const result = await apiClient.submitMessage(payload);

      workerLogger.debug(`Message ${job.id} ${result.reason}${result.id ? ` -> ${result.id}` : ''}`);

      // Update success metrics
      this.processedCounter.labels({ status: 'success', target_name: targetName }).inc();

      // Record duration
      const duration = Date.now() / 1000 - startTime;
      this.durationHistogram.labels({ status: 'success', target_name: targetName }).observe(duration);

      // Update last message timestamp
      this.lastMessageTimestamp.labels({ target_name: targetName }).set(Math.floor(Date.now() / 1000));

      if (this.callbacks.onMessageProcessed) {
        this.callbacks.onMessageProcessed({
          jobId: job.id,
          message: messageData,
          response: result,
        });
      }

      return result;
    } catch (error) {
      workerLogger.warn(`Message failed: address=${messageData.address}, error=${error.message}`);

      // Update failure metrics
      const reason = error.statusCode ? `http_${error.statusCode}` : 'network_error';
      this.failedCounter.labels({ reason, target_name: targetName }).inc();

      // Record duration
      const duration = Date.now() / 1000 - startTime;
      this.durationHistogram.labels({ status: 'failure', target_name: targetName }).observe(duration);

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
    workerLogger.info('Worker stopped');
  }
}

export default Worker;
