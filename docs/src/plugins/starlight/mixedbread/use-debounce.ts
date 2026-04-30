import { useEffect, useState } from 'react'

export function useDebounce<T>(value: T, delay?: number): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay || 300)

    return () => {
      clearTimeout(timer)
    }
  }, [value, delay])

  return [debouncedValue, setDebouncedValue]
}
