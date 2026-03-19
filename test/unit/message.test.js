import { describe, expect, it } from 'vitest';
import Message from '../../lib/message/Message.js';

describe('Message', () => {
  it('creates a valid alpha message and payload', () => {
    const msg = new Message({
      address: '123456',
      message: 'Hello PagerMon',
      format: 'alpha',
      metadata: { source: 'test-source' },
    });

    expect(msg.validate().valid).toBe(true);

    const payload = msg.toPayload();
    expect(payload.address).toBe('123456');
    expect(payload.message).toBe('Hello PagerMon');
    expect(payload.format).toBe('alpha');
    expect(payload.source).toBe('test-source');
  });

  it('rejects when explicit format is not provided', () => {
    expect(
      () =>
        new Message({
          address: '123456',
          message: 'Hello PagerMon',
        })
    ).toThrow('Message format must be one of: alpha, numeric, tone');
  });

  it('preserves falsy text values like 0 for alpha messages', () => {
    const msg = new Message({
      address: '123456',
      message: 0,
      format: 'alpha',
    });

    expect(msg.message).toBe('0');
    expect(msg.format).toBe('alpha');
    expect(msg.validate().valid).toBe(true);
  });

  it('allows tone message without text', () => {
    const msg = new Message({
      address: '98765',
      format: 'tone',
    });

    expect(msg.message).toBe('');
    expect(msg.validate().valid).toBe(true);
  });

  it('uses metadata.format when explicit format is omitted', () => {
    const msg = new Message({
      address: '98765',
      message: '42',
      metadata: { source: 'test-source', format: 'numeric', protocol: 'FLEX1600' },
    });

    expect(msg.format).toBe('numeric');
    expect(msg.metadata.format).toBe('numeric');

    const payload = msg.toPayload();
    expect(payload.format).toBe('numeric');
    expect(payload.protocol).toBe('FLEX1600');
  });

  it('uses metadata.source when explicit source is omitted', () => {
    const msg = new Message({
      address: '98765',
      message: '42',
      format: 'numeric',
      metadata: { source: 'decoder-a' },
    });

    const payload = msg.toPayload();
    expect(payload.source).toBe('decoder-a');
  });

  it('uses metadata.source as canonical source on payload conversion', () => {
    const msg = new Message({
      address: '98765',
      message: '42',
      format: 'numeric',
      metadata: { source: 'meta-source', protocol: 'FLEX1600' },
    });

    const payload = msg.toPayload();
    expect(payload.source).toBe('meta-source');
    expect(payload.format).toBe('numeric');
    expect(payload.protocol).toBe('FLEX1600');
  });

  it('emits empty source in payload when metadata.source is omitted', () => {
    const msg = new Message({
      address: '98765',
      message: 'test',
      format: 'numeric',
    });

    const payload = msg.toPayload();
    expect(payload.source).toBe('');
    expect(msg.validate().valid).toBe(true);
  });

  it('rejects alpha message without text', () => {
    expect(
      () =>
        new Message({
          address: '11111',
          format: 'alpha',
          metadata: { source: 'test-source' },
        })
    ).toThrow('alpha message requires message content');
  });

  it('rejects numeric message without text', () => {
    expect(
      () =>
        new Message({
          address: '11111',
          format: 'numeric',
          metadata: { source: 'test-source' },
        })
    ).toThrow('numeric message requires message content');
  });

  it('rejects missing required base fields', () => {
    expect(() => new Message({ format: 'numeric', message: 'test', source: 'x' })).toThrow('Message requires address');
  });

  it('reports validation errors for whitespace address and empty text via update', () => {
    const msg = new Message({
      address: '123',
      message: 'foo',
      format: 'alpha',
      metadata: { source: 'test-source' },
    });

    msg.address = '   ';
    msg.message = '';

    const alphaResult = msg.validate();
    expect(alphaResult.valid).toBe(false);
    expect(alphaResult.errors).toContain('address is required');
    expect(alphaResult.errors).toContain('alpha messages require message content');

    msg.address = '123';
    msg.message = 'ok';
    msg.format = '';

    const formatResult = msg.validate();
    expect(formatResult.valid).toBe(false);
    expect(formatResult.errors).toContain('format must be one of: alpha, numeric, tone');
  });

  it('rejects an invalid format like gpn', () => {
    expect(
      () =>
        new Message({
          address: '123456',
          message: 'Hello PagerMon',
          format: 'gpn',
        })
    ).toThrow('Message format must be one of: alpha, numeric, tone');
  });
});
