import { extractStackInfoFromStackTrace, type StackInfo } from '@livestore/livestore'
import React from 'react'

export const originalStackLimit = Error.stackTraceLimit

export const useStackInfo = (): StackInfo =>
  React.useMemo(() => {
    Error.stackTraceLimit = 10
    // eslint-disable-next-line unicorn/error-message
    const stack = new Error().stack!
    Error.stackTraceLimit = originalStackLimit
    return extractStackInfoFromStackTrace(stack)
  }, [])
