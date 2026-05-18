/**
 * Single-tab adapter module for browsers without SharedWorker support.
 *
 * **NOTE**: This module exists as a fallback for Android Chrome and similar browsers
 * that don't support SharedWorker. It is intended to be deprecated and removed once
 * SharedWorker support is available in these browsers.
 *
 * Track progress:
 * - LiveStore issue: https://github.com/livestorejs/livestore/issues/321
 * - Chromium bug: https://issues.chromium.org/issues/40290702
 *
 * @module
 */

export { makeSingleTabAdapter, type SingleTabAdapterOptions } from './single-tab-adapter.ts'
