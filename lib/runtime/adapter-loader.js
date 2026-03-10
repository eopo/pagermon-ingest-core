import logger from './logger.js';

const DEFAULT_ADAPTER_ENTRY = '/app/adapter/adapter.js';
const REQUIRED_METHODS = ['getName', 'start', 'stop', 'isRunning'];

function getAdapterEntry() {
  const configured = process.env.INGEST_CORE__ADAPTER_ENTRY;
  return configured && configured.trim() ? configured.trim() : DEFAULT_ADAPTER_ENTRY;
}

function validateAdapterInstance(instance) {
  if (!instance || typeof instance !== 'object') {
    throw new TypeError('Selected adapter must be an object instance');
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof instance[method] !== 'function') {
      throw new TypeError(`Selected adapter missing required method: ${method}()`);
    }
  }
}

export function createAdapterFromClass(AdapterClass, adapterConfig = {}) {
  if (typeof AdapterClass !== 'function') {
    throw new TypeError('Adapter module must export a default class or constructor function');
  }

  const namespace =
    typeof AdapterClass.adapterName === 'string' && AdapterClass.adapterName.trim().length > 0
      ? AdapterClass.adapterName
      : AdapterClass.name || 'adapter';

  const adapterLogger =
    adapterConfig.logger && typeof adapterConfig.logger.child === 'function'
      ? adapterConfig.logger
      : logger.child({ component: 'adapter', adapter: namespace });

  const instance = new AdapterClass({ ...adapterConfig, logger: adapterLogger });
  validateAdapterInstance(instance);
  return instance;
}

export async function createAdapter(config) {
  const module = await import(getAdapterEntry());
  return createAdapterFromClass(module.default, config);
}
