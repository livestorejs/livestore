import * as SolidTesting from '@solidjs/testing-library'
import { createSignal } from 'solid-js'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { __resetUseRcResourceCache, useRcResource } from './useRcResource.js'

describe('useRcResource', () => {
  beforeEach(() => {
    __resetUseRcResourceCache()
  })

  it('should create a stateful entity using make and call cleanup on unmount', () => {
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const { result, cleanup } = SolidTesting.renderHook(() => useRcResource(() => 'key-1', makeSpy, cleanupSpy))

    expect(makeSpy).toHaveBeenCalledTimes(1)
    expect(result).toBeDefined()

    expect(cleanupSpy).toHaveBeenCalledTimes(0)
    cleanup()
    expect(cleanupSpy).toHaveBeenCalledTimes(1)
  })

  it('should reuse the same entity when the key remains unchanged', () => {
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    // Test with same key multiple times
    const { result: result1, cleanup: cleanup1 } = SolidTesting.renderHook(() => useRcResource(() => 'consistent-key', makeSpy, cleanupSpy))
    const instance1 = result1()

    const { result: result2, cleanup: cleanup2 } = SolidTesting.renderHook(() => useRcResource(() => 'consistent-key', makeSpy, cleanupSpy))
    const instance2 = result2()

    expect(instance1).toBe(instance2)
    expect(makeSpy).toHaveBeenCalledTimes(1)

    cleanup1()
    expect(cleanupSpy).toHaveBeenCalledTimes(0) // Still has one reference
    
    cleanup2()
    expect(cleanupSpy).toHaveBeenCalledTimes(1) // Now cleaned up
  })

  it('should dispose the previous instance when the key changes', () => {
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const [key, setKey] = createSignal('a')

    const { result, cleanup } = SolidTesting.renderHook(() => useRcResource(key, makeSpy, cleanupSpy))

    const instanceA = result()

    // Change the key; this should trigger the disposal of the 'a' instance
    setKey('b')
    const instanceB = result()

    expect(instanceA).not.toBe(instanceB)
    expect(makeSpy).toHaveBeenCalledTimes(2)
    expect(cleanupSpy).toHaveBeenCalledTimes(1)

    cleanup()
    expect(cleanupSpy).toHaveBeenCalledTimes(2)
  })

  it('should not dispose the entity until all consumers unmount', () => {
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    // Simulate two consumers using the same key independently.
    const { cleanup: cleanup1 } = SolidTesting.renderHook(() => useRcResource(() => 'shared-key', makeSpy, cleanupSpy))
    const { cleanup: cleanup2, result } = SolidTesting.renderHook(() => useRcResource(() => 'shared-key', makeSpy, cleanupSpy))

    expect(result).toBeDefined()
    expect(makeSpy).toHaveBeenCalledTimes(1)

    // Cleanup first consumer; the entity should remain active.
    cleanup1()
    expect(cleanupSpy).not.toHaveBeenCalled()

    // Cleanup second consumer; now the entity is disposed.
    cleanup2()
    expect(cleanupSpy).toHaveBeenCalledTimes(1)
  })

  it('should handle rapid key changes correctly', () => {
    const makeSpy = vi.fn(() => Symbol('statefulResource'))
    const cleanupSpy = vi.fn()

    const [key, setKey] = createSignal('1')

    const { cleanup } = SolidTesting.renderHook(() => useRcResource(key, makeSpy, cleanupSpy))

    // Rapid sequence of key changes.
    setKey('2')
    setKey('3')

    // Expect three creations: one each for keys '1', '2', '3'
    expect(makeSpy).toHaveBeenCalledTimes(3)
    // Cleanup should have been triggered for key '1' and key '2'
    expect(cleanupSpy).toHaveBeenCalledTimes(2)

    cleanup()
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
