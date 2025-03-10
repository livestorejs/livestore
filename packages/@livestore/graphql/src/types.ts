import type { SqliteDbWrapper } from '@livestore/livestore'
import type * as otel from '@opentelemetry/api'
import type { GraphQLSchema } from 'graphql'

export type BaseGraphQLContext = {
  queriedTables: Set<string>
  /** Needed by Pothos Otel plugin for resolver tracing to work */
  otelContext?: otel.Context
}

export type GraphQLOptions<TContext> = {
  schema: GraphQLSchema
  makeContext: (db: SqliteDbWrapper, tracer: otel.Tracer, sessionId: string) => TContext
}
