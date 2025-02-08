import { useEffect, useRef } from 'react'

type Timer = ReturnType<typeof setTimeout>

export const useDebounce = (func: (...args: any[]) => void, delay = 1000) => {
  const timer = useRef<Timer>(undefined)

  useEffect(() => {
    return () => {
      if (!timer.current) return
      clearTimeout(timer.current)
    }
  }, [])

  const debouncedFunction = (...args: any[]) => {
    const newTimer = setTimeout(() => {
      func(...args)
    }, delay)
    clearTimeout(timer.current)
    timer.current = newTimer
  }

  return debouncedFunction
}
