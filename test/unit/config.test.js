import { describe, expect, it, vi } from 'vitest';
const configModulePath = new URL('../../lib/config.js', import.meta.url).href;

function loadConfigWithEnv(envPatch) {
  const originalEnv = { ...process.env };

  Object.keys(process.env)
    .filter((k) => k.startsWith('INGEST_CORE__') || k.startsWith('INGEST_ADAPTER__'))
    .forEach((k) => {
      delete process.env[k];
    });

  Object.assign(process.env, envPatch);

  return import(`${configModulePath}?t=${Date.now()}_${Math.random()}`).finally(() => {
    Object.keys(process.env).forEach((k) => delete process.env[k]);
    Object.assign(process.env, originalEnv);
  });
}

describe('config', () => {
  it('forwards adapter values from INGEST_ADAPTER__ as structured config', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_KEY: 'abc123',
      INGEST_ADAPTER__FREQUENCIES: '152.405,152.415',
      INGEST_ADAPTER__PROTOCOLS: 'POCSAG512,POCSAG1200',
      INGEST_ADAPTER__SMTP__HOST: 'smtp.example.org',
      INGEST_ADAPTER__SMTP__PORT: '587',
    });

    const adapterConfig = config.buildAdapterConfig();
    expect(adapterConfig.adapter.frequencies).toBe('152.405,152.415');
    expect(adapterConfig.adapter.protocols).toBe('POCSAG512,POCSAG1200');
    expect(adapterConfig.adapter.smtp.host).toBe('smtp.example.org');
    expect(adapterConfig.adapter.smtp.port).toBe('587');
    expect(adapterConfig.rawEnv.INGEST_ADAPTER__SMTP__HOST).toBe('smtp.example.org');
  });

  it('uses sane fallbacks for invalid numeric env values', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_KEY: 'abc123',
      INGEST_CORE__HEALTH_CHECK_INTERVAL: 'invalid',
      INGEST_CORE__HEALTH_UNHEALTHY_THRESHOLD: '',
      INGEST_ADAPTER__FREQUENCIES: '152.405',
      INGEST_ADAPTER__PROTOCOLS: 'POCSAG1200',
      INGEST_ADAPTER__GAIN: 'NaN',
    });

    expect(config.healthCheckInterval).toBe(10000);
    expect(config.healthCheckUnhealthyThreshold).toBe(3);
    expect(config.adapterConfig.gain).toBe('NaN');
  });

  it('validate() exits process when API key is missing', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_ADAPTER__FREQUENCIES: '152.405',
      INGEST_ADAPTER__PROTOCOLS: 'POCSAG1200',
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    config.validate();

    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});
