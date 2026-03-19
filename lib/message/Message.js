/**
 * Message Domain - normalized message structure
 *
 * Defines the standardized structure for all messages in the system.
 */

class Message {
  /**
   * @param {Object} data
   * @param {string} data.address - Receiver address/capcode
   * @param {string} [data.message] - Message text
   * @param {string} data.format - 'alpha', 'numeric', or 'tone'
   * @param {number} [data.timestamp] - Unix timestamp
   * @param {string} [data.time] - ISO8601 timestamp
   * @param {Object} [data.metadata] - Optional protocol-specific metadata
   */
  constructor(data) {
    if (!data.address) throw new Error('Message requires address');

    const metadata = { ...(data.metadata || {}) };
    const format = String(data.format ?? metadata.format ?? '')
      .trim()
      .toLowerCase();

    if (!format) {
      throw new Error('Message format must be explicitly defined');
    }

    const rawMessage = data.message ?? '';
    const message = String(rawMessage);

    if ((format === 'alpha' || format === 'numeric') && message.trim().length === 0) {
      throw new Error(`${format} message requires message content`);
    }

    this.address = String(data.address);
    this.message = message;
    this.format = format;
    this.timestamp = data.timestamp || Math.floor(Date.now() / 1000);
    this.time = data.time || new Date(this.timestamp * 1000).toISOString();
    this.metadata = Object.keys(metadata).length > 0 ? { ...metadata, format } : {};
  }

  /**
   * Convert to API payload format
   */
  toPayload() {
    const source = String(this.metadata?.source || '').trim();

    return {
      ...this.metadata,
      address: this.address,
      message: this.message,
      format: this.format,
      source,
      timestamp: this.timestamp,
      time: this.time,
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

    if (!this.format) {
      errors.push('format is required');
    }

    if ((this.format === 'alpha' || this.format === 'numeric') && this.message.trim().length === 0) {
      errors.push(`${this.format} messages require message content`);
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

export default Message;
