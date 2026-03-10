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

/**
 * Create a central mock logger for unit tests.
 * Pass `vi` to get spy-enabled methods.
 * @param {Object} [viRef] - Vitest namespace (`vi`) or any object with `fn()`
 * @param {Object} bindings - Logger bindings/context
 * @returns {Object} Mock logger with pino-like API
 */
export function createMockLogger(viRef, bindings = {}) {
  const makeMethod = viRef && typeof viRef.fn === 'function' ? () => viRef.fn() : () => () => undefined;

  return {
    bindings,
    trace: makeMethod(),
    debug: makeMethod(),
    info: makeMethod(),
    warn: makeMethod(),
    error: makeMethod(),
    fatal: makeMethod(),
    child: (childBindings = {}) => createMockLogger(viRef, { ...bindings, ...childBindings }),
  };
}

export default logger;
