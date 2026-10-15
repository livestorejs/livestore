import { INVALID_SPAN_CONTEXT, isSpanContextValid, ROOT_CONTEXT } from '@opentelemetry/api'
import { Effect, FileSystem, type Layer } from 'effect'
import { describe, expect, it } from 'vitest'

import { NodeFileSystemWithWatch, NodeRecursiveWatchLayer } from '@livestore/utils/node'

import { makeNoopSpan, makeNoopTracer } from './NoopTracer.ts'

describe('NoopTracer', () => {
  it('returns the canonical invalid OpenTelemetry span context', () => {
    const spanContext = makeNoopSpan().spanContext()

    expect(spanContext).toBe(INVALID_SPAN_CONTEXT)
    expect(isSpanContextValid(spanContext)).toBe(false)
  })

  it('runs active-span callbacks for every tracer overload', () => {
    const tracer = makeNoopTracer()
    expect(tracer.startActiveSpan('two arguments', () => 'two')).toBe('two')
    expect(tracer.startActiveSpan('three arguments', {}, () => 'three')).toBe('three')
    expect(tracer.startActiveSpan('four arguments', {}, ROOT_CONTEXT, () => 'four')).toBe('four')
  })
})

describe('@livestore/utils/node recursive watch compatibility', () => {
  it('keeps the public layers type-compatible and runnable', async () => {
    const watchLayer: Layer.Layer<FileSystem.WatchBackend> = NodeRecursiveWatchLayer
    const fileSystemLayer: Layer.Layer<FileSystem.FileSystem> = NodeFileSystemWithWatch

    const watchBackend = await Effect.runPromise(FileSystem.WatchBackend.pipe(Effect.provide(watchLayer)))
    const fileSystem = await Effect.runPromise(FileSystem.FileSystem.pipe(Effect.provide(fileSystemLayer)))

    expect(typeof watchBackend.register).toBe('function')
    expect(typeof fileSystem.watch).toBe('function')
  })
})
