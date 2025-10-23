import { extractStackInfoFromStackTrace, type StackInfo } from '@livestore/livestore'

export const originalStackLimit = Error.stackTraceLimit

export const useStackInfo = (): StackInfo => {
  Error.stackTraceLimit = 10

  const stack = new Error().stack!
  Error.stackTraceLimit = originalStackLimit
  return extractStackInfoFromStackTrace(stack)
}
