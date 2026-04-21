# Changelog

## [1.6.2](https://github.com/eopo/pagermon-ingest-core/compare/v1.6.1...v1.6.2) (2026-04-21)


### Dependencies

* **app:** bump the npm-runtime group with 3 updates ([#60](https://github.com/eopo/pagermon-ingest-core/issues/60)) ([9e6c3c6](https://github.com/eopo/pagermon-ingest-core/commit/9e6c3c629dfa89564b11be96ffbaea931ce434a6))
* **app:** bump the npm-tooling group with 10 updates ([#62](https://github.com/eopo/pagermon-ingest-core/issues/62)) ([bba1e27](https://github.com/eopo/pagermon-ingest-core/commit/bba1e27b1239546103e2227c8131bd602f9849f7))

## [1.6.1](https://github.com/eopo/pagermon-ingest-core/compare/1.6.0...v1.6.1) (2026-04-21)


### Continuous Integration

* add deps as valid commit type ([931a931](https://github.com/eopo/pagermon-ingest-core/commit/931a931a5d923c31ce34b0bb13928885a8bc97c4))

## [1.6.0](https://github.com/eopo/pagermon-ingest-core/compare/1.5.0...1.6.0) (2026-03-19)


### Features

* format changes ([4b83693](https://github.com/eopo/pagermon-ingest-core/commit/4b83693235c900a6a18513973cf57d08b8fa27e9))

## [1.5.0](https://github.com/eopo/pagermon-ingest-core/compare/1.4.0...1.5.0) (2026-03-13)


### Features

* introduce Message class enhancements for format inference ([318cdbc](https://github.com/eopo/pagermon-ingest-core/commit/318cdbca3380480b8de48368cbb9d7940ab34ac9))
* multi-target API delivery with per-target config ([#34](https://github.com/eopo/pagermon-ingest-core/issues/34)) ([d770f9c](https://github.com/eopo/pagermon-ingest-core/commit/d770f9cd9b5b6d636a433e9ddb58205a49a2aa80))


### Bug Fixes

* ensure QueueManager and Worker use updated metrics mocks ([318cdbc](https://github.com/eopo/pagermon-ingest-core/commit/318cdbca3380480b8de48368cbb9d7940ab34ac9))

## [1.4.0](https://github.com/eopo/pagermon-ingest-core/compare/1.3.1...1.4.0) (2026-03-10)


### Features

* implement centralized logging with pino and update adapter logging practices ([2f2d9dc](https://github.com/eopo/pagermon-ingest-core/commit/2f2d9dc1f4eab1172d6aa2310236698c7b9958b1))
* **logging:** implement centralized logging with pino and update logger usage across the codebase ([5f50d22](https://github.com/eopo/pagermon-ingest-core/commit/5f50d22cda49496c3779a9b02056b709937eeb95))
* **metrics:** integrate Prometheus metrics for message processing ([8d46097](https://github.com/eopo/pagermon-ingest-core/commit/8d4609730f6c61fa042ae1e0ee02b690e661538a))
* **metrics:** integrate Prometheus metrics for message processing ([364b052](https://github.com/eopo/pagermon-ingest-core/commit/364b0522c29b59da5b4bb5bcbe0580b910bbeecd))

## [1.3.1](https://github.com/eopo/pagermon-ingest-core/compare/1.3.0...1.3.1) (2026-03-10)


### Bug Fixes

* **worker:** improve error handling for unhealthy API state ([6f3b984](https://github.com/eopo/pagermon-ingest-core/commit/6f3b984f88b991345ae153e6c161b21ceeaa8119))

## [1.3.0](https://github.com/eopo/pagermon-ingest-core/compare/v1.2.0...1.3.0) (2026-03-10)


### Features

* add dependabot configuration for npm, docker, and GitHub Actions ([d45e928](https://github.com/eopo/pagermon-ingest-core/commit/d45e928cd62dd30315fbba636e3f03b6baabca82))
* enhance release-please workflow with optional release version input ([dd998a7](https://github.com/eopo/pagermon-ingest-core/commit/dd998a722fd12b7ccb44d2af6772d7a1126424a7))
* modify CI workflow to target 'dev' branch instead of 'develop' ([dd998a7](https://github.com/eopo/pagermon-ingest-core/commit/dd998a722fd12b7ccb44d2af6772d7a1126424a7))


### Bug Fixes

* **deps:** bump actions/setup-node from 4 to 6 ([0ce56bf](https://github.com/eopo/pagermon-ingest-core/commit/0ce56bff21116c43630d923b9113c224447ca507))
* **deps:** bump actions/setup-node from 4 to 6 ([1b96a87](https://github.com/eopo/pagermon-ingest-core/commit/1b96a87dcf866d3f564c0c231169d6ec719248a7))
* update dependabot prefixes to use "fix" instead of "chore" for better clarity ([dd998a7](https://github.com/eopo/pagermon-ingest-core/commit/dd998a722fd12b7ccb44d2af6772d7a1126424a7))

## [1.2.0](https://github.com/eopo/pagermon-ingest-core/compare/v1.1.0...v1.2.0) (2026-03-10)


### Features

* update ApiClient integration and unit tests to simplify response handling ([bc0d0ed](https://github.com/eopo/pagermon-ingest-core/commit/bc0d0ed22c28419080e9d6cbfdb892dec83c2225))


### Bug Fixes

* skip lefthook install in production builds ([1ace8ac](https://github.com/eopo/pagermon-ingest-core/commit/1ace8ac6883d32bc7a2f067d67eede7c4544a9d2))

## [1.1.0](https://github.com/eopo/pagermon-ingest-core/compare/v1.0.5...v1.1.0) (2026-03-10)


### Features

* add adapter rebuild trigger to release workflow ([b916bfe](https://github.com/eopo/pagermon-ingest-core/commit/b916bfe491208144f07b5b033e2e910b6d61bf67))


### Bug Fixes

* enhance 'no-unused-vars' rule configuration in ESLint ([f6f1a69](https://github.com/eopo/pagermon-ingest-core/commit/f6f1a69feaf785e164d90d61b0171c70e1dd496f))

## [1.0.5](https://github.com/eopo/pagermon-ingest-core/compare/v1.0.4...v1.0.5) (2026-03-10)


### Bug Fixes

* update API key header format in ApiClient ([ee3f32a](https://github.com/eopo/pagermon-ingest-core/commit/ee3f32af019033fb6f425b6df3deb94f23ef8933))

## [1.0.4](https://github.com/eopo/pagermon-ingest-core/compare/v1.0.2...v1.0.4) (2026-03-10)


### Miscellaneous Chores

* prepare release ([53359d1](https://github.com/eopo/pagermon-ingest-core/commit/53359d1ab5356c1c8b1fc322b65e8d993e15c921))

## [1.0.2](https://github.com/eopo/pagermon-ingest-core/compare/v1.0.1...v1.0.2) (2026-03-10)


### Bug Fixes

* Add PAT ([52c5fa7](https://github.com/eopo/pagermon-ingest-core/commit/52c5fa77324d21bef660ccc65f10f0e33c7518b5))

## [1.0.1](https://github.com/eopo/pagermon-ingest-core/compare/v1.0.0...v1.0.1) (2026-03-10)


### Bug Fixes

* Workflow & Release-Please configuration ([68b608a](https://github.com/eopo/pagermon-ingest-core/commit/68b608a645fd5d77431bcadf1cc04b44b4126e64))
