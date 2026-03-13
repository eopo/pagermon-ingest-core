/**
 * Configuration Module
 *
 * Configuration prefixes:
 * - Core: INGEST_CORE__*
 * - Adapter: INGEST_ADAPTER__*
 * - Metrics: INGEST_CORE__METRICS_*
 */

import logger from './runtime/logger.js';
import fs from 'node:fs';

function getCoreEnv(key, fallback = null) {
  const value = process.env[`INGEST_CORE__${key}`];
  return value !== undefined ? value : fallback;
}

function parseDefaultLabels(value) {
  if (!value || typeof value !== 'string') {
    return {};
  }

  const labels = {};
  value.split(',').forEach((pair) => {
    const [k, v] = pair.split('=');
    if (k && v) {
      labels[k.trim()] = v.trim();
    }
  });
  return labels;
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

function readSecretFromFile(filePath) {
  const path = String(filePath ?? '').trim();
  if (!path) {
    return { value: '', error: 'KEY_FILE is empty' };
  }

  try {
    const value = fs.readFileSync(path, 'utf8').trim();
    if (!value) {
      return { value: '', error: `KEY_FILE points to empty file: ${path}` };
    }
    return { value, error: null };
  } catch (err) {
    return {
      value: '',
      error: `KEY_FILE could not be read (${path}): ${err.message}`,
    };
  }
}

function parseApiTargetsFromEnv() {
  const byIndex = new Map();
  const fileErrors = [];

  const ensureTarget = (index) => {
    if (!byIndex.has(index)) {
      byIndex.set(index, {
        id: `target-${index}`,
        name: `target-${index}`,
        url: '',
        apiKey: '',
        hasKeyEnv: false,
        hasKeyFile: false,
      });
    }
    return byIndex.get(index);
  };

  // API_URL/API_KEY/API_NAME are aliases for API_1_URL/API_1_KEY/API_1_NAME.
  const aliasUrl = String(getCoreEnv('API_URL', '') ?? '').trim();
  const aliasName = String(getCoreEnv('API_NAME', '') ?? '').trim();
  const aliasKeyFile = String(getCoreEnv('API_KEY_FILE', '') ?? '').trim();
  const aliasKeyEnv = String(getCoreEnv('API_KEY', '') ?? '').trim();
  const aliasKeyEnvDefined = Object.prototype.hasOwnProperty.call(process.env, 'INGEST_CORE__API_KEY');
  const aliasKeyFileDefined = Object.prototype.hasOwnProperty.call(process.env, 'INGEST_CORE__API_KEY_FILE');
  if (aliasUrl || aliasName || aliasKeyEnv || aliasKeyFile || aliasKeyEnvDefined || aliasKeyFileDefined) {
    const target = ensureTarget(1);
    if (aliasUrl) {
      target.url = aliasUrl;
    }
    if (aliasName) {
      target.name = aliasName;
    }
    if (aliasKeyEnv) {
      target.apiKey = aliasKeyEnv;
    }
    if (aliasKeyFile) {
      const { value, error } = readSecretFromFile(aliasKeyFile);
      target.apiKey = value;
      if (error) {
        fileErrors.push(`API target ${target.id} ${error}`);
      }
    }
    target.hasKeyEnv = target.hasKeyEnv || aliasKeyEnvDefined;
    target.hasKeyFile = target.hasKeyFile || aliasKeyFileDefined;
  }

  for (const [envKey, value] of Object.entries(process.env)) {
    const match = envKey.match(/^INGEST_CORE__API_(\d+)_(URL|NAME|KEY|KEY_FILE)$/);
    if (!match) {
      continue;
    }

    const index = parseInt(match[1], 10);
    const field = match[2];
    if (!Number.isInteger(index) || index < 1) {
      continue;
    }

    const target = ensureTarget(index);
    if (field === 'URL') {
      target.url = String(value ?? '').trim();
    }
    if (field === 'NAME') {
      const parsedName = String(value ?? '').trim();
      if (parsedName) {
        target.name = parsedName;
      }
    }
    if (field === 'KEY') {
      target.apiKey = String(value ?? '').trim();
      target.hasKeyEnv = true;
    }
    if (field === 'KEY_FILE') {
      const { value: secretValue, error } = readSecretFromFile(value);
      target.apiKey = secretValue;
      if (error) {
        fileErrors.push(`API target ${target.id} ${error}`);
      }
      target.hasKeyFile = true;
    }
  }

  if (byIndex.size === 0) {
    return { targets: [], conflicts: [], fileErrors };
  }

  const targets = Array.from(byIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, target]) => target);

  const conflicts = targets
    .filter((target) => target.hasKeyEnv && target.hasKeyFile)
    .map((target) => `API target ${target.id} has both KEY and KEY_FILE defined`);

  return {
    targets: targets.map(({ hasKeyEnv: _hasKeyEnv, hasKeyFile: _hasKeyFile, ...target }) => target),
    conflicts,
    fileErrors,
  };
}

const adapterConfig = parseAdapterConfig();
const adapterRawEnv = getAdapterRawEnv();
const parsedApiTargets = parseApiTargetsFromEnv();
const apiTargets = parsedApiTargets.targets;
const apiTargetConflicts = parsedApiTargets.conflicts;
const apiTargetFileErrors = parsedApiTargets.fileErrors || [];

const config = {
  // Service configuration
  label: getCoreEnv('LABEL', 'pagermon-ingest'),

  // Adapter configuration (single adapter prefix)
  adapterConfig,
  adapterRawEnv,

  // Core services configuration
  apiTargets,
  redisUrl: getCoreEnv('REDIS_URL', 'redis://redis:6379'),
  enableDLQ: getCoreEnv('ENABLE_DLQ', 'true') !== 'false',

  // Health check configuration
  healthCheckInterval: parseInteger(getCoreEnv('HEALTH_CHECK_INTERVAL', '10000'), 10000),
  healthCheckUnhealthyThreshold: parseInteger(getCoreEnv('HEALTH_UNHEALTHY_THRESHOLD', '3'), 3),

  // Metrics configuration
  metricsEnabled: getCoreEnv('METRICS_ENABLED', 'false') !== 'false',
  metricsPort: parseInteger(getCoreEnv('METRICS_PORT', '9464'), 9464),
  metricsHost: getCoreEnv('METRICS_HOST', '0.0.0.0'),
  metricsPath: getCoreEnv('METRICS_PATH', '/metrics'),
  metricsPrefix: getCoreEnv('METRICS_PREFIX', 'pagermon_ingest_'),
  metricsDefaultLabels: parseDefaultLabels(getCoreEnv('METRICS_DEFAULT_LABELS', '')),
  metricsCollectDefault: getCoreEnv('METRICS_COLLECT_DEFAULT', 'true') !== 'false',
};

/**
 * Validate required configuration
 */
function validate() {
  const errors = [];

  if (!Array.isArray(config.apiTargets) || config.apiTargets.length === 0) {
    errors.push(
      'No API target configured (set INGEST_CORE__API_URL/INGEST_CORE__API_KEY[_FILE] and/or INGEST_CORE__API_<n>_URL/INGEST_CORE__API_<n>_KEY[_FILE])'
    );
  }

  apiTargetConflicts.forEach((conflict) => {
    errors.push(conflict);
  });

  apiTargetFileErrors.forEach((fileError) => {
    errors.push(fileError);
  });

  config.apiTargets.forEach((target, index) => {
    if (!target.id) {
      errors.push(`API target ${index + 1} missing ID`);
    }

    if (!target.url) {
      errors.push(`API target ${index + 1} missing URL`);
    }

    if (!target.apiKey) {
      errors.push(`API target ${index + 1} missing API key mapping`);
    }
  });

  if (errors.length > 0) {
    logger.error('Configuration errors:');
    errors.forEach((e) => logger.error(`  - ${e}`));
    process.exit(1);
  }
}

/**
 * Build source adapter configuration
 */
function buildAdapterConfig(options = {}) {
  const adapterLogger = options.logger || logger.child({ component: 'adapter' });

  return {
    label: config.label,
    adapter: config.adapterConfig,
    rawEnv: config.adapterRawEnv,
    logger: adapterLogger,
    metrics: options.metrics,
  };
}

/**
 * Build metrics configuration
 */
function buildMetricsConfig() {
  return {
    enabled: config.metricsEnabled,
    prefix: config.metricsPrefix,
    defaultLabels: config.metricsDefaultLabels,
    collectDefaults: config.metricsCollectDefault,
  };
}

export default {
  ...config,
  validate,
  buildAdapterConfig,
  buildMetricsConfig,
};
