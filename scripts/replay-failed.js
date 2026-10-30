import config from '../lib/config.js';
import QueueManager from '../lib/core/QueueManager.js';
import { createMetrics } from '../lib/runtime/metrics.js';

function parseArgs(args) {
  const options = { limit: 100 };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--job-id') {
      options.jobId = args[index + 1];
      if (!options.jobId) throw new Error('--job-id requires a job ID');
      index++;
    } else if (arg === '--limit') {
      options.limit = Number(args[index + 1]);
      index++;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.jobId && !String(options.jobId).trim()) {
    throw new Error('--job-id requires a job ID');
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 500) {
    throw new Error('--limit must be an integer between 1 and 500');
  }
  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log('Usage: npm run replay-failed [-- --limit N] [--job-id ID]');
    console.log('List retained failed jobs, or retry one by its exact BullMQ job ID.');
    return;
  }

  const metrics = createMetrics(config.buildMetricsConfig());
  const queue = new QueueManager({ redisUrl: config.redisUrl }, { metrics });

  try {
    await queue.initialize();
    if (options.jobId) {
      const retried = await queue.retryDeadLetter(options.jobId);
      if (!retried) {
        console.error(`Failed job not found: ${options.jobId}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Queued failed job for retry: ${options.jobId}`);
      return;
    }

    const failed = await queue.getDeadLetters(options.limit);
    if (failed.length === 0) {
      console.log('No retained failed jobs found.');
      return;
    }

    failed.forEach((job) => {
      console.log(
        `${job.id}\ttarget=${job.targetId}\tretryable=${job.retryable}\tattempts=${job.attemptsMade}\treason=${job.failedReason}`
      );
    });
    console.log(`Listed ${failed.length} failed job(s). Use --job-id <ID> to retry one.`);
  } catch (error) {
    console.error(`Failed to access the message queue: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await queue.close();
    metrics.close();
  }
}

await main();
