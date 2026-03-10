export default class ValidAdapter {
  constructor(config) {
    this.config = config;
  }

  getName() {
    return 'fixture-valid-adapter';
  }

  async start() {}

  async stop() {}

  isRunning() {
    return true;
  }
}
