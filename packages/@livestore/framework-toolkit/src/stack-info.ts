import { extractStackInfoFromStackTrace, type StackInfo } from '@livestore/livestore'

export type { StackInfo } from '@livestore/livestore'

/**
 * The original stack trace limit before any modifications.
 * Used to restore the limit after extracting stack info.
 */
export const originalStackLimit = Error.stackTraceLimit

/**
 * Extracts stack information from a new Error's stack trace.
 * Temporarily increases stack trace limit to capture sufficient context.
 *
 * @returns The extracted stack information
 */
export const captureStackInfo = (): StackInfo => {
  Error.stackTraceLimit = 10
  const stack = new Error().stack!
  Error.stackTraceLimit = originalStackLimit
  return extractStackInfoFromStackTrace(stack)
}
