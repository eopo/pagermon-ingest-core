import { describe, expect, it, vi } from 'vitest';
import { createMockLogger } from '../../lib/runtime/logger.js';

describe('runtime logger helpers', () => {
  it('creates a mock logger with pino-like API', () => {
    const logger = createMockLogger(null, { component: 'adapter' });

    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.fatal).toBe('function');
    expect(typeof logger.child).toBe('function');

    expect(() => logger.info('hello')).not.toThrow();
  });

  it('merges bindings for child loggers', () => {
    const logger = createMockLogger(null, { component: 'adapter' });
    const child = logger.child({ adapter: 'fixture' });

    expect(child.bindings).toEqual({ component: 'adapter', adapter: 'fixture' });
    expect(() => child.debug('message')).not.toThrow();
  });

  it('creates vi spies when vi is provided', () => {
    const logger = createMockLogger(vi, { component: 'adapter' });

    logger.info('hello');
    expect(vi.isMockFunction(logger.info)).toBe(true);
    expect(logger.info).toHaveBeenCalledWith('hello');

    const child = logger.child({ adapter: 'fixture' });
    child.error('boom');
    expect(vi.isMockFunction(child.error)).toBe(true);
    expect(child.error).toHaveBeenCalledWith('boom');
  });
});
