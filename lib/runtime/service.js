import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import config from '../config.js';
import ApiClient from '../core/ApiClient.js';
import QueueManager from '../core/QueueManager.js';
import HealthMonitor from '../core/HealthMonitor.js';
import Worker from '../core/Worker.js';
import Orchestrator from './pipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf-8'));
const { version } = packageJson;

export async function runService({ adapterFactory } = {}) {
  let orchestrator = null;
  let api = null;
  let queue = null;
  let health = null;
  let worker = null;

  async function shutdown(code = 0) {
    console.log('[MAIN] Shutting down...');

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

      console.log('[MAIN] Shutdown complete');
      process.exit(code);
    } catch (err) {
      console.error('[MAIN] Shutdown error:', err.message);
      process.exit(1);
    }
  }

  config.validate();

  console.log(`${'='.repeat(60)}`);
  console.log(`Pagermon Ingest Service v${version}`);
  console.log(`${'='.repeat(60)}`);
  console.log(`Label:                 ${config.label}`);
  console.log('Adapter:               /app/adapter/adapter.js');
  console.log(`API URL:               ${config.apiUrl}`);
  console.log(`Redis URL:             ${config.redisUrl}`);
  console.log(`Dead Letter Queue:     ${config.enableDLQ ? 'enabled' : 'disabled'}`);
  console.log(`${'='.repeat(60)}`);

  try {
    console.log('[MAIN] Initializing core services...');

    api = new ApiClient({ url: config.apiUrl, apiKey: config.apiKey }, { timeout: 10000, retries: 3 });

    queue = new QueueManager({ redisUrl: config.redisUrl }, { queueName: 'sdr-messages', enableDLQ: config.enableDLQ });
    await queue.initialize();

    health = new HealthMonitor(
      { apiClient: api },
      {
        checkInterval: config.healthCheckInterval,
        unhealthyThreshold: config.healthCheckUnhealthyThreshold,
      }
    );
    health.start();

    worker = new Worker({
      queue,
      apiClient: api,
      health,
    });

    worker.on('messageProcessed', (info) => {
      console.debug(`[WORKER] Processed: ${info.message.address}`);
    });

    worker.on('messageFailed', (info) => {
      console.warn(`[WORKER] Failed: ${info.message.address} - ${info.error}`);
    });

    await worker.start();

    console.log('[MAIN] Core services initialized');
    console.log('[MAIN] Initializing adapters...');

    orchestrator = new Orchestrator({
      adapter: config.buildAdapterConfig(),
      adapterFactory,
    });

    await orchestrator.initialize();

    console.log('[MAIN] Starting message processing...');

    await orchestrator.startReadingMessages(
      async (message) => {
        try {
          message.source = config.label;
          await queue.addMessage(message);
        } catch (err) {
          console.error('[MAIN] Failed to enqueue message:', err.message);
        }
      },
      () => {
        console.error('[MAIN] Message stream closed unexpectedly');
        shutdown(1);
      },
      (err) => {
        console.error('[MAIN] Message stream error:', err.message);
        shutdown(1);
      }
    );

    process.on('SIGINT', () => {
      console.log('\n[MAIN] Received SIGINT');
      shutdown(0);
    });

    process.on('SIGTERM', () => {
      console.log('[MAIN] Received SIGTERM');
      shutdown(0);
    });

    process.on('SIGQUIT', () => {
      console.log('[MAIN] Received SIGQUIT');
      shutdown(0);
    });

    console.log('[MAIN] Service started successfully');
  } catch (err) {
    console.error('[MAIN] Initialization error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}
