import type { TypedDocumentNode as DocumentNode } from '@graphql-typed-document-node/core'
import type * as otel from '@opentelemetry/api'

import type { ComponentKey } from '../componentKey.js'
import type { Thunk } from '../reactive.js'
import type { BaseGraphQLContext, GetAtomResult, Store } from '../store.js'
import { LiveStoreQueryBase } from './base-class.js'
import type { LiveStoreJSQuery } from './js.js'

export class LiveStoreGraphQLQuery<
  TResult extends Record<string, any>,
  VariableValues extends Record<string, any>,
  TContext extends BaseGraphQLContext,
> extends LiveStoreQueryBase {
  _tag: 'graphql' = 'graphql'

  /** The abstract GraphQL query */
  document: DocumentNode<TResult, VariableValues>

  /** A reactive thunk representing the query results */
  results$: Thunk<TResult>

  constructor({
    document,
    results$,
    ...baseProps
  }: {
    document: DocumentNode<TResult, VariableValues>
    context: TContext
    results$: Thunk<TResult>
    componentKey: ComponentKey
    label: string
    store: Store<TContext>
    otelContext: otel.Context
  }) {
    super(baseProps)

    this.document = document
    this.results$ = results$
  }

  pipe = <U>(f: (x: TResult, get: GetAtomResult) => U): LiveStoreJSQuery<U> =>
    this.store.queryJS(
      (get) => {
        const results = get(this.results$)
        return f(results, get)
      },
      {
        componentKey: this.componentKey,
        label: `${this.label}:js`,
        otelContext: this.otelContext,
      },
    )
}
