/**
 * Message Queue Manager - BullMQ based message queue
 *
 * Handles message queue management only.
 */

import { Queue, Worker as BullWorker } from 'bullmq';
import IORedis from 'ioredis';
import logger from '../runtime/logger.js';

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
    this.worker = null;
    this.connection = null;
    this.workerConnection = null;
    this.enableDLQ = options.enableDLQ !== false;
    this.recoveryBatchSize = options.recoveryBatchSize || 100;
    this.recoveryOffsets = new Map();
    this.recoveringTargets = new Set();
    this.logger = options.logger || logger.child({ component: 'queue' });

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
        removeOnFail: false,
      },
    });

    this.startMetricsCollection();

    this.logger.info(`Initialized: ${this.queueName}`);
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
    const targetId = String(payload.targetId || 'default');
    const job = await this.queue.add('message', payload, {
      jobId: `msg-${targetId}-${payload.source}-${payload.address}-${payload.timestamp}`,
    });

    this.logger.debug(`Added job ${job.id}`);
    this.enqueuedCounter.inc();
    this.queueDepthGauge.inc();
    return job;
  }

  /**
   * Get retained failed messages
   * @returns {Promise<Object[]>}
   */
  async getDeadLetters(limit = 100) {
    if (!this.queue || !Number.isFinite(Number(limit)) || Number(limit) <= 0) {
      return [];
    }

    const jobs = await this.queue.getJobs(['failed'], 0, Math.floor(limit) - 1);
    return jobs.map((job) => ({
      id: job.id,
      data: this._getMessageData(job.data),
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      targetId: String(job.data?.targetId || 'default'),
      retryable: job.data?.__ingestCoreFailure?.retryable ?? true,
    }));
  }

  /**
   * Retry a retained failed job by its existing ID.
   * @param {string} jobId
   * @returns {Promise<boolean>}
   */
  async retryDeadLetter(jobId) {
    if (!this.queue) throw new Error('Queue not initialized. Call initialize() first.');

    const job = await this.queue.getJob(jobId);
    if (!job || (await job.getState()) !== 'failed') {
      return false;
    }

    await job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
    this.queueDepthGauge.inc();
    this.logger.info(`Manually replayed failed job ${job.id}`);
    return true;
  }

  /**
   * Replay a bounded page of failed jobs for one healthy API target.
   * Existing failed jobs without recovery metadata are treated as retryable.
   * @param {string} targetId
   * @param {number} [limit]
   * @returns {Promise<number>}
   */
  async recoverFailedJobs(targetId, limit = this.recoveryBatchSize) {
    if (!this.enableDLQ || !this.queue) return 0;

    const target = String(targetId || 'default');
    if (this.recoveringTargets.has(target)) return 0;

    this.recoveringTargets.add(target);
    try {
      const batchSize = Math.max(1, Math.min(500, Math.floor(Number(limit)) || this.recoveryBatchSize));
      const start = this.recoveryOffsets.get(target) || 0;
      const jobs = await this.queue.getJobs(['failed'], start, start + batchSize - 1);
      this.recoveryOffsets.set(target, jobs.length < batchSize ? 0 : start + jobs.length);

      const replayResults = await Promise.all(
        jobs.map(async (job) => {
          if (String(job.data?.targetId || 'default') !== target) return false;
          const failure = job.data?.__ingestCoreFailure;
          const authenticationFailure = [401, 403].includes(Number(failure?.statusCode));
          if (failure?.retryable === false && !authenticationFailure) return false;

          try {
            await job.retry('failed', { resetAttemptsMade: true, resetAttemptsStarted: true });
            this.logger.info(`Replayed failed job ${job.id} for target ${target}`);
            return true;
          } catch (error) {
            // Another process may have changed the job state after the failed-job scan.
            this.logger.debug(`Skipped failed job ${job.id} during recovery: ${error.message}`);
            return false;
          }
        })
      );
      const recovered = replayResults.filter(Boolean).length;
      if (recovered > 0) {
        this.queueDepthGauge.inc(recovered);
      }

      return recovered;
    } finally {
      this.recoveringTargets.delete(target);
    }
  }

  /**
   * Remove recovery metadata before exposing or delivering the original message.
   * @private
   */
  _getMessageData(data = {}) {
    const { __ingestCoreFailure: _failure, ...message } = data;
    return message;
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
      this.logger.error('Worker error:', err.message);
    });

    this.worker.on('completed', () => {
      this.queueDepthGauge.dec();
    });

    this.worker.on('failed', (job) => {
      if (
        job &&
        (job.attemptsMade >= (job.opts?.attempts ?? 1) || job.data?.__ingestCoreFailure?.retryable === false)
      ) {
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
    if (this.connection) {
      await this.connection.quit();
      this.connection = null;
    }
    if (this.workerConnection) {
      await this.workerConnection.quit();
      this.workerConnection = null;
    }
    this.logger.info('Closed');
  }
}

export default QueueManager;
