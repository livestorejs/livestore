export { makeInMemoryAdapter } from './in-memory/in-memory-adapter.ts'
/**
 * Single-tab adapter for browsers without SharedWorker support (e.g. Android Chrome).
 *
 * In most cases, you should use `makePersistedAdapter` instead, which automatically
 * falls back to single-tab mode when SharedWorker is unavailable.
 *
 * @see https://github.com/livestorejs/livestore/issues/321
 * @see https://issues.chromium.org/issues/40290702
 */
export { makeSingleTabAdapter, type SingleTabAdapterOptions } from './single-tab/mod.ts'
export {
  canUseSharedWorker,
  makePersistedAdapter,
  type WebAdapterOptions,
} from './web-worker/client-session/persisted-adapter.ts'
export * as WorkerSchema from './web-worker/common/worker-schema.ts'
