import { afterEach, describe, expect, it } from 'vitest';
import { UnrecoverableError } from 'bullmq';
import { createMockMetrics } from '../helpers/metrics.js';
import QueueManager from '../../lib/core/QueueManager.js';

const redisUrl = process.env.INGEST_TEST_REDIS_URL;
const describeWithRedis = redisUrl ? describe : describe.skip;

async function waitForState(queue, jobId, expectedState, deadline = Date.now() + 10000) {
  const job = await queue.getJob(jobId);
  if (job && (await job.getState()) === expectedState) return job;
  if (Date.now() >= deadline) {
    throw new Error(`Job ${jobId} did not reach state ${expectedState}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 25));
  return waitForState(queue, jobId, expectedState, deadline);
}

async function recoverUntilComplete(recovered, contender, count, replayed = 0, remainingBatches = 6) {
  if (replayed >= count || remainingBatches === 0) return replayed;
  const replayCounts = await Promise.all([
    recovered.recoverFailedJobs('target-a'),
    contender.recoverFailedJobs('target-a'),
  ]);
  return recoverUntilComplete(
    recovered,
    contender,
    count,
    replayed + replayCounts.reduce((sum, total) => sum + total, 0),
    remainingBatches - 1
  );
}

describeWithRedis('BullMQ failed-job recovery', () => {
  let managers = [];
  let queueName;

  afterEach(async () => {
    await Promise.all(managers.map((manager) => manager.close()));
    managers = [];
    if (queueName) {
      const cleanup = new QueueManager({ redisUrl }, { queueName, metrics: createMockMetrics() });
      await cleanup.initialize();
      await cleanup.queue.obliterate({ force: true });
      await cleanup.close();
      queueName = null;
    }
  });

  it('retains failed jobs across restart and replays only the healthy target once', async () => {
    queueName = `queue-recovery-${Date.now()}`;
    const first = new QueueManager({ redisUrl }, { queueName, metrics: createMockMetrics(), enableDLQ: true });
    managers.push(first);
    await first.initialize();

    const jobIds = ['target-a-1', 'target-a-2', 'target-a-3', 'target-b-1', 'permanent-a', 'auth-a'];
    const jobs = await Promise.all(
      jobIds.map((id) =>
        first.queue.add(
          'message',
          {
            address: id,
            targetId: id.startsWith('target-b') ? 'target-b' : 'target-a',
            __ingestCoreFailure: {
              retryable: !['permanent-a', 'auth-a'].includes(id),
              reason: ['permanent-a', 'auth-a'].includes(id) ? 'Unauthorized' : 'API unavailable',
              statusCode: id === 'auth-a' ? 401 : id === 'permanent-a' ? 400 : 500,
            },
          },
          { jobId: id, attempts: 1, removeOnComplete: false }
        )
      )
    );

    first.startProcessing((job) => {
      if (job.data.__ingestCoreFailure.retryable === false) {
        throw new UnrecoverableError(job.data.__ingestCoreFailure.reason);
      }
      throw new Error('API unavailable');
    });

    await Promise.all(jobs.map((job) => waitForState(first.queue, job.id, 'failed')));
    const deadLetters = await first.getDeadLetters(10);
    expect(deadLetters).toHaveLength(6);
    expect(deadLetters.find(({ id }) => id === 'permanent-a')).toMatchObject({
      retryable: false,
      failedReason: 'Unauthorized',
      data: { address: 'permanent-a', targetId: 'target-a' },
    });
    expect(deadLetters.find(({ id }) => id === 'auth-a')).toMatchObject({
      retryable: false,
      failedReason: 'Unauthorized',
      data: { address: 'auth-a', targetId: 'target-a' },
    });

    await first.close();
    managers = [];

    const recovered = new QueueManager(
      { redisUrl },
      { queueName, metrics: createMockMetrics(), enableDLQ: true, recoveryBatchSize: 2 }
    );
    const contender = new QueueManager(
      { redisUrl },
      { queueName, metrics: createMockMetrics(), enableDLQ: true, recoveryBatchSize: 2 }
    );
    managers.push(recovered, contender);
    await Promise.all([recovered.initialize(), contender.initialize()]);

    const replayed = await recoverUntilComplete(recovered, contender, 4);
    expect(replayed).toBe(4);

    const delivered = [];
    recovered.startProcessing((job) => {
      delivered.push(job.id);
      return { ok: true };
    });

    await Promise.all(
      ['target-a-1', 'target-a-2', 'target-a-3', 'auth-a'].map((id) => waitForState(recovered.queue, id, 'completed'))
    );
    expect(delivered.sort()).toEqual(['auth-a', 'target-a-1', 'target-a-2', 'target-a-3']);
    expect(await (await recovered.queue.getJob('target-b-1')).getState()).toBe('failed');
    expect(await (await recovered.queue.getJob('permanent-a')).getState()).toBe('failed');
  }, 20000);
});
