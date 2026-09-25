import { appendFile } from 'node:fs/promises'

export const FAILURE_PHASES = [
  'schedule',
  'receipt',
  'authorization',
  'calendar-list',
  'calendar-apply',
  'calendar-readback',
  'browser',
  'page',
  'room',
  'feed',
  'receipt-write',
] as const
export type FailurePhase = (typeof FAILURE_PHASES)[number]

export const failureCode = (phase: FailurePhase, error?: unknown): string => {
  // Only fixed categories and bounded HTTP status codes cross the job boundary.
  const message = error instanceof Error ? error.message : ''
  const status = /^(?:Google authorization|Calendar (?:GET|POST|PATCH|DELETE)) failed \(([45]\d{2})\)/.exec(
    message,
  )?.[1]
  const category =
    status === undefined
      ? error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) === true
        ? 'timeout'
        : 'failed'
      : `http-${status}`
  return `${phase}:${category}`
}

export const recordFailure = async (phase: FailurePhase, error?: unknown): Promise<void> => {
  if (process.env.GITHUB_OUTPUT !== undefined)
    await appendFile(process.env.GITHUB_OUTPUT, `failure=${failureCode(phase, error)}\n`)
}

export const clearFailure = async (): Promise<void> => {
  if (process.env.GITHUB_OUTPUT !== undefined) await appendFile(process.env.GITHUB_OUTPUT, 'failure=\n')
}

export const safeFailureCode = (value: string | undefined): string | undefined =>
  value !== undefined &&
  FAILURE_PHASES.some((phase) => new RegExp(`^${phase}:(failed|timeout|http-[45]\\d{2})$`).test(value)) === true
    ? value
    : undefined
