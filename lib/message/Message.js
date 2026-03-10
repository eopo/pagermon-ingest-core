/**
 * Message Domain - normalized message structure
 *
 * Defines the standardized structure for all messages in the system.
 */

class Message {
  /**
   * @param {Object} data
   * @param {string} data.address - Receiver address/capcode
   * @param {string} data.message - Message text
   * @param {string} data.format - 'alpha' or 'numeric'
   * @param {string} data.source - Source label
   * @param {number} [data.timestamp] - Unix timestamp
   * @param {string} [data.time] - ISO8601 timestamp
   * @param {Object} [data.metadata] - Optional protocol-specific metadata
   */
  constructor(data) {
    if (!data.address) throw new Error('Message requires address');
    if (!data.message && data.format === 'alpha') {
      throw new Error('Alpha message requires message content');
    }
    if (!data.format) throw new Error('Message requires format');
    if (!data.source) throw new Error('Message requires source');

    this.address = String(data.address);
    this.message = String(data.message || '');
    this.format = data.format.toLowerCase();
    this.source = data.source;
    this.timestamp = data.timestamp || Math.floor(Date.now() / 1000);
    this.time = data.time || new Date(this.timestamp * 1000).toISOString();
    this.metadata = data.metadata || {};
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
