import { runService } from './lib/runtime/service.js';

export function bootstrapWithAdapter(AdapterClass) {
  if (typeof AdapterClass !== 'function') {
    throw new TypeError('bootstrapWithAdapter requires an adapter class/constructor');
  }

  const adapterFactory = (adapterConfig) => new AdapterClass(adapterConfig);
  return runService({ adapterFactory });
}
