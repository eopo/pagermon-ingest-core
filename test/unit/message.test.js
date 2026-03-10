import { describe, expect, it } from 'vitest';
import Message from '../../lib/message/Message.js';

describe('Message', () => {
  it('creates a valid alpha message and payload', () => {
    const msg = new Message({
      address: '123456',
      message: 'Hello PagerMon',
      format: 'alpha',
      source: 'test-source',
    });

    expect(msg.validate().valid).toBe(true);

    const payload = msg.toPayload();
    expect(payload.address).toBe('123456');
    expect(payload.message).toBe('Hello PagerMon');
    expect(payload.format).toBe('alpha');
    expect(payload.source).toBe('test-source');
  });

  it('allows numeric message without text', () => {
    const msg = new Message({
      address: '98765',
      format: 'numeric',
      source: 'test-source',
    });

    expect(msg.message).toBe('');
    expect(msg.validate().valid).toBe(true);
  });

  it('rejects alpha message without text', () => {
    expect(
      () =>
        new Message({
          address: '11111',
          format: 'alpha',
          source: 'test-source',
        })
    ).toThrow('Alpha message requires message content');
  });

  it('rejects missing required base fields', () => {
    expect(() => new Message({ format: 'numeric', source: 'x' })).toThrow('Message requires address');
    expect(() => new Message({ address: '1', message: 'x', source: 'x' })).toThrow('Message requires format');
    expect(() => new Message({ address: '1', message: 'x', format: 'alpha' })).toThrow('Message requires source');
  });

  it('reports validation errors for whitespace address and invalid format', () => {
    const msg = new Message({
      address: '123',
      message: 'foo',
      format: 'alpha',
      source: 'test-source',
    });

    msg.address = '   ';
    msg.message = '';

    const alphaResult = msg.validate();
    expect(alphaResult.valid).toBe(false);
    expect(alphaResult.errors).toContain('address is required');
    expect(alphaResult.errors).toContain('alpha messages require message content');

    msg.address = '123';
    msg.message = 'ok';
    msg.format = 'binary';

    const formatResult = msg.validate();
    expect(formatResult.valid).toBe(false);
    expect(formatResult.errors).toContain('invalid format: binary');
  });
});
