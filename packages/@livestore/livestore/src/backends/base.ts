/* eslint-disable @typescript-eslint/no-unused-vars */
import { errorToString } from '@livestore/utils'
import { identity } from '@livestore/utils/effect'
import * as otel from '@opentelemetry/api'

import type { LiveStoreEvent } from '../events.js'
// import { EVENTS_TABLE_NAME } from '../events.js'
import type { ActionDefinition } from '../schema.js'
import type { ParamsObject } from '../util.js'
import type { Backend, SelectResponse } from './index.js'

export abstract class BaseBackend implements Backend {
  abstract otelTracer: otel.Tracer

  select = async <T = any>(query: string, bindValues?: ParamsObject): Promise<SelectResponse<T>> => {
    throw new Error('Method not implemented.')
  }

  execute = (query: string, bindValues?: ParamsObject, parentSpan?: otel.Span): void => {
    throw new Error('Method not implemented.')
  }

  getPersistedData = async (parentSpan?: otel.Span): Promise<Uint8Array> => {
    throw new Error('Method not implemented.')
  }

  // TODO move `applyEvent` logic to Store and only call `execute` here
  applyEvent = (event: LiveStoreEvent, eventDefinition: ActionDefinition, parentSpan?: otel.Span): void => {
    const ctx = parentSpan ? otel.trace.setSpan(otel.context.active(), parentSpan) : otel.context.active()
    this.otelTracer.startActiveSpan('LiveStore:backend:applyEvent', {}, ctx, (span) => {
      try {
        // Careful: this SQL statement is duplicated in the backend.
        // Remember to update it in src-tauri/src/store.rs:apply_event as well.
        // await this.execute(sql`insert into ${EVENTS_TABLE_NAME} (id, type, args) values ($id, $type, $args)`, {
        //   id: event.id,
        //   type: event.type,
        //   args: JSON.stringify(event.args ?? {}),
        // })

        const statement =
          typeof eventDefinition.statement === 'function'
            ? eventDefinition.statement(event.args)
            : eventDefinition.statement

        const prepareBindValues = eventDefinition.prepareBindValues ?? identity

        const bindValues =
          typeof eventDefinition.statement === 'function' && statement.argsAlreadyBound
            ? {}
            : prepareBindValues(event.args)

        span.setAttributes({
          'livestore.statement.sql': statement.sql,
          'livestore.statement.writeTables': statement.writeTables,
          'livestore.statement.bindVales': JSON.stringify(bindValues),
        })

        this.execute(statement.sql, bindValues, span)
      } catch (e: any) {
        span.setStatus({ code: otel.SpanStatusCode.ERROR, message: errorToString(e) })
        throw e
      } finally {
        span.end()
      }
    })
  }
}
