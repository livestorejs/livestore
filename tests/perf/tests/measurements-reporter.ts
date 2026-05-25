import os from 'node:os'
import process from 'node:process'

import type { FullConfig, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter'

import { OtelLiveHttp } from '@livestore/utils-dev/node'
import {
  Data,
  Effect,
  ManagedRuntime,
  Metric,
  Option,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from '@livestore/utils/effect'

import { printConsoleTable } from './print-console-table.ts'

const MeasurementUnit = Schema.Literals(['ms', 'bytes'])
type MeasurementUnit = typeof MeasurementUnit.Type

const DisplayUnit = Schema.Literals(['ms', 'MB'])
type DisplayUnit = typeof DisplayUnit.Type

class MissingAnnotationError extends Data.TaggedError('MissingAnnotationError')<{
  annotationType: string
  testTitle: string
}> {}

const StringDescribedAnnotation = <T extends string>(typeLiteral: T) =>
  Schema.Struct({
    type: Schema.Literal(typeLiteral),
    description: Schema.String,
  })

const NumberFromDescriptionAnnotation = <T extends string>(typeLiteral: T) =>
  StringDescribedAnnotation(typeLiteral).pipe(
    Schema.decodeTo(
      Schema.Struct({
      type: Schema.Literal(typeLiteral),
      description: Schema.Number,
      }),
      {
        decode: SchemaGetter.transformOrFail(({ description, ...rest }) =>
          Effect.sync(() => Number.parseFloat(description)).pipe(
            Effect.filterOrFail(
              (num) => !Number.isNaN(num),
              () =>
                new SchemaIssue.InvalidValue(Option.some(description), {
                  message: `Invalid ${rest.type} description: ${description}`,
                }),
            ),
            Effect.map((parsedDescription) => ({ ...rest, description: parsedDescription })),
          ),
        ),
        encode: SchemaGetter.transform(({ description, ...rest }) => ({ ...rest, description: String(description) })),
      },
    ),
  )

const MeasurementAnnotation = NumberFromDescriptionAnnotation('measurement')
const CpuThrottlingRateAnnotation = NumberFromDescriptionAnnotation('cpu throttling rate')
const WarmupRunsAnnotation = NumberFromDescriptionAnnotation('warmup runs')

const MeasurementUnitAnnotation = Schema.Struct({
  type: Schema.Literal('measurement unit'),
  description: MeasurementUnit,
})

const getRequiredAnnotationSync = <T extends AnyAnnotation['type']>(
  decodedAnnotations: ReadonlyArray<AnyAnnotation>,
  type: T,
  testTitle: string,
): Extract<AnyAnnotation, { type: T }> => {
  const annotation = decodedAnnotations.find((value): value is Extract<AnyAnnotation, { type: T }> => value.type === type)
  if (annotation === undefined) {
    throw new MissingAnnotationError({ annotationType: type, testTitle })
  }
  return annotation
}

const AnyAnnotation = Schema.Union([MeasurementAnnotation, MeasurementUnitAnnotation, CpuThrottlingRateAnnotation, WarmupRunsAnnotation])
type AnyAnnotation = Schema.Schema.Type<typeof AnyAnnotation>

const Annotations = Schema.NonEmptyArray(AnyAnnotation)

type SystemInfo = {
  os: {
    type: string
    platform: string
    release: string
    arch: string
  }
  cpus: {
    model: string
    count: number
    speed: number
  }
  memory: {
    total: number
    free: number
  }
}

const measurementUnitToDisplayUnit: Record<MeasurementUnit, DisplayUnit> = {
  ms: 'ms',
  bytes: 'MB',
}

const unitFormatters: Record<MeasurementUnit, (value: number) => string> = {
  ms: (value) => value.toFixed(2),
  bytes: (value) => (value / (1024 * 1024)).toFixed(2),
}

const OtelLayer = OtelLiveHttp({ serviceName: 'livestore-perf-tests', skipLogUrl: true })

const collectSystemInfo = (): SystemInfo => {
  const cpus = os.cpus()
  const firstCpu = cpus[0]
  return {
    os: {
      type: os.type(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
    },
    cpus: {
      model: firstCpu?.model ?? 'unknown',
      speed: firstCpu?.speed ?? 0,
      count: cpus.length,
    },
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
    },
  }
}

type TrackedMeasurement = {
  measurements: number[]
  meta: {
    unit: MeasurementUnit
    testSuiteTitle: string
    testSuiteTitlePath: string
    testTitle: string
    testName: string
  }
}

export default class MeasurementsReporter implements Reporter {
  private readonly systemInfo = collectSystemInfo()
  private measurementsByTestTitle: Record<string, TrackedMeasurement> = {}
  private runtime = ManagedRuntime.make(OtelLayer)

  onBegin = (_config: FullConfig, suite: Suite): void => {
    for (const test of suite.allTests()) {
      const decodedAnnotations = Schema.decodeUnknownSync(Annotations)(test.annotations)
      const measurementUnitAnnotation = getRequiredAnnotationSync(decodedAnnotations, 'measurement unit', test.title)
      const testSuiteTitle = test.parent?.parent?.title ?? 'n/a'
      const testSuiteTitlePath = test.parent.titlePath().slice(1, -2).join(' > ')

      this.measurementsByTestTitle[test.title] = {
        measurements: [],
        meta: {
          unit: measurementUnitAnnotation.description,
          testSuiteTitle,
          testSuiteTitlePath,
          testTitle: test.title,
          testName: `${testSuiteTitle} ${test.title}`,
        },
      }
    }
  }

  onTestEnd = (test: TestCase, result: TestResult): void => {
    if (result.status !== 'passed') return

    const decodedAnnotations = Schema.decodeUnknownSync(Annotations)(test.annotations)
    const measurementAnnotation = getRequiredAnnotationSync(decodedAnnotations, 'measurement', test.title)
    const trackedMeasurement = this.measurementsByTestTitle[test.title]
    if (trackedMeasurement === undefined) return

    trackedMeasurement.measurements.push(measurementAnnotation.description)
  }

  onEnd = async (): Promise<void> => {
    const metricStatesByTitle = await this.runtime.runPromise(this.computeMetricStates())
    this.printSystemInfo()
    this.printMeasurements(metricStatesByTitle)
    await this.runtime.dispose()
  }

  printsToStdio = (): boolean => true

  // Private methods
  private printSystemInfo = (): void => {
    console.log(formatSystemInfo(this.systemInfo))
  }

  private printMeasurements = (metricStatesByTitle: Record<string, TrackedMeasurementState>): void => {
    const metricsByTitlePath = this.groupMetricsByTitlePath(metricStatesByTitle)

    for (const [testSuiteTitlePath, trackedMetricsInGroup] of Object.entries(metricsByTitlePath)) {
      if (Object.keys(trackedMetricsInGroup).length === 0) continue

      const firstTrackedMetric = Object.values(trackedMetricsInGroup)[0]
      if (firstTrackedMetric == null) continue

      const testSuiteTitle = firstTrackedMetric.meta.testSuiteTitle

      console.log(`\n🧪 ${testSuiteTitlePath}:\n`)
      this.printMeasurementsTable(testSuiteTitle, trackedMetricsInGroup)
    }
  }

  private groupMetricsByTitlePath = (
    metricStatesByTitle: Record<string, TrackedMeasurementState>,
  ): Record<string, Record<string, TrackedMeasurementState>> => {
    const result: Record<string, Record<string, TrackedMeasurementState>> = {}

    for (const [testTitle, trackedMetric] of Object.entries(metricStatesByTitle)) {
      const path = trackedMetric.meta.testSuiteTitlePath

      if (result[path] == null) {
        result[path] = {}
      }
      result[path][testTitle] = trackedMetric
    }

    return result
  }

  private printMeasurementsTable = (
    testSuiteTitle: string,
    trackedMetricsInGroup: Record<string, TrackedMeasurementState>,
  ): void => {
    if (Object.keys(trackedMetricsInGroup).length === 0) return

    const metricStatesResult = Object.fromEntries(
      Object.entries(trackedMetricsInGroup).map(([testTitle, trackedMetric]) => [testTitle, trackedMetric.state]),
    )

    const hasSingleMeasurementPerTestTitle = Object.values(metricStatesResult).every((state) => state.count === 1)

    const firstTrackedMetric = Object.values(trackedMetricsInGroup)[0]!
    const unit = firstTrackedMetric.meta.unit
    const displayUnit = measurementUnitToDisplayUnit[unit]
    const formatValue = unitFormatters[unit]

    if (hasSingleMeasurementPerTestTitle === true) {
      const headers = [testSuiteTitle, `Measurement`]
      const rows = Object.entries(metricStatesResult).map(([testTitle, state]) => {
        return [testTitle, `${formatValue(state.sum)} ${displayUnit}`]
      })
      printConsoleTable(headers, rows)
    } else {
      const headers = [testSuiteTitle, 'Mean', 'Median', 'IQR', 'Min', 'Max']
      const rows: string[][] = []

      for (const [testTitle, metricState] of Object.entries(metricStatesResult)) {
        if (metricState.count === 0) continue

        const quantiles = Object.fromEntries(metricState.quantiles)

        const mean = metricState.sum / metricState.count
        const medianValue = quantiles[0.5]
        const median = medianValue === undefined ? 'n/a' : `${formatValue(medianValue)} ${displayUnit}`
        const lowerQuartile = quantiles[0.25]
        const upperQuartile = quantiles[0.75]
        const iqr =
          lowerQuartile === undefined || upperQuartile === undefined
            ? 'n/a'
            : `${formatValue(upperQuartile - lowerQuartile)} ${displayUnit}`

        rows.push([
          testTitle,
          `${formatValue(mean)} ${displayUnit}`,
          median,
          iqr,
          `${formatValue(metricState.min)} ${displayUnit}`,
          `${formatValue(metricState.max)} ${displayUnit}`,
        ])
      }
      printConsoleTable(headers, rows)
    }
  }

  private computeMetricStates = (): Effect.Effect<
    Record<string, TrackedMeasurementState>,
    SchemaIssue.Issue | MissingAnnotationError
  > =>
    Effect.all(
      Object.entries(this.measurementsByTestTitle).reduce(
        (acc, [testTitle, trackedMeasurement]) => {
          acc[testTitle] = Effect.gen({ self: this }, function* () {
            const metric = this.makeMetric(trackedMeasurement)
            yield* Effect.forEach(trackedMeasurement.measurements, (value) => Metric.update(metric, value), {
              concurrency: 'unbounded',
            })
            const state = yield* Metric.value(metric)
            return {
              meta: trackedMeasurement.meta,
              state,
            }
          })
          return acc
        },
        {} as Record<string, Effect.Effect<TrackedMeasurementState, SchemaIssue.Issue | MissingAnnotationError>>,
      ),
      { concurrency: 'unbounded' },
    )

  private makeMetric = (trackedMeasurement: TrackedMeasurement): Metric.Summary<number> => {
    const snakeCase = (str: string) => str.replaceAll(/[^a-zA-Z0-9]/g, '_').toLowerCase()
    const { meta } = trackedMeasurement

    const attributes: Record<string, string> = {
      unit: meta.unit,
      'test.suite.title': meta.testSuiteTitle,
      'test.title': meta.testTitle,
      'test.name': meta.testName,
      'os.type': this.systemInfo.os.type,
      'os.version': this.systemInfo.os.release,
      'host.arch': this.systemInfo.os.arch,
      'host.cpu.model.name': this.systemInfo.cpus.model,
      'system.memory.limit': this.systemInfo.memory.total.toString(),
      'system.memory.usage': (this.systemInfo.memory.total - this.systemInfo.memory.free).toString(),
    }

    if (process.env.CI !== undefined && process.env.COMMIT_SHA !== undefined && process.env.GITHUB_REF_NAME !== undefined) {
      attributes['github.commit_sha'] = process.env.COMMIT_SHA
      attributes['github.ref_name'] = process.env.GITHUB_REF_NAME
    }

    return Metric.summary(snakeCase(meta.testName), {
      maxAge: '1 hour',
      maxSize: 100,
      quantiles: [0.25, 0.5, 0.75],
      description: meta.testName,
      attributes,
    })
  }
}

type TrackedMeasurementState = {
  meta: TrackedMeasurement['meta']
  state: Metric.SummaryState
}

const formatSystemInfo = (value: SystemInfo): string => `
🖥️  System Information:

Operating System:
  Type: ${value.os.type}
  Platform: ${value.os.platform}
  Release: ${value.os.release}
  Architecture: ${value.os.arch}

CPU:
  Model: ${value.cpus.model}
  Count: ${value.cpus.count}
  Speed: ${(value.cpus.speed / 1000).toFixed(2)} GHz

Memory:
  Total: ${(value.memory.total / (1024 * 1024 * 1024)).toFixed(2)} GB
  Free: ${(value.memory.free / (1024 * 1024 * 1024)).toFixed(2)} GB`
