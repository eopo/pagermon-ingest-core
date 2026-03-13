/**
 * Message Domain - normalized message structure
 *
 * Defines the standardized structure for all messages in the system.
 */

function normalizeFormat(formatInput, message) {
  const raw = formatInput ?? '';
  const normalized = String(raw).trim().toLowerCase();

  if (['alpha', 'alphanumeric', 'aln', 'text'].includes(normalized)) {
    return 'alpha';
  }

  if (['numeric', 'num', 'gpn'].includes(normalized)) {
    return 'numeric';
  }

  return String(message || '').trim().length > 0 ? 'alpha' : 'numeric';
}

class Message {
  /**
   * @param {Object} data
   * @param {string} data.address - Receiver address/capcode
   * @param {string} [data.message] - Message text
   * @param {string} [data.format] - 'alpha' or 'numeric'
   * @param {string} [data.source] - Source label
   * @param {number} [data.timestamp] - Unix timestamp
   * @param {string} [data.time] - ISO8601 timestamp
   * @param {Object} [data.metadata] - Optional protocol-specific metadata
   */
  constructor(data) {
    if (!data.address) throw new Error('Message requires address');

    const message = String(data.message || '');
    const metadata = { ...(data.metadata || {}) };
    const resolvedFormat = normalizeFormat(data.format ?? metadata.format, message);

    if (!message && resolvedFormat === 'alpha') {
      throw new Error('Alpha message requires message content');
    }

    this.address = String(data.address);
    this.message = message;
    this.format = resolvedFormat;
    this.source = data.source ? String(data.source) : '';
    this.timestamp = data.timestamp || Math.floor(Date.now() / 1000);
    this.time = data.time || new Date(this.timestamp * 1000).toISOString();
    this.metadata = Object.keys(metadata).length > 0 ? { ...metadata, format: resolvedFormat } : {};
  }

  /**
   * Convert to API payload format
   */
  toPayload() {
    return {
      address: this.address,
      message: this.message,
      format: this.format,
      source: this.source,
      timestamp: this.timestamp,
      time: this.time,
      ...this.metadata,
    };
  }

  /**
   * Validate message shape and semantic constraints
   */
  validate() {
    const errors = [];

    if (!this.address || this.address.trim().length === 0) {
      errors.push('address is required');
    }

    if (this.format === 'alpha' && this.message.trim().length === 0) {
      errors.push('alpha messages require message content');
    }

    if (!['alpha', 'numeric'].includes(this.format)) {
      errors.push(`invalid format: ${this.format}`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

export default Message;
