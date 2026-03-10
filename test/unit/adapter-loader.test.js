import { describe, expect, it } from 'vitest';

const moduleUrl = new URL('../../lib/runtime/adapter-loader.js', import.meta.url).href;
const validAdapterUrl = new URL('../fixtures/adapter-loader-valid.mjs', import.meta.url).href;
const invalidAdapterUrl = new URL('../fixtures/adapter-loader-invalid.mjs', import.meta.url).href;

async function withAdapterEntry(entryUrl, fn) {
  const original = process.env.INGEST_CORE__ADAPTER_ENTRY;
  process.env.INGEST_CORE__ADAPTER_ENTRY = entryUrl;

  try {
    const module = await import(`${moduleUrl}?t=${Date.now()}_${Math.random()}`);
    return await fn(module);
  } finally {
    if (original === undefined) {
      delete process.env.INGEST_CORE__ADAPTER_ENTRY;
    } else {
      process.env.INGEST_CORE__ADAPTER_ENTRY = original;
    }
  }
}

describe('adapter loader', () => {
  it('loads a valid adapter and passes config through', async () => {
    await withAdapterEntry(validAdapterUrl, async ({ createAdapter }) => {
      const adapter = await createAdapter({ foo: 'bar' });

      expect(adapter.getName()).toBe('fixture-valid-adapter');
      expect(adapter.config.foo).toBe('bar');
    });
  });

  it('throws when adapter does not implement required methods', async () => {
    await withAdapterEntry(invalidAdapterUrl, async ({ createAdapter }) => {
      await expect(createAdapter({})).rejects.toThrow('missing required method: getName()');
    });
  });
});
