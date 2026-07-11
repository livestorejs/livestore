import * as ReactTesting from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

import { __resetUseRcResourceCache, useRcResource } from './useRcResource.ts'

describe.each([{ strictMode: true }, { strictMode: false }])('useRcResource (strictMode=%s)', ({ strictMode }) => {
  beforeEach(() => {
    __resetUseRcResourceCache()
  })

  const wrapper = strictMode === true ? React.StrictMode : React.Fragment

  it('should create a stateful entity using make and call cleanup on unmount', () => {
    const scope = {}
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const { result, unmount } = ReactTesting.renderHook(() => useRcResource(scope, 'key-1', makeSpy, cleanupSpy), {
      wrapper,
    })

    expect(makeSpy).toHaveBeenCalledTimes(1)
    expect(result.current).toBeDefined()

    expect(cleanupSpy).toHaveBeenCalledTimes(0)
    unmount()
    expect(cleanupSpy).toHaveBeenCalledTimes(1)
  })

  it('should reuse the same entity when the key remains unchanged', () => {
    const scope = {}
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const { result, rerender, unmount } = ReactTesting.renderHook(
      ({ key }) => useRcResource(scope, key, makeSpy, cleanupSpy),
      { initialProps: { key: 'consistent-key' }, wrapper },
    )

    const instance1 = result.current

    // Re-render with the same key
    rerender({ key: 'consistent-key' })
    const instance2 = result.current

    expect(instance1).toBe(instance2)
    expect(makeSpy).toHaveBeenCalledTimes(1)

    unmount()
    expect(cleanupSpy).toHaveBeenCalledTimes(1)
  })

  it('should dispose the previous instance when the key changes', () => {
    const scope = {}
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const { result, rerender, unmount } = ReactTesting.renderHook(
      ({ key }) => useRcResource(scope, key, makeSpy, cleanupSpy),
      { initialProps: { key: 'a' }, wrapper },
    )

    const instanceA = result.current

    // Change the key; this should trigger the disposal of the 'a' instance
    rerender({ key: 'b' })
    const instanceB = result.current

    expect(instanceA).not.toBe(instanceB)
    expect(makeSpy).toHaveBeenCalledTimes(2)
    expect(cleanupSpy).toHaveBeenCalledTimes(1)

    unmount()
    expect(cleanupSpy).toHaveBeenCalledTimes(2)
  })

  it('should not dispose the entity until all consumers unmount', () => {
    const scope = {}
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    // Simulate two consumers using the same (scope, key) pair independently.
    const { unmount: unmount1 } = ReactTesting.renderHook(
      () => useRcResource(scope, 'shared-key', makeSpy, cleanupSpy),
      { wrapper },
    )
    const { unmount: unmount2, result } = ReactTesting.renderHook(
      () => useRcResource(scope, 'shared-key', makeSpy, cleanupSpy),
      { wrapper },
    )

    expect(result.current).toBeDefined()
    expect(makeSpy).toHaveBeenCalledTimes(1)

    // Unmount first consumer; the entity should remain active.
    unmount1()
    expect(cleanupSpy).not.toHaveBeenCalled()

    // Unmount second consumer; now the entity is disposed.
    unmount2()
    expect(cleanupSpy).toHaveBeenCalledTimes(1)
  })

  it('should handle rapid key changes correctly', () => {
    const scope = {}
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const { rerender, unmount } = ReactTesting.renderHook(({ key }) => useRcResource(scope, key, makeSpy, cleanupSpy), {
      initialProps: { key: '1' },
      wrapper,
    })

    // Rapid sequence of key changes.
    rerender({ key: '2' })
    rerender({ key: '3' })

    // Expect three creations: one each for keys '1', '2', '3'
    expect(makeSpy).toHaveBeenCalledTimes(3)
    // Cleanup should have been triggered for key '1' and key '2'
    expect(cleanupSpy).toHaveBeenCalledTimes(2)

    unmount()
    // Unmounting the final consumer disposes the key '3' instance.
    expect(cleanupSpy).toHaveBeenCalledTimes(3)
  })

  it('should isolate entities created with the same key but different scopes', () => {
    const scopeA = { tag: 'A' }
    const scopeB = { tag: 'B' }
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const { result: resultA } = ReactTesting.renderHook(
      () => useRcResource(scopeA, 'shared-key', makeSpy, cleanupSpy),
      { wrapper },
    )
    const { result: resultB } = ReactTesting.renderHook(
      () => useRcResource(scopeB, 'shared-key', makeSpy, cleanupSpy),
      { wrapper },
    )

    expect(resultA.current).not.toBe(resultB.current)
    expect(makeSpy).toHaveBeenCalledTimes(2)
  })

  it('should dispose the previous entity when the scope changes (key unchanged)', () => {
    const scopeA = { tag: 'A' }
    const scopeB = { tag: 'B' }
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const { result, rerender, unmount } = ReactTesting.renderHook(
      ({ scope }) => useRcResource(scope, 'k', makeSpy, cleanupSpy),
      { initialProps: { scope: scopeA }, wrapper },
    )

    const instanceA = result.current
    expect(makeSpy).toHaveBeenCalledTimes(1)

    rerender({ scope: scopeB })
    const instanceB = result.current

    expect(instanceA).not.toBe(instanceB)
    expect(makeSpy).toHaveBeenCalledTimes(2)
    // The scopeA entry's last consumer left when we switched scopes → cleaned up.
    expect(cleanupSpy).toHaveBeenCalledTimes(1)

    unmount()
    expect(cleanupSpy).toHaveBeenCalledTimes(2)
  })

  it('should not reuse a cached entity after the scope is replaced', () => {
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const scope1 = {}
    const { result: result1, unmount: unmount1 } = ReactTesting.renderHook(
      () => useRcResource(scope1, 'k', makeSpy, cleanupSpy),
      { wrapper },
    )
    const instance1 = result1.current
    unmount1()
    expect(cleanupSpy).toHaveBeenCalledTimes(1)

    // Fresh scope, same string key — must NOT reuse the (already-disposed) entry.
    const scope2 = {}
    const { result: result2, unmount: unmount2 } = ReactTesting.renderHook(
      () => useRcResource(scope2, 'k', makeSpy, cleanupSpy),
      { wrapper },
    )

    expect(result2.current).not.toBe(instance1)
    expect(makeSpy).toHaveBeenCalledTimes(2)

    unmount2()
    expect(cleanupSpy).toHaveBeenCalledTimes(2)
  })

  it('should share the entity across components within the same scope', () => {
    const scope = {}
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const { result: r1, unmount: unmount1 } = ReactTesting.renderHook(
      () => useRcResource(scope, 'k', makeSpy, cleanupSpy),
      { wrapper },
    )
    const { result: r2, unmount: unmount2 } = ReactTesting.renderHook(
      () => useRcResource(scope, 'k', makeSpy, cleanupSpy),
      { wrapper },
    )

    expect(r1.current).toBe(r2.current)
    expect(makeSpy).toHaveBeenCalledTimes(1)

    unmount1()
    expect(cleanupSpy).not.toHaveBeenCalled()
    unmount2()
    expect(cleanupSpy).toHaveBeenCalledTimes(1)
  })
})
