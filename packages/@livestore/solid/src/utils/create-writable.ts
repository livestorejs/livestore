import { type Accessor, createMemo, createSignal } from 'solid-js'

/**
 * Creates a signal that can also be updated if the accessor updates.
 * @param accessor - A function that returns the initial value for the signal
 * @returns A tuple of [getter, setter] similar to createSignal, but the signal is recreated when the accessor's value changes
 * @remarks This is useful when you need a signal that can be manually set but also updates when its source value changes
 * @example
 * ```ts
 * const [width, setWidth] = createWritable(() => config().width);
 * // width() will return config().width initially
 * // setWidth(100) will update the signal to 100
 * // If config().width changes, a new signal width() is updated to the new value
 * ```
 */
export function createWritable<T>(accessor: Accessor<T>) {
  // eslint-disable-next-line solid/reactivity
  const signal = createMemo(() => createSignal(accessor()))
  const get = () => signal()[0]()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (v: any) => signal()[1](v)
  return [get, set] as ReturnType<typeof createSignal<T>>
}
