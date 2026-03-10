import { createAdapterFromClass } from './lib/runtime/adapter-loader.js';
import { runService } from './lib/runtime/service.js';

export function bootstrapWithAdapter(AdapterClass) {
  if (typeof AdapterClass !== 'function') {
    throw new TypeError('bootstrapWithAdapter requires an adapter class/constructor');
  }

  return runService({
    adapterFactory: (adapterConfig) => createAdapterFromClass(AdapterClass, adapterConfig),
  });
}
