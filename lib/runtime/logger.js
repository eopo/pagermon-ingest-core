import pino from 'pino';

const VALID_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);

function resolveLevel() {
  if (process.env.INGEST_TEST_LOG_LEVEL) {
    const explicitTestLevel = String(process.env.INGEST_TEST_LOG_LEVEL).toLowerCase();
    return VALID_LEVELS.has(explicitTestLevel) ? explicitTestLevel : 'silent';
  }

  if (process.env.VITEST) {
    return 'silent';
  }

  const rawLevel =
    process.env.INGEST_CORE__LOG_LEVEL || process.env.INGEST_LOG_LEVEL || process.env.LOG_LEVEL || 'info';
  const normalized = String(rawLevel).toLowerCase();
  return VALID_LEVELS.has(normalized) ? normalized : 'info';
}

const logger = pino({
  level: resolveLevel(),
  messageKey: 'message',
  formatters: {
    level: (label) => ({ level: label }),
  },
});

export default logger;
