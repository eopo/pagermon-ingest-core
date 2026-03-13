/**
 * Test helper for logger – returns a mock that satisfies the pino-like logger
 * interface used throughout the codebase.
 *
 * Pass `vi` to get spy-enabled methods so tests can assert call counts/args:
 *   const logger = createMockLogger(vi);
 *   expect(logger.warn).toHaveBeenCalledWith('something went wrong');
 */

export function createMockLogger(viRef, bindings = {}) {
  const makeMethod = viRef && typeof viRef.fn === 'function' ? () => viRef.fn() : () => () => undefined;

  return {
    bindings,
    trace: makeMethod(),
    debug: makeMethod(),
    info: makeMethod(),
    warn: makeMethod(),
    error: makeMethod(),
    fatal: makeMethod(),
    child: (childBindings = {}) => createMockLogger(viRef, { ...bindings, ...childBindings }),
  };
}
