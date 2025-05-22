import * as ReactTesting from '@testing-library/react'
import * as React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetUseRcResourceCache, useRcResource } from './useRcResource.js'

describe.each([{ strictMode: true }, { strictMode: false }])('useRcResource (strictMode=%s)', ({ strictMode }) => {
  beforeEach(() => {
    __resetUseRcResourceCache()
  })

  const wrapper = strictMode ? React.StrictMode : React.Fragment

  it('should create a stateful entity using make and call cleanup on unmount', () => {
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const { result, unmount } = ReactTesting.renderHook(() => useRcResource('key-1', makeSpy, cleanupSpy), { wrapper })

    expect(makeSpy).toHaveBeenCalledTimes(1)
    expect(result.current).toBeDefined()

    expect(cleanupSpy).toHaveBeenCalledTimes(0)
    unmount()
    expect(cleanupSpy).toHaveBeenCalledTimes(1)
  })

  it('should reuse the same entity when the key remains unchanged', () => {
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const { result, rerender, unmount } = ReactTesting.renderHook(
      ({ key }) => useRcResource(key, makeSpy, cleanupSpy),
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
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const { result, rerender, unmount } = ReactTesting.renderHook(
      ({ key }) => useRcResource(key, makeSpy, cleanupSpy),
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
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    // Simulate two consumers using the same key independently.
    const { unmount: unmount1 } = ReactTesting.renderHook(() => useRcResource('shared-key', makeSpy, cleanupSpy), {
      wrapper,
    })
    const { unmount: unmount2, result } = ReactTesting.renderHook(
      () => useRcResource('shared-key', makeSpy, cleanupSpy),
      {
        wrapper,
      },
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
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const { rerender, unmount } = ReactTesting.renderHook(({ key }) => useRcResource(key, makeSpy, cleanupSpy), {
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
})

// This code was useful to better understand the hook behaviour with and without strict mode
// describe('debug', () => {
//  const useStrictTest = (key: string) => {
//   const id = React.useId()
//   console.log(key, 'id', id)

//   const x = React.useMemo(() => {
//     console.log('useMemo', key)
//     return 'hi' + key
//   }, [key])

//   React.useEffect(() => {
//     console.log('useEffect', key)
//     return () => {
//       console.log('unmount', key)
//     }
//   }, [])

//   return x
// }

//   it('strict mode component', () => {
//     console.log('strict mode component')
//     const Root = () => {
//       useStrictTest('a')
//       return null
//     }
//     const { unmount } = ReactTesting.render(
//       <React.StrictMode>
//         <Root />
//       </React.StrictMode>,
//     )

//     unmount()
//   })

//   it('strict mode hook', () => {
//     console.log('strict mode hook')
//     const wrapper: React.FC<{ children: React.ReactNode }> = React.StrictMode
//     const { unmount } = ReactTesting.renderHook(() => useStrictTest('b'), { wrapper })

//     unmount()
//   })
// })
