import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
      INGEST_CORE__API_URL: 'http://api-a:3000',
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
      INGEST_CORE__API_URL: 'http://api-a:3000',
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

  it('validate() exits process when no API target configuration is present', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_ADAPTER__FREQUENCIES: '152.405',
      INGEST_ADAPTER__PROTOCOLS: 'POCSAG1200',
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    config.validate();

    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });

  it('parses target-1 from INGEST_CORE__API_URL and INGEST_CORE__API_KEY', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_URL: 'http://api-a:3000',
      INGEST_CORE__API_NAME: 'pm-prod-a',
      INGEST_CORE__API_KEY: 'key-a',
    });

    expect(config.apiTargets).toEqual([
      { id: 'target-1', name: 'pm-prod-a', url: 'http://api-a:3000', apiKey: 'key-a' },
    ]);
  });

  it('parses enumerated targets from INGEST_CORE__API_<n>_URL and INGEST_CORE__API_<n>_KEY', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_1_URL: 'http://api-a:3000',
      INGEST_CORE__API_1_NAME: 'pm-prod-a',
      INGEST_CORE__API_1_KEY: 'key-a',
      INGEST_CORE__API_2_URL: 'http://api-b:3000',
      INGEST_CORE__API_2_NAME: 'pm-prod-b',
      INGEST_CORE__API_2_KEY: 'key-b',
    });

    expect(config.apiTargets).toHaveLength(2);
    expect(config.apiTargets[0]).toEqual({
      id: 'target-1',
      name: 'pm-prod-a',
      url: 'http://api-a:3000',
      apiKey: 'key-a',
    });
    expect(config.apiTargets[1]).toEqual({
      id: 'target-2',
      name: 'pm-prod-b',
      url: 'http://api-b:3000',
      apiKey: 'key-b',
    });
  });

  it('combines API_URL/API_KEY with enumerated API_<n> variables without mode switching', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_URL: 'http://api-a:3000',
      INGEST_CORE__API_KEY: 'key-a',
      INGEST_CORE__API_2_URL: 'http://api-b:3000',
      INGEST_CORE__API_2_NAME: 'pm-prod-b',
      INGEST_CORE__API_2_KEY: 'key-b',
    });

    expect(config.apiTargets).toEqual([
      { id: 'target-1', name: 'target-1', url: 'http://api-a:3000', apiKey: 'key-a' },
      { id: 'target-2', name: 'pm-prod-b', url: 'http://api-b:3000', apiKey: 'key-b' },
    ]);
  });

  it('supports Docker secrets via INGEST_CORE__API_KEY_FILE for single target', async () => {
    const secretPath = path.join(os.tmpdir(), `ingest-core-key-${Date.now()}-${Math.random()}.txt`);
    fs.writeFileSync(secretPath, 'secret-from-file\n', 'utf8');

    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_URL: 'http://api-a:3000',
      INGEST_CORE__API_KEY_FILE: secretPath,
    });

    expect(config.apiTargets).toEqual([
      { id: 'target-1', name: 'target-1', url: 'http://api-a:3000', apiKey: 'secret-from-file' },
    ]);
    fs.unlinkSync(secretPath);
  });

  it('supports Docker secrets via INGEST_CORE__API_<n>_KEY_FILE for enumerated targets', async () => {
    const secretPath = path.join(os.tmpdir(), `ingest-core-key-n-${Date.now()}-${Math.random()}.txt`);
    fs.writeFileSync(secretPath, 'secret-two\n', 'utf8');

    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_1_URL: 'http://api-a:3000',
      INGEST_CORE__API_1_KEY: 'key-a',
      INGEST_CORE__API_2_URL: 'http://api-b:3000',
      INGEST_CORE__API_2_KEY_FILE: secretPath,
    });

    expect(config.apiTargets).toEqual([
      { id: 'target-1', name: 'target-1', url: 'http://api-a:3000', apiKey: 'key-a' },
      { id: 'target-2', name: 'target-2', url: 'http://api-b:3000', apiKey: 'secret-two' },
    ]);
    fs.unlinkSync(secretPath);
  });

  it('validate() exits when KEY and KEY_FILE are both defined for the same target', async () => {
    const secretPath = path.join(os.tmpdir(), `ingest-core-key-conflict-${Date.now()}-${Math.random()}.txt`);
    fs.writeFileSync(secretPath, 'from-file\n', 'utf8');

    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_URL: 'http://api-a:3000',
      INGEST_CORE__API_KEY: 'from-env',
      INGEST_CORE__API_KEY_FILE: secretPath,
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    config.validate();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    fs.unlinkSync(secretPath);
  });

  it('validate() exits when API_URL and API_1_URL are both defined', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_URL: 'http://api-a:3000',
      INGEST_CORE__API_KEY: 'key-a',
      INGEST_CORE__API_1_URL: 'http://api-b:3000',
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    config.validate();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('validate() exits when API_NAME and API_1_NAME are both defined', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_URL: 'http://api-a:3000',
      INGEST_CORE__API_KEY: 'key-a',
      INGEST_CORE__API_NAME: 'name-a',
      INGEST_CORE__API_1_NAME: 'name-b',
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    config.validate();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('validate() exits when duplicate target names are configured', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_URL: 'http://api-a:3000',
      INGEST_CORE__API_NAME: 'duplicate-name',
      INGEST_CORE__API_KEY: 'key-a',
      INGEST_CORE__API_2_URL: 'http://api-b:3000',
      INGEST_CORE__API_2_NAME: 'duplicate-name',
      INGEST_CORE__API_2_KEY: 'key-b',
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    config.validate();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('validate() exits when KEY_FILE cannot be read', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_URL: 'http://api-a:3000',
      INGEST_CORE__API_KEY_FILE: '/tmp/this-file-does-not-exist-ingest-core-secret',
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
    config.validate();
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
  });

  it('validate() succeeds with single target API_URL/API_KEY', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_URL: 'http://api-a:3000',
      INGEST_CORE__API_KEY: 'key-a',
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined);

    config.validate();

    expect(exitSpy).not.toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('parses metrics configuration from environment', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_URL: 'http://api-a:3000',
      INGEST_CORE__API_KEY: 'abc123',
      INGEST_CORE__METRICS_ENABLED: 'true',
      INGEST_CORE__METRICS_PORT: '9090',
      INGEST_CORE__METRICS_HOST: '127.0.0.1',
      INGEST_CORE__METRICS_PATH: '/custom-metrics',
      INGEST_CORE__METRICS_PREFIX: 'custom_',
      INGEST_CORE__METRICS_COLLECT_DEFAULT: 'false',
    });

    expect(config.metricsEnabled).toBe(true);
    expect(config.metricsPort).toBe(9090);
    expect(config.metricsHost).toBe('127.0.0.1');
    expect(config.metricsPath).toBe('/custom-metrics');
    expect(config.metricsPrefix).toBe('custom_');
    expect(config.metricsCollectDefault).toBe(false);
  });

  it('uses sane defaults for metrics configuration', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_URL: 'http://api-a:3000',
      INGEST_CORE__API_KEY: 'abc123',
    });

    expect(config.metricsEnabled).toBe(false); // disabled by default
    expect(config.metricsPort).toBe(9464);
    expect(config.metricsHost).toBe('0.0.0.0');
    expect(config.metricsPath).toBe('/metrics');
    expect(config.metricsPrefix).toBe('pagermon_ingest_');
    expect(config.metricsCollectDefault).toBe(true);
  });

  it('parses metrics default labels from CSV', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_URL: 'http://api-a:3000',
      INGEST_CORE__API_KEY: 'abc123',
      INGEST_CORE__METRICS_DEFAULT_LABELS: 'env=prod,service=ingest,region=eu',
    });

    const metricsConfig = config.buildMetricsConfig();
    expect(metricsConfig.defaultLabels).toEqual({
      env: 'prod',
      service: 'ingest',
      region: 'eu',
    });
  });

  it('buildMetricsConfig returns correct structure', async () => {
    const { default: config } = await loadConfigWithEnv({
      INGEST_CORE__API_URL: 'http://api-a:3000',
      INGEST_CORE__API_KEY: 'abc123',
      INGEST_CORE__METRICS_ENABLED: 'true',
      INGEST_CORE__METRICS_PREFIX: 'test_',
      INGEST_CORE__METRICS_DEFAULT_LABELS: 'env=test',
      INGEST_CORE__METRICS_COLLECT_DEFAULT: 'false',
    });

    const metricsConfig = config.buildMetricsConfig();
    expect(metricsConfig).toEqual({
      enabled: true,
      prefix: 'test_',
      defaultLabels: { env: 'test' },
      collectDefaults: false,
    });
  });
});
