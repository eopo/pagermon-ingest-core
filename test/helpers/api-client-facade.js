import InternalApiClient from '../../lib/core/ApiClient.js';

/**
 * Stable test-only facade for ApiClient.
 * Keeps tests decoupled from internal module location/details.
 */
class ApiClientTestFacade {
  constructor(config, options = {}) {
    this.client = new InternalApiClient(config, options);
  }

  async submitMessage(message) {
    return await this.client.submitMessage(message);
  }

  async checkHealth() {
    return await this.client.checkHealth();
  }
}

export default ApiClientTestFacade;
