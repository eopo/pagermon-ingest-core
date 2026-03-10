import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import config from '../config.js';
import ApiClient from '../core/ApiClient.js';
import QueueManager from '../core/QueueManager.js';
import HealthMonitor from '../core/HealthMonitor.js';
import Worker from '../core/Worker.js';
import Orchestrator from './pipeline.js';
import logger from './logger.js';
import { createMetrics } from './metrics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
const { version } = packageJson;
const serviceLogger = logger.child({ component: 'main' });

export async function runService({
  adapterFactory,
  ApiClientClass = ApiClient,
  QueueManagerClass = QueueManager,
  HealthMonitorClass = HealthMonitor,
  WorkerClass = Worker,
} = {}) {
  let orchestrator;
  let api;
  let queue;
  let health;
  let worker;
  let metrics;

  async function shutdown(code = 0) {
    serviceLogger.info('Shutting down...');

    try {
      if (orchestrator) {
        await orchestrator.shutdown();
      }

      if (worker) {
        await worker.stop();
      }

      if (queue) {
        await queue.close();
      }

      if (health) {
        health.stop();
      }

      metrics.close();

      serviceLogger.info('Shutdown complete');

      process.exit(code);
    } catch (err) {
      serviceLogger.error('Shutdown error:', err.message);
      process.exit(1);
    }
  }

  config.validate();

  serviceLogger.info(`${'='.repeat(60)}`);
  serviceLogger.info(`Pagermon Ingest Service v${version}`);
  serviceLogger.info(`${'='.repeat(60)}`);
  serviceLogger.info(`Label:                 ${config.label}`);
  serviceLogger.info(`API URL:               ${config.apiUrl}`);
  serviceLogger.info(`Redis URL:             ${config.redisUrl}`);
  serviceLogger.info(`Dead Letter Queue:     ${config.enableDLQ ? 'enabled' : 'disabled'}`);
  if (config.metricsEnabled) {
    serviceLogger.info(
      `Metrics:               enabled (http://${config.metricsHost}:${config.metricsPort}${config.metricsPath})`
    );
  }
  serviceLogger.info(`${'='.repeat(60)}`);

  try {
    // Initialize metrics
    serviceLogger.info('Initializing metrics...');
    metrics = createMetrics(config.buildMetricsConfig());

    serviceLogger.info('Metrics initialized');

    await metrics.listen(config.metricsPort, config.metricsHost, config.metricsPath);

    serviceLogger.info('Initializing core services...');

    api = new ApiClientClass({ url: config.apiUrl, apiKey: config.apiKey }, { timeout: 10000, retries: 3 });

    queue = new QueueManagerClass(
      { redisUrl: config.redisUrl },

      {
        queueName: 'sdr-messages',
        enableDLQ: config.enableDLQ,
        metrics,
      }
    );
    await queue.initialize();

    health = new HealthMonitorClass(
      { apiClient: api },
      {
        checkInterval: config.healthCheckInterval,
        unhealthyThreshold: config.healthCheckUnhealthyThreshold,
        metrics,
      }
    );
    health.start();

    worker = new WorkerClass({
      queue,
      apiClient: api,
      health,
      metrics,
    });

    worker.on('messageProcessed', (info) => {
      serviceLogger.info(`Processed: ${info.message.address}`);
    });

    worker.on('messageFailed', (info) => {
      serviceLogger.warn(`Failed: ${info.message.address} - ${info.error}`);
    });

    await worker.start();

    serviceLogger.info('Core services initialized');
    serviceLogger.info('Initializing adapters...');

    orchestrator = new Orchestrator({
      adapter: config.buildAdapterConfig({ metrics }),
      adapterFactory,
      metrics,
    });

    await orchestrator.initialize();

    serviceLogger.info('Starting message processing...');

    await orchestrator.startReadingMessages(
      async (message) => {
        try {
          message.source = config.label;
          await queue.addMessage(message);
        } catch (err) {
          serviceLogger.error('Failed to enqueue message:', err.message);
        }
      },
      () => {
        serviceLogger.error('Message stream closed unexpectedly');
        shutdown(1);
      },
      (err) => {
        serviceLogger.error('Message stream error:', err.message);
        shutdown(1);
      }
    );

    process.on('SIGINT', () => {
      serviceLogger.info('\nReceived SIGINT');
      shutdown(0);
    });

    process.on('SIGTERM', () => {
      serviceLogger.info('Received SIGTERM');
      shutdown(0);
    });

    process.on('SIGQUIT', () => {
      serviceLogger.info('Received SIGQUIT');
      shutdown(0);
    });

    serviceLogger.info('Service started successfully');
  } catch (err) {
    serviceLogger.error('Initialization error:', err.message);
    serviceLogger.error(err.stack);
    process.exit(1);
  }
}
