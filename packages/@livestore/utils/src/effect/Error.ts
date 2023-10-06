import { Data } from 'effect'

import { errorToString, objectToString } from '../index.js'

export class UnknownError extends Data.TaggedError('UnknownError')<{
  readonly error: any
  readonly payload?: any
}> {
  toString = () => {
    const payloadStr = this.payload ? ` with payload ${objectToString(this.payload)}` : ''
    return `UnknownError: ${errorToString(this.error)}${payloadStr}`
  }

  static from = (error: any, payload?: any) => new UnknownError({ error, payload })
}
