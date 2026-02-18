import { identity, Predicate, Schema, type Types } from '@livestore/utils/effect'
import { nanoid } from '@livestore/utils/nanoid'

/**
 * Runtime brand for {@link CommandInstance}, following the TypeId String Literal Pattern.
 *
 * Set as a real property on every `CommandInstance` object so that
 * {@link isCommandInstance} can discriminate command instances at runtime.
 * Also serves as a nominal type tag to prevent structural confusion with
 * other objects that happen to share the same shape.
 *
 * Not exported — consumers should use {@link isCommandInstance} for runtime
 * checks and {@link CommandInstance} for type-level operations. Since the
 * TypeId is a string literal (not a symbol), TypeScript resolves the computed
 * property key structurally in the interface, so external code can see the
 * shape without needing access to this constant.
 */
const TypeId = '@livestore/common/CommandInstance'

/**
 * A command instance ready to be executed.
 *
 * Created by calling a CommandDef with arguments.
 * Contains the command name, validated arguments, and a unique ID for tracking.
 *
 * The error type is carried via a branded field so TypeScript can infer `TError`
 * when passing the instance to `store.execute()`.
 */
export interface CommandInstance<TName extends string = string, TArgs = unknown, TError = unknown> {
  /**
   * Branded field that carries the phantom `TError` type through to {@link ExecuteResult}.
   *
   * `TError` doesn't appear in any of the real properties (`name`, `args`, `id`).
   * Without this slot, TypeScript would infer `TError` as `unknown` in
   * `store.execute()`, losing all error type information.
   *
   * `Types.Covariant` marks `TError` as output-only (covariant), which is correct
   * because consumers only *read* the error from the execution result — they never
   * *provide* one. This allows widening (e.g. assigning a `CommandInstance<..., TodoTextEmpty>`
   * to `CommandInstance<..., TodoTextEmpty | OtherError>`).
   *
   * At runtime the value is `{ _TError: identity }` — the `identity` function satisfies
   * all variance shapes.
   */
  readonly [TypeId]: { readonly _TError: Types.Covariant<TError> }

  /** The command type name. */
  readonly name: TName

  /** The validated command arguments. */
  readonly args: TArgs

  /** Unique identifier for this command instance, used for tracking and confirmation. */
  readonly id: string
}

/** Runtime type guard for {@link CommandInstance}. */
export const isCommandInstance = (u: unknown): u is CommandInstance => Predicate.hasProperty(u, TypeId)

/** Restores a {@link CommandInstance} from persisted fields (e.g. journal row). */
export const restoreCommandInstance = (fields: { id: string; name: string; args: unknown }): CommandInstance => ({
  [TypeId]: { _TError: identity },
  ...fields,
})

/** Schema for {@link CommandInstance} (runtime validation disabled — trusts internal callers). */
export const CommandInstanceSchema: Schema.Schema<CommandInstance, CommandInstance> =
  Schema.declare(isCommandInstance)

/** Creates a branded {@link CommandInstance}. */
export const makeCommandInstance = <TName extends string, TArgs, TError>({
  name,
  args,
}: {
  name: TName
  args: TArgs
}): CommandInstance<TName, TArgs, TError> => ({
  [TypeId]: { _TError: identity },
  id: `cmd_${nanoid()}`,
  name,
  args,
})
