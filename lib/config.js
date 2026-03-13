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

/**
 * Retrieve a core-prefixed environment variable value.
 * @param {string} key - The environment variable name suffix (without the `INGEST_CORE__` prefix).
 * @param {?string} [fallback=null] - Value to return if the environment variable is not set.
 * @returns {?string} The environment variable value if defined, otherwise the provided `fallback`.
 */
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

/**
 * Convert a value to an integer, returning a fallback when the input is null, undefined, empty, or not a valid integer.
 * @param {*} value - The value to parse as an integer.
 * @param {?number} [fallback=null] - Value to return when parsing fails.
 * @returns {?number} The parsed integer, or the provided fallback.
 */
function parseInteger(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Read a secret from a filesystem path, trim it, and validate it is non-empty.
 * @param {string|undefined|null} filePath - Path to the secret file.
 * @returns {{value: string, error: string|null}} An object where `value` is the trimmed file contents on success (or empty string on failure), and `error` is `null` on success or an error message describing the failure.
 */
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

/**
 * Parse API target configurations from environment variables.
 *
 * Reads API definitions from INGEST_CORE__API_<n>_(URL|NAME|KEY|KEY_FILE) variables and from legacy aliases (API_URL, API_NAME, API_KEY, API_KEY_FILE mapped to index 1), resolves KEY_FILE contents from disk, and aggregates per-target configuration, file-read errors, and conflicts.
 *
 * @returns {{targets: Array<{id: string, name: string, url: string, apiKey: string}>, conflicts: string[], fileErrors: string[]}}
 *   An object containing:
 *   - `targets`: ordered array of API target objects (each with `id`, `name`, `url`, and `apiKey`).
 *   - `conflicts`: array of human-readable messages for targets that define both `KEY` and `KEY_FILE`.
 *   - `fileErrors`: array of human-readable messages for errors encountered while reading key files.
 */
function parseApiTargetsFromEnv() {
  const byIndex = new Map();
  const fileErrors = [];
  const conflicts = new Set();

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
  const aliasUrlDefined = Object.prototype.hasOwnProperty.call(process.env, 'INGEST_CORE__API_URL');
  const aliasNameDefined = Object.prototype.hasOwnProperty.call(process.env, 'INGEST_CORE__API_NAME');
  const aliasKeyEnvDefined = Object.prototype.hasOwnProperty.call(process.env, 'INGEST_CORE__API_KEY');
  const aliasKeyFileDefined = Object.prototype.hasOwnProperty.call(process.env, 'INGEST_CORE__API_KEY_FILE');
  if (
    aliasUrl ||
    aliasName ||
    aliasKeyEnv ||
    aliasKeyFile ||
    aliasUrlDefined ||
    aliasNameDefined ||
    aliasKeyEnvDefined ||
    aliasKeyFileDefined
  ) {
    const target = ensureTarget(1);
    if (aliasUrlDefined) {
      target.url = aliasUrl;
    }
    if (aliasNameDefined && aliasName) {
      target.name = aliasName;
    }
    if (aliasKeyEnvDefined) {
      target.apiKey = aliasKeyEnv;
      target.hasKeyEnv = true;
    }
    if (aliasKeyFileDefined) {
      target.hasKeyFile = true;
      if (target.hasKeyEnv) {
        conflicts.add(`API target ${target.id} has both KEY and KEY_FILE defined`);
      } else {
        const { value, error } = readSecretFromFile(aliasKeyFile);
        target.apiKey = value;
        if (error) {
          fileErrors.push(`API target ${target.id} ${error}`);
        }
      }
    }
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
      if (index === 1 && aliasUrlDefined) {
        conflicts.add(`API target ${target.id} URL is defined by both API_URL and API_1_URL`);
        continue;
      }
      target.url = String(value ?? '').trim();
    }
    if (field === 'NAME') {
      if (index === 1 && aliasNameDefined) {
        conflicts.add(`API target ${target.id} name is defined by both API_NAME and API_1_NAME`);
        continue;
      }
      const parsedName = String(value ?? '').trim();
      if (parsedName) {
        target.name = parsedName;
      }
    }
    if (field === 'KEY') {
      if (index === 1 && (aliasKeyEnvDefined || aliasKeyFileDefined)) {
        conflicts.add(`API target ${target.id} key is defined by both API_KEY/API_KEY_FILE and API_1_KEY`);
        continue;
      }
      if (target.hasKeyFile) {
        conflicts.add(`API target ${target.id} has both KEY and KEY_FILE defined`);
        continue;
      }
      target.apiKey = String(value ?? '').trim();
      target.hasKeyEnv = true;
    }
    if (field === 'KEY_FILE') {
      if (index === 1 && (aliasKeyEnvDefined || aliasKeyFileDefined)) {
        conflicts.add(`API target ${target.id} key is defined by both API_KEY/API_KEY_FILE and API_1_KEY_FILE`);
        continue;
      }
      if (target.hasKeyEnv) {
        conflicts.add(`API target ${target.id} has both KEY and KEY_FILE defined`);
        continue;
      }
      const { value: secretValue, error } = readSecretFromFile(value);
      target.apiKey = secretValue;
      if (error) {
        fileErrors.push(`API target ${target.id} ${error}`);
      }
      target.hasKeyFile = true;
    }
  }

  if (byIndex.size === 0) {
    return { targets: [], conflicts: Array.from(conflicts), fileErrors };
  }

  const targets = Array.from(byIndex.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, target]) => target);

  return {
    targets: targets.map(({ hasKeyEnv: _hasKeyEnv, hasKeyFile: _hasKeyFile, ...target }) => target),
    conflicts: Array.from(conflicts),
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
 * Validate runtime configuration and abort startup on fatal issues.
 *
 * Checks that at least one API target is configured, collects any API-target conflicts
 * and secret-file read errors, and verifies each target has an id, url, and apiKey.
 * If any validation errors are found, logs them and terminates the process with exit code 1.
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

  const nameToIds = new Map();
  config.apiTargets.forEach((target, index) => {
    const normalizedName = String(target.name || '').trim();
    if (!normalizedName) {
      return;
    }
    const id = target.id || `index-${index + 1}`;
    if (!nameToIds.has(normalizedName)) {
      nameToIds.set(normalizedName, []);
    }
    nameToIds.get(normalizedName).push(id);
  });

  nameToIds.forEach((ids, name) => {
    if (ids.length > 1) {
      errors.push(`Duplicate API target name '${name}' used by ids: ${ids.join(',')}`);
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
