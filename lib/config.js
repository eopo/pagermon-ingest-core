/**
 * Configuration Module
 *
 * Configuration prefixes:
 * - Core: INGEST_CORE__*
 * - Adapter: INGEST_ADAPTER__*
 */

import logger from './runtime/logger.js';

function getCoreEnv(key, fallback = null) {
  const value = process.env[`INGEST_CORE__${key}`];
  return value !== undefined ? value : fallback;
}

function parseAdapterConfig() {
  const result = {};

  for (const [envKey, value] of Object.entries(process.env)) {
    if (!envKey.startsWith('INGEST_ADAPTER__')) {
      continue;
    }

    const tail = envKey.slice('INGEST_ADAPTER__'.length);
    const parts = tail.split('__').filter(Boolean);

    // Expected minimum: <KEY>
    if (parts.length < 1) {
      continue;
    }

    const path = parts.map((part) => part.toLowerCase());
    let node = result;
    for (let i = 0; i < path.length - 1; i++) {
      const segment = path[i];
      if (typeof node[segment] !== 'object' || node[segment] === null) {
        node[segment] = {};
      }
      node = node[segment];
    }

    node[path[path.length - 1]] = value;
  }

  return result;
}

function getAdapterRawEnv() {
  const raw = {};
  for (const [envKey, value] of Object.entries(process.env)) {
    if (envKey.startsWith('INGEST_ADAPTER__')) {
      raw[envKey] = value;
    }
  }
  return raw;
}

function parseInteger(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const adapterConfig = parseAdapterConfig();
const adapterRawEnv = getAdapterRawEnv();

const config = {
  // Service configuration
  label: getCoreEnv('LABEL', 'pagermon-ingest'),

  // Adapter configuration (single adapter prefix)
  adapterConfig,
  adapterRawEnv,

  // Core services configuration
  apiUrl: getCoreEnv('API_URL', 'http://pagermon:3000'),
  apiKey: getCoreEnv('API_KEY', null),
  redisUrl: getCoreEnv('REDIS_URL', 'redis://redis:6379'),
  enableDLQ: getCoreEnv('ENABLE_DLQ', 'true') !== 'false',

  // Health check configuration
  healthCheckInterval: parseInteger(getCoreEnv('HEALTH_CHECK_INTERVAL', '10000'), 10000),
  healthCheckUnhealthyThreshold: parseInteger(getCoreEnv('HEALTH_UNHEALTHY_THRESHOLD', '3'), 3),
};

/**
 * Validate required configuration
 */
function validate() {
  const errors = [];

  if (!config.apiKey) {
    errors.push('INGEST_CORE__API_KEY not set');
  }

  if (errors.length > 0) {
    logger.error('Configuration errors:');
    errors.forEach((e) => logger.error(`  - ${e}`));
    process.exit(1);
  }
}

/**
 * Build source adapter configuration
 */
function buildAdapterConfig() {
  const adapterLogger = logger.child({ component: 'adapter' });

  return {
    label: config.label,
    adapter: config.adapterConfig,
    rawEnv: config.adapterRawEnv,
    logger: adapterLogger,
  };
}

export default {
  ...config,
  validate,
  buildAdapterConfig,
};
