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
   * @deprecated @param {number} [data.timestamp] - Unix timestamp (seconds since epoch). Use receivedAt instead.
   * @deprecated @param {string} [data.time] - ISO 8601 timestamp (legacy alternative to receivedAt)
   * @param {string} [data.receivedAt] - ISO 8601 timestamp with timezone
   * @param {Object} [data.metadata] - Optional protocol-specific metadata
   */
  constructor(data) {
    if (!data.address) throw new Error('Message requires address');

    const metadata = { ...(data.metadata || {}) };
    const format = String(data.format ?? metadata.format ?? '')
      .trim()
      .toLowerCase();

    if (!['alpha', 'numeric', 'tone'].includes(format)) {
      throw new Error('Message format must be one of: alpha, numeric, tone');
    }

    const rawMessage = data.message ?? '';
    const message = String(rawMessage);

    if ((format === 'alpha' || format === 'numeric') && message.trim().length === 0) {
      throw new Error(`${format} message requires message content`);
    }

    // Check, if receivedAt and timestamp are consistent
    if ((data.receivedAt || data.time) && data.timestamp) {
      const receivedAtMs = new Date(data.receivedAt || data.time).getTime();
      const timestampMs = data.timestamp * 1000;
      if (Math.abs(receivedAtMs - timestampMs) > 1000) {
        throw new Error(
          `Inconsistent timestamps: receivedAt (${data.receivedAt || data.time}) and timestamp (${data.timestamp}) differ by more than 1 second`
        );
      }
    }

    this.address = String(data.address);
    this.message = message;
    this.format = format;
    this.receivedAt = data.receivedAt || data.time || new Date().toISOString();
    this.timestamp = data.timestamp || Math.floor(new Date(this.receivedAt).getTime() / 1000);
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
      receivedAt: this.receivedAt,
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

    if (!['alpha', 'numeric', 'tone'].includes(this.format)) {
      errors.push('format must be one of: alpha, numeric, tone');
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
