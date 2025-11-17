import { Either, ParseResult, Predicate, Schema } from 'effect'

/**
 * Unique identifier for web errors.
 */
export const TypeId = '@livestore/utils/WebError'

/**
 * Type-level representation of the web error identifier.
 */
export type TypeId = typeof TypeId

/**
 * Type guard to check if a value is a web error.
 *
 * @param u - The value to check
 * @returns `true` if the value is an `WebError`, `false` otherwise
 *
 * @example
 * ```ts
 * import { WebError } from "@livestore/utils/effect"
 *
 * const someError = new Error("generic error")
 * const webError = new WebError.UnknownError({
 *   module: "Test",
 *   method: "example"
 * })
 *
 * console.log(WebError.isWebError(someError)) // false
 * console.log(WebError.isWebError(webError))   // true
 * ```
 */
export const isWebError = (u: unknown): u is WebError => Predicate.hasProperty(u, TypeId)

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
export class EvalError extends Schema.TaggedError<EvalError>()('@livestore/utils/Web/EvalError', {
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
export class RangeError extends Schema.TaggedError<RangeError>()('@livestore/utils/Web/RangeError', {
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
export class ReferenceError extends Schema.TaggedError<ReferenceError>()('@livestore/utils/Web/ReferenceError', {
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
export class TypeError extends Schema.TaggedError<TypeError>()('@livestore/utils/Web/TypeError', {
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
export class URIError extends Schema.TaggedError<URIError>()('@livestore/utils/Web/URIError', {
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
  '@livestore/utils/Web/QuotaExceededError',
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
  '@livestore/utils/Web/NoModificationAllowedError',
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
export class NotFoundError extends Schema.TaggedError<NotFoundError>()('@livestore/utils/Web/NotFoundError', {
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
export class NotAllowedError extends Schema.TaggedError<NotAllowedError>()('@livestore/utils/Web/NotAllowedError', {
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
  '@livestore/utils/Web/TypeMismatchError',
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
  '@livestore/utils/Web/InvalidStateError',
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
export class AbortError extends Schema.TaggedError<AbortError>()('@livestore/utils/Web/AbortError', {
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
  '@livestore/utils/Web/InvalidModificationError',
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
export class SecurityError extends Schema.TaggedError<SecurityError>()('@livestore/utils/Web/SecurityError', {
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
export class DataCloneError extends Schema.TaggedError<DataCloneError>()('@livestore/utils/Web/DataCloneError', {
  cause: domExceptionWithName('DataCloneError'),
}) {
  readonly [TypeId]: TypeId = TypeId
  readonly message = this.cause.message
}

// ============================================================================
// Custom Errors
// ============================================================================

/**
 * Catch-all error for unexpected runtime errors in web environments.
 *
 * This error is used when an unexpected exception occurs that doesn't fit
 * into the other specific error categories. It provides context about where
 * the error occurred and preserves the original cause for debugging.
 *
 * @example
 * ```ts
 * import { WebError } from "@livestore/utils/effect"
 * import { Effect } from "effect"
 *
 * const riskyOperation = () => {
 *   try {
 *     // Some operation that might throw
 *     throw new Error("Unexpected runtime issue")
 *   } catch (cause) {
 *     return Effect.fail(new WebError.UnknownError({
 *       module: "JSON",
 *       method: "parse",
 *       description: "Could not parse string as JSON",
 *       cause
 *     }))
 *   }
 * }
 *
 * const program = riskyOperation().pipe(
 *   Effect.catchTag("@livestore/utils/Web/UnknownError", (error) => {
 *     console.log(error.message)
 *     // "JSON.parse: Could not parse string as JSON"
 *     return Effect.succeed("JSON parsing not possible")
 *   })
 * )
 * ```
 */
export class UnknownError extends Schema.TaggedError<UnknownError>()('@livestore/utils/Web/UnknownError', {
  module: Schema.optional(Schema.String),
  method: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  cause: Schema.optional(Schema.Defect),
}) {
  readonly [TypeId]: TypeId = TypeId
  get message(): string {
    const messageEnd = Predicate.isUndefined(this.description) ? 'A web error occurred' : this.description
    const moduleMethod =
      Predicate.isString(this.module) && Predicate.isString(this.method) ? `${this.module}.${this.method}` : undefined
    return Predicate.isUndefined(moduleMethod) ? messageEnd : `${moduleMethod}: ${messageEnd}`
  }
}

/**
 * Union type representing all possible web errors.
 *
 * @example
 * ```ts
 * import { WebError } from "@livestore/utils/effect"
 * import { Effect, Match } from "effect"
 *
 * const handleAnyWebError = Match.type<WebError.WebError>().pipe(
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
export type WebError =
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
 * Schema for validating and parsing web errors.
 *
 * This schema can be used to decode unknown values into properly typed web
 * errors, ensuring type safety when handling errors from external sources or
 * serialized data.
 */
export const WebError: Schema.Union<
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
 * Constructor type for any `WebError` variant exposed by the schema union.
 *
 * Useful when constraining APIs (e.g. `parseWebError`) to accept only
 * specific web error constructors while preserving their instance types.
 */
type WebErrorConstructor = (typeof WebError.members)[number]

/**
 * Schema transform for converting unknown values to WebError instances.
 *
 * This transform handles various web error types and converts them to
 * properly typed WebError instances while preserving the original cause.
 */
const WebErrorFromUnknown = Schema.transform(Schema.Unknown, WebError, {
  strict: true,
  decode: (value) => {
    // Already a WebError
    if (isWebError(value)) return value

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
  encode: (webError) => webError,
})

/**
 * Parses an unknown value into a typed WebError instance.
 *
 * This function safely attempts to parse the provided value into one of the
 * known WebError types. If the value does not match any known type, it
 * defaults to return an `UnknownError` that encapsulates the value and
 * the original error information.
 *
 * @param value - The unknown value to parse
 * @param expected - The errors we expect to receive. Can be used to narrow the return type.
 * @returns A union of the WebError instance. UnknownError is always included in the union
 *          as a fallback when the specific error type cannot be determined.
 *
 * @example
 * ```ts
 * import { WebError } from "@livestore/utils/effect"
 *
 * //      ┌─── Effect<PermissionStatus, WebError.InvalidStateError | WebError.TypeError | WebError.UnknownError>
 * //      ▼
 * const permissionStatus = Effect.tryPromise({
 *   try: () => navigator.permissions.query({ name: 'geolocation' }),
 *   catch: (u) => WebError.parseWebError(u, [WebError.InvalidStateError, WebError.TypeError]),
 * })
 * ```
 *
 * @example
 * Passing specific expected errors narrows the return type
 * ```ts
 * const specificError = WebError.parseWebError(error, [WebError.InvalidStateError, WebError.TypeError])
 * // specificError is typed as WebError.InvalidStateError | WebError.TypeError | WebError.UnknownError
 * ```
 *
 * @example
 * Without additional arguments the full union type is returned
 * ```ts
 * const anyError = WebError.parseWebError(error)
 * // anyError is typed as WebError (all possible error types)
 * ```
 */
export function parseWebError(value: unknown): WebError
export function parseWebError<BECs extends readonly WebErrorConstructor[]>(
  value: unknown,
  expected: BECs,
): InstanceType<BECs[number]> | UnknownError
export function parseWebError(value: unknown, expected: readonly WebErrorConstructor[] = []): WebError {
  const parsed = Schema.decodeUnknownSync(WebErrorFromUnknown)(value)

  if (expected.length === 0) return parsed

  const expectedTags = new Set(expected.map((ErrorConstructor) => ErrorConstructor._tag))
  if (expectedTags.has(parsed._tag)) return parsed

  return parsed instanceof UnknownError ? parsed : new UnknownError({ cause: parsed })
}
