import { Effect, FileSystem } from '@livestore/utils/effect'

/**
 * Marker prefix recognized by the workflow-reporting collector.
 * Keep in sync with the collector's `workflowReportRecordLineMarker`.
 */
export const workflowReportRecordLineMarker = 'WORKFLOW_REPORT_V1: '

/**
 * Schema-compatible shape for a single record. We intentionally keep this as a
 * structural type (not a Schema) so deploy commands can compose records inline
 * without pulling in additional dependencies.
 *
 * Validated downstream by the collector step.
 */
export interface WorkflowReportRecord {
  readonly _tag: 'WorkflowReportRecord'
  readonly schemaVersion: 1
  readonly id: string
  readonly kind: string
  readonly subject: { readonly id: string; readonly label?: string }
  readonly status: 'success' | 'failure' | 'skipped' | 'neutral'
  readonly title: string
  readonly summary?: string
  readonly createdAtUtc: string
  readonly links?: ReadonlyArray<{ readonly label: string; readonly url: string; readonly primary?: boolean }>
  readonly data?: Readonly<Record<string, unknown>>
}

/**
 * Emit a workflow-report record to stdout (as `WORKFLOW_REPORT_V1: <json>`) and
 * — when `WORKFLOW_REPORT_OUTPUT_FILE` is set — append the same marker line to
 * that file so the workflow step can upload it as an artifact.
 *
 * Emit canonical records from the CLI so the collector job can aggregate them
 * without re-parsing CLI-specific log formats.
 */
export const emitWorkflowReportRecord = (record: WorkflowReportRecord) =>
  Effect.gen(function* () {
    const line = `${workflowReportRecordLineMarker}${JSON.stringify(record)}`
    console.log(line)

    const outputPath = process.env.WORKFLOW_REPORT_OUTPUT_FILE
    if (outputPath === undefined || outputPath.trim() === '') return

    const fs = yield* FileSystem.FileSystem
    yield* fs
      .writeFileString(outputPath, `${line}\n`, { flag: 'a' })
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning(`Unable to append workflow-report record to ${outputPath}: ${String(cause)}`),
        ),
      )
  })

/** ISO-8601 UTC timestamp matching the schema's pattern (no fractional seconds). */
export const nowIsoUtc = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
