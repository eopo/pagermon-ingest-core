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

  it('infers alpha format when message text exists and no explicit format is provided', () => {
    const msg = new Message({
      address: '123456',
      message: 'Hello PagerMon',
      source: 'test-source',
    });

    expect(msg.format).toBe('alpha');
    expect(msg.validate().valid).toBe(true);
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

  it('uses metadata.format when explicit format is omitted', () => {
    const msg = new Message({
      address: '98765',
      message: '42',
      source: 'test-source',
      metadata: { format: 'numeric', protocol: 'FLEX1600' },
    });

    expect(msg.format).toBe('numeric');
    expect(msg.metadata.format).toBe('numeric');

    const payload = msg.toPayload();
    expect(payload.format).toBe('numeric');
    expect(payload.protocol).toBe('FLEX1600');
  });

  it('allows source to be omitted so core can default it later', () => {
    const msg = new Message({
      address: '98765',
      format: 'numeric',
    });

    expect(msg.source).toBe('');
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
  });

  it('infers numeric format when neither message nor explicit format is provided', () => {
    const msg = new Message({ address: '1' });

    expect(msg.format).toBe('numeric');
    expect(msg.message).toBe('');
    expect(msg.validate().valid).toBe(true);
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
