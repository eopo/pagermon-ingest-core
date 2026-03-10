/**
 * Message Queue Manager - BullMQ based message queue
 *
 * Handles message queue management only.
 */

import { Queue, Worker as BullWorker } from 'bullmq';
import IORedis from 'ioredis';

class QueueManager {
  /**
   * @param {Object} config
   * @param {string} config.redisUrl - Redis connection URL
   * @param {Object} [options] - Additional options
   * @param {import('../runtime/metrics.js').Metrics} options.metrics - Metrics instance
   */
  constructor(config, options = {}) {
    if (!config.redisUrl) throw new Error('QueueManager requires config.redisUrl');
    if (!options.metrics) throw new Error('QueueManager requires options.metrics');

    this.redisUrl = config.redisUrl;
    this.queueName = options.queueName || 'sdr-messages';
    this.queue = null;
    this.dlq = null;
    this.worker = null;
    this.connection = null;
    this.workerConnection = null;
    this.enableDLQ = options.enableDLQ !== false;

    const m = options.metrics;
    this.enqueuedCounter = m.counter({
      name: 'messages_enqueued_total',
      help: 'Total number of messages added to the queue',
    });
    this.queueDepthGauge = m.gauge({
      name: 'queue_depth_messages',
      help: 'Current number of messages waiting in the queue',
    });
  }

  /**
   * Initialize queue resources
   */
  initialize() {
    this.connection = new IORedis(this.redisUrl, {
      maxRetriesPerRequest: null,
    });

    this.queue = new Queue(this.queueName, {
      connection: this.connection,
      defaultJobOptions: {
        attempts: 10,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: true,
      },
    });

    if (this.enableDLQ) {
      this.dlq = new Queue(`${this.queueName}-dlq`, {
        connection: this.connection,
      });
    }

    this.startMetricsCollection();

    console.log(`[QUEUE] Initialized: ${this.queueName}`);
  }

  /**
   * Start initial queue depth snapshot for metrics
   * @private
   */
  startMetricsCollection() {
    this.getQueueSize()
      .then((count) => this.queueDepthGauge.set(count))
      .catch(() => {});
  }

  /**
   * Enqueue a message
   * @param {Message|Object} message
   * @returns {Promise<Job>}
   */
  async addMessage(message) {
    if (!this.queue) throw new Error('Queue not initialized. Call initialize() first.');

    const payload = message.toPayload ? message.toPayload() : message;
    const job = await this.queue.add('message', payload, {
      jobId: `msg-${payload.source}-${payload.address}-${payload.timestamp}`,
    });

    console.debug(`[QUEUE] Added job ${job.id}`);
    this.enqueuedCounter.inc();
    this.queueDepthGauge.inc();
    return job;
  }

  /**
   * Get failed messages from the DLQ
   * @returns {Promise<Object[]>}
   */
  async getDeadLetters(limit = 100) {
    if (!this.enableDLQ || !this.dlq) {
      return [];
    }

    const jobs = await this.dlq.getJobs(['failed'], 0, Math.max(0, limit - 1));
    return jobs.map((job) => ({
      id: job.id,
      data: job.data,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
    }));
  }

  /**
   * Get current queue size
   */
  async getQueueSize() {
    if (!this.queue) return 0;
    return await this.queue.count();
  }

  /**
   * Start processing jobs using a BullMQ Worker
   * @param {(job: import('bullmq').Job) => Promise<unknown>} processor
   */
  startProcessing(processor) {
    if (this.worker) {
      return;
    }

    // BullMQ worker uses blocking Redis operations; use dedicated connection.
    this.workerConnection = this.connection.duplicate();

    this.worker = new BullWorker(
      this.queueName,
      async (job) => {
        return await processor(job);
      },
      {
        connection: this.workerConnection,
      }
    );

    this.worker.on('error', (err) => {
      console.error('[QUEUE] Worker error:', err.message);
    });

    this.worker.on('completed', () => {
      this.queueDepthGauge.dec();
    });

    this.worker.on('failed', (job) => {
      if (job && job.attemptsMade >= (job.opts?.attempts ?? 1)) {
        this.queueDepthGauge.dec();
      }
    });
  }

  /**
   * Close all queue connections
   */
  async close() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
    if (this.dlq) {
      await this.dlq.close();
      this.dlq = null;
    }
    if (this.connection) {
      await this.connection.quit();
      this.connection = null;
    }
    if (this.workerConnection) {
      await this.workerConnection.quit();
      this.workerConnection = null;
    }
    console.log('[QUEUE] Closed');
  }
}

export default QueueManager;
