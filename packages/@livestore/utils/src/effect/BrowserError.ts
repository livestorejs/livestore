import { Either, ParseResult, Predicate, Schema } from './index.ts'

/**
 * Unique identifier for browser errors.
 */
export const TypeId = '@livestore/utils/BrowserError'

/**
 * Type-level representation of the browser error identifier.
 */
export type TypeId = typeof TypeId

/**
 * Type guard to check if a value is a browser error.
 *
 * @param u - The value to check
 * @returns `true` if the value is an `BrowserError`, `false` otherwise
 *
 * @example
 * ```ts
 * import { BrowserError } from "@livestore/utils/effect"
 *
 * const someError = new Error("generic error")
 * const browserError = new BrowserError.UnknownError({
 *   module: "Test",
 *   method: "example"
 * })
 *
 * console.log(BrowserError.isBrowserError(someError)) // false
 * console.log(BrowserError.isBrowserError(browserError))   // true
 * ```
 */
export const isBrowserError = (u: unknown): u is BrowserError => Predicate.hasProperty(u, TypeId)

// ============================================================================
// Simple Exception Errors
// ============================================================================
//
// [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error#standard_error_types)
// [Specification](https://webidl.spec.whatwg.org/#dfn-simple-exception)

/**
 * Error for the web standard "EvalError" simple exception.
 *
 * Thrown when the `eval` function is used in a way that violates its usage restrictions.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Evalerror | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#exceptiondef-evalerror | Specification}
 */
export class EvalError extends Schema.TaggedError<EvalError>()('@livestore/utils/Browser/EvalError', {
  cause: Schema.instanceOf(globalThis.EvalError),
}) {
  readonly [TypeId]: TypeId = TypeId
}

/**
 * Error for the web standard "RangeError" simple exception.
 *
 * Indicates that a numeric value is outside the permitted range.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Rangeerror | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#exceptiondef-rangeerror | Specification}
 */
export class RangeError extends Schema.TaggedError<RangeError>()('@livestore/utils/Browser/RangeError', {
  cause: Schema.instanceOf(globalThis.RangeError),
}) {
  readonly [TypeId]: TypeId = TypeId
}

/**
 * Error for the web standard "ReferenceError" simple exception.
 *
 * Raised when code references an identifier that has not been defined.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Referenceerror | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#exceptiondef-referenceerror | Specification}
 */
export class ReferenceError extends Schema.TaggedError<ReferenceError>()('@livestore/utils/Browser/ReferenceError', {
  cause: Schema.instanceOf(globalThis.ReferenceError),
}) {
  readonly [TypeId]: TypeId = TypeId
}

/**
 * Error for the web standard "TypeError" simple exception.
 *
 * Occurs when an operation is applied to a value of an inappropriate type.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Typeerror | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#exceptiondef-typeerror | Specification}
 */
export class TypeError extends Schema.TaggedError<TypeError>()('@livestore/utils/Browser/TypeError', {
  cause: Schema.instanceOf(globalThis.TypeError),
}) {
  readonly [TypeId]: TypeId = TypeId
}

/**
 * Error for the web standard "URIError" simple exception.
 *
 * Signals incorrect usage of global URI handling functions such as `decodeURI` or `encodeURI`.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/URIerror | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#exceptiondef-urierror | Specification}
 */
export class URIError extends Schema.TaggedError<URIError>()('@livestore/utils/Browser/URIError', {
  cause: Schema.instanceOf(globalThis.URIError),
}) {
  readonly [TypeId]: TypeId = TypeId
}

// ============================================================================
// Predefined DOMException Errors
// ============================================================================
//
// [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/DOMException)
// [Specification](https://webidl.spec.whatwg.org/#idl-DOMException-derived-predefineds)

const domExceptionWithName = (expectedName: string) =>
  Schema.instanceOf(DOMException).pipe(
    Schema.filter((a, options) =>
      ParseResult.validateEither(
        Schema.Struct({
          name: Schema.Literal(expectedName),
        }),
      )(a, options).pipe(Either.flip, Either.getOrUndefined),
    ),
  )

/**
 * Error for the web standard "QuotaExceededError" DOMException-derived error.
 *
 * The quota has been exceeded.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/QuotaExceededError | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#quotaexceedederror | Specification}
 */
export class QuotaExceededError extends Schema.TaggedError<QuotaExceededError>()(
  '@livestore/utils/Browser/QuotaExceededError',
  {
    cause: Schema.Union(
      typeof globalThis.QuotaExceededError === 'function'
        ? Schema.instanceOf(globalThis.QuotaExceededError)
        : Schema.Never,
      // Deprecated but still in use in some browsers
      domExceptionWithName('QuotaExceededError'),
    ),
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly message = this.cause.message
}

// ============================================================================
//  Base DOMException Errors
// ============================================================================
//
// [MDN Reference](https://developer.mozilla.org/en-US/docs/Web/API/DOMException#error_names)
// [Specification](https://webidl.spec.whatwg.org/#idl-DOMException-error-names)

/**
 * Error for the web standard "NoModificationAllowedError" DOMException.
 *
 * The object can not be modified.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/DOMException#nomodificationallowederror | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#nomodificationallowederror | Specification}
 */
export class NoModificationAllowedError extends Schema.TaggedError<NoModificationAllowedError>()(
  '@livestore/utils/Browser/NoModificationAllowedError',
  {
    cause: domExceptionWithName('NoModificationAllowedError'),
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly message = this.cause.message
}

/**
 * Error for the web standard "NotFoundError" DOMException
 *
 * The object can not be found here.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/DOMException#notfounderror | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#notfounderror | Specification}
 */
export class NotFoundError extends Schema.TaggedError<NotFoundError>()('@livestore/utils/Browser/NotFoundError', {
  cause: domExceptionWithName('NotFoundError'),
}) {
  readonly [TypeId]: TypeId = TypeId
  readonly message = this.cause.message
}

/**
 * Error for the web standard "NotAllowedError" DOMException
 *
 * The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/DOMException#notallowederror | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#notallowederror | Specification}
 */
export class NotAllowedError extends Schema.TaggedError<NotAllowedError>()('@livestore/utils/Browser/NotAllowedError', {
  cause: domExceptionWithName('NotAllowedError'),
}) {
  readonly [TypeId]: TypeId = TypeId
  readonly message = this.cause.message
}

/**
 * Error for the web standard "TypeMismatchError" DOMException.
 *
 * The object can not be converted to the expected type.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/DOMException#typemismatcherror | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#typemismatcherror | Specification}
 */
export class TypeMismatchError extends Schema.TaggedError<TypeMismatchError>()(
  '@livestore/utils/Browser/TypeMismatchError',
  {
    cause: domExceptionWithName('TypeMismatchError'),
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly message = this.cause.message
}

/**
 * Error for the web standard "InvalidStateError" DOMException.
 *
 * The object is in an invalid state.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/DOMException#invalidstateerror | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#invalidstateerror | Specification}
 */
export class InvalidStateError extends Schema.TaggedError<InvalidStateError>()(
  '@livestore/utils/Browser/InvalidStateError',
  {
    cause: domExceptionWithName('InvalidStateError'),
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly message = this.cause.message
}

/**
 * Error for the web standard "AbortError" DOMException.
 *
 * The operation was aborted.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/DOMException#aborterror | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#aborterror | Specification}
 */
export class AbortError extends Schema.TaggedError<AbortError>()('@livestore/utils/Browser/AbortError', {
  cause: domExceptionWithName('AbortError'),
}) {
  readonly [TypeId]: TypeId = TypeId
  readonly message = this.cause.message
}

/**
 * Error for the web standard "InvalidModificationError" DOMException.
 *
 * The object can not be modified in this way.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/DOMException#invalidmodificationerror | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#invalidmodificationerror | Specification}
 */
export class InvalidModificationError extends Schema.TaggedError<InvalidModificationError>()(
  '@livestore/utils/Browser/InvalidModificationError',
  {
    cause: domExceptionWithName('InvalidModificationError'),
  },
) {
  readonly [TypeId]: TypeId = TypeId
  readonly message = this.cause.message
}

/**
 * Error for the web standard "SecurityError" DOMException.
 *
 * The operation is insecure.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/DOMException#securityerror | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#securityerror | Specification}
 */
export class SecurityError extends Schema.TaggedError<SecurityError>()('@livestore/utils/Browser/SecurityError', {
  cause: domExceptionWithName('SecurityError'),
}) {
  readonly [TypeId]: TypeId = TypeId
  readonly message = this.cause.message
}

/**
 * Error for the web standard "DataCloneError" DOMException.
 *
 * The object can not be cloned.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/API/DOMException#datacloneerror | MDN Reference}
 * @see {@link https://webidl.spec.whatwg.org/#datacloneerror | Specification}
 */
export class DataCloneError extends Schema.TaggedError<DataCloneError>()('@livestore/utils/Browser/DataCloneError', {
  cause: domExceptionWithName('DataCloneError'),
}) {
  readonly [TypeId]: TypeId = TypeId
  readonly message = this.cause.message
}

// ============================================================================
// Custom Errors
// ============================================================================

/**
 * Catch-all error for unexpected runtime errors in browser environments.
 *
 * This error is used when an unexpected exception occurs that doesn't fit
 * into the other specific error categories. It provides context about where
 * the error occurred and preserves the original cause for debugging.
 *
 * @example
 * ```ts
 * import { BrowserError } from "@livestore/utils/effect"
 * import { Effect } from "effect"
 *
 * const riskyOperation = () => {
 *   try {
 *     // Some operation that might throw
 *     throw new Error("Unexpected runtime issue")
 *   } catch (cause) {
 *     return Effect.fail(new BrowserError.UnknownError({
 *       module: "JSON",
 *       method: "parse",
 *       description: "Could not parse string as JSON",
 *       cause
 *     }))
 *   }
 * }
 *
 * const program = riskyOperation().pipe(
 *   Effect.catchTag("@livestore/utils/Browser/UnknownError", (error) => {
 *     console.log(error.message)
 *     // "JSON.parse: Could not parse string as JSON"
 *     return Effect.succeed("JSON parsing not possible")
 *   })
 * )
 * ```
 */
export class UnknownError extends Schema.TaggedError<UnknownError>()('@livestore/utils/Browser/UnknownError', {
  module: Schema.optional(Schema.String),
  method: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect),
}) {
  readonly [TypeId]: TypeId = TypeId
  get message(): string {
    const messageEnd = Predicate.isUndefined(this.description) ? 'A browser error occurred' : this.description
    const moduleMethod =
      Predicate.isString(this.module) && Predicate.isString(this.method) ? `${this.module}.${this.method}` : undefined
    return Predicate.isUndefined(moduleMethod) ? messageEnd : `${moduleMethod}: ${messageEnd}`
  }
}

/**
 * Union type representing all possible browser errors.
 *
 * @example
 * ```ts
 * import { BrowserError } from "@livestore/utils/effect"
 * import { Effect, Match } from "effect"
 *
 * const handleAnyBrowserError = Match.type<BrowserError.BrowserError>().pipe(
 *   Match.tag("NotFoundError", (err) =>
 *     `Not found error: ${err.cause.message}`
 *   ),
 *   Match.tag("TypeError", (err) =>
 *   `Type error: ${err.cause.message}`
 *   ),
 *   Match.orElse((err) =>
 *     `Unknown error: ${err.message}`
 *   )
 * )
 * ```
 */
export type BrowserError =
  // Simple Exception Errors
  | EvalError
  | RangeError
  | ReferenceError
  | TypeError
  | URIError
  // Base DOMException Errors
  | NoModificationAllowedError
  | NotFoundError
  | NotAllowedError
  | TypeMismatchError
  | InvalidStateError
  | AbortError
  | InvalidModificationError
  | SecurityError
  | DataCloneError
  // Predefined DOMException Errors
  | QuotaExceededError
  // Custom Errors
  | UnknownError

/**
 * Schema for validating and parsing browser errors.
 *
 * This schema can be used to decode unknown values into properly typed browser
 * errors, ensuring type safety when handling errors from external sources or
 * serialized data.
 */
export const BrowserError: Schema.Union<
  [
    // Simple Exception Errors
    typeof EvalError,
    typeof RangeError,
    typeof ReferenceError,
    typeof TypeError,
    typeof URIError,
    // Predefined DOMException Errors
    typeof QuotaExceededError,
    // Base DOMException Errors
    typeof NoModificationAllowedError,
    typeof NotFoundError,
    typeof NotAllowedError,
    typeof TypeMismatchError,
    typeof InvalidStateError,
    typeof AbortError,
    typeof InvalidModificationError,
    typeof SecurityError,
    typeof DataCloneError,
    // Custom Errors
    typeof UnknownError,
  ]
> = Schema.Union(
  // Simple Exception Errors
  EvalError,
  RangeError,
  ReferenceError,
  TypeError,
  URIError,
  // Predefined DOMException Errors
  QuotaExceededError,
  // Base DOMException Errors
  NoModificationAllowedError,
  NotFoundError,
  NotAllowedError,
  TypeMismatchError,
  InvalidStateError,
  AbortError,
  InvalidModificationError,
  SecurityError,
  DataCloneError,
  // Custom Errors
  UnknownError,
)

/**
 * Constructor type for any `BrowserError` variant exposed by the schema union.
 *
 * Useful when constraining APIs (e.g. `parseBrowserError`) to accept only
 * specific browser error constructors while preserving their instance types.
 */
type BrowserErrorConstructor = (typeof BrowserError.members)[number]

/**
 * Schema transform for converting unknown values to BrowserError instances.
 *
 * This transform handles various browser error types and converts them to
 * properly typed BrowserError instances while preserving the original cause.
 */
const BrowserErrorFromUnknown = Schema.transform(Schema.Unknown, BrowserError, {
  strict: true,
  decode: (value) => {
    // Already a BrowserError
    if (isBrowserError(value)) return value

    // Simple Exception Errors
    if (value instanceof globalThis.EvalError) return new EvalError({ cause: value })
    if (value instanceof globalThis.RangeError) return new RangeError({ cause: value })
    if (value instanceof globalThis.ReferenceError) return new ReferenceError({ cause: value })
    if (value instanceof globalThis.TypeError) return new TypeError({ cause: value })
    if (value instanceof globalThis.URIError) return new URIError({ cause: value })

    // Predefined DOMException Errors
    if (typeof globalThis.QuotaExceededError === 'function' && value instanceof globalThis.QuotaExceededError) {
      return new QuotaExceededError({ cause: value })
    }

    // Base DOMException Errors
    if (value instanceof DOMException) {
      switch (value.name) {
        case 'QuotaExceededError':
          return new QuotaExceededError({ cause: value })
        case 'NoModificationAllowedError':
          return new NoModificationAllowedError({ cause: value })
        case 'NotFoundError':
          return new NotFoundError({ cause: value })
        case 'NotAllowedError':
          return new NotAllowedError({ cause: value })
        case 'TypeMismatchError':
          return new TypeMismatchError({ cause: value })
        case 'InvalidStateError':
          return new InvalidStateError({ cause: value })
        case 'AbortError':
          return new AbortError({ cause: value })
        case 'InvalidModificationError':
          return new InvalidModificationError({ cause: value })
        case 'SecurityError':
          return new SecurityError({ cause: value })
        case 'DataCloneError':
          return new DataCloneError({ cause: value })
        default:
          break
      }
    }

    if (value instanceof Error) return new UnknownError({ description: value.message, cause: value })

    return new UnknownError({ cause: value })
  },
  encode: (browserError) => browserError,
})

/**
 * Parses an unknown value into a typed BrowserError instance.
 *
 * This function safely attempts to parse the provided value into one of the
 * known BrowserError types. If the value does not match any known type, it
 * defaults to return an `UnknownError` that encapsulates the value and
 * the original error information.
 *
 * @param value - The unknown value to parse
 * @param expected - The errors we expect to receive. Can be used to narrow the return type.
 * @returns A union of the BrowserError instance. UnknownError is always included in the union
 *          as a fallback when the specific error type cannot be determined.
 *
 * @example
 * ```ts
 * import { BrowserError } from "@livestore/utils/effect"
 *
 * //      ┌─── Effect<PermissionStatus, BrowserError.InvalidStateError | BrowserError.TypeError | BrowserError.UnknownError>
 * //      ▼
 * const permissionStatus = Effect.tryPromise({
 *   try: () => navigator.permissions.query({ name: 'geolocation' }),
 *   catch: (u) => BrowserError.parseBrowserError(u, [BrowserError.InvalidStateError, BrowserError.TypeError]),
 * })
 * ```
 *
 * @example
 * Passing specific expected errors narrows the return type
 * ```ts
 * const specificError = BrowserError.parseBrowserError(error, [BrowserError.InvalidStateError, BrowserError.TypeError])
 * // specificError is typed as BrowserError.InvalidStateError | BrowserError.TypeError | BrowserError.UnknownError
 * ```
 *
 * @example
 * Without additional arguments the full union type is returned
 * ```ts
 * const anyError = BrowserError.parseBrowserError(error)
 * // anyError is typed as BrowserError (all possible error types)
 * ```
 */
export function parseBrowserError(value: unknown): BrowserError
export function parseBrowserError<BECs extends readonly BrowserErrorConstructor[]>(
  value: unknown,
  expected: BECs,
): InstanceType<BECs[number]> | UnknownError
export function parseBrowserError(value: unknown, expected: readonly BrowserErrorConstructor[] = []): BrowserError {
  const parsed = Schema.decodeUnknownSync(BrowserErrorFromUnknown)(value)

  if (expected.length === 0) return parsed

  const expectedTags = new Set(expected.map((ErrorConstructor) => ErrorConstructor._tag))
  if (expectedTags.has(parsed._tag)) return parsed

  return parsed instanceof UnknownError ? parsed : new UnknownError({ cause: parsed })
}
