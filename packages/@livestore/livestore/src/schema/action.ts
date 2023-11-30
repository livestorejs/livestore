export type SQLWriteStatement = {
  sql: string

  /** Tables written by the statement */
  writeTables: ReadonlyArray<string>
  // TODO refactor this
  argsAlreadyBound?: boolean
}

export type ActionDefinition<TArgs = any> = {
  statement: SQLWriteStatement | ((args: TArgs) => SQLWriteStatement)
  prepareBindValues?: (args: TArgs) => any
}

export type ActionDefinitions<TArgsMap extends Record<string, any>> = {
  [key in keyof TArgsMap]: ActionDefinition<TArgsMap[key]>
}

export const defineActions = <A extends ActionDefinitions<any>>(actions: A) => actions
export const defineAction = <TArgs extends Record<string, any>>(
  action: ActionDefinition<TArgs>,
): ActionDefinition<TArgs> => action

export type GetApplyEventArgs<TActionDefinitionsMap> = RecordValues<{
  [eventType in keyof TActionDefinitionsMap]: {
    eventType: eventType
    args: GetActionArgs<TActionDefinitionsMap[eventType]>
  }
}>

type RecordValues<T> = T extends Record<string, infer V> ? V : never

export type GetActionArgs<A> = A extends ActionDefinition<infer TArgs> ? TArgs : never

// TODO get rid of this
declare global {
  // NOTE Can be extended
  interface LiveStoreActionDefinitionsTypes {
    [key: string]: ActionDefinition
  }
}
