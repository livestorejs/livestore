/* eslint-disable unicorn/throw-new-error */
import os from 'node:os'

import {
  Config,
  Data,
  Effect,
  ManagedRuntime,
  Metric,
  MetricState,
  Option,
  ParseResult,
  Pretty,
  ReadonlyArray,
  Schema,
} from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils-dev/node'
import type { FullConfig, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter'

import { printConsoleTable } from './print-console-table.js'

const MeasurementUnit = Schema.Literal('ms', 'bytes')
type MeasurementUnit = typeof MeasurementUnit.Type

const DisplayUnit = Schema.Literal('ms', 'MB')
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
  Schema.transformOrFail(
    StringDescribedAnnotation(typeLiteral),
    Schema.Struct({
      type: Schema.Literal(typeLiteral),
      description: Schema.Number,
    }),
    {
      decode: ({ description, ...rest }, _, ast) =>
        Effect.sync(() => Number.parseFloat(description)).pipe(
          Effect.filterOrFail(
            (num) => !Number.isNaN(num),
            () => new ParseResult.Type(ast, description, `Invalid ${rest.type} description: ${description}`),
          ),
          Effect.map((parsedDescription) => ({ ...rest, description: parsedDescription })),
        ),
      encode: ({ description, ...rest }) => Effect.succeed({ ...rest, description: String(description) }),
    },
  )

const MeasurementAnnotation = NumberFromDescriptionAnnotation('measurement')
const CpuThrottlingRateAnnotation = NumberFromDescriptionAnnotation('cpu throttling rate')
const WarmupRunsAnnotation = NumberFromDescriptionAnnotation('warmup runs')

const MeasurementUnitAnnotation = Schema.Struct({
  type: Schema.Literal('measurement unit'),
  description: MeasurementUnit,
})

const getRequiredAnnotation = <T extends AnyAnnotation['type']>(
  decodedAnnotations: ReadonlyArray<AnyAnnotation>, // Change this line
  type: T,
  testTitle: string,
): Effect.Effect<Extract<AnyAnnotation, { type: T }>, MissingAnnotationError> =>
  ReadonlyArray.findFirst(decodedAnnotations, (a): a is Extract<AnyAnnotation, { type: T }> => a.type === type).pipe(
    Effect.mapError(() => new MissingAnnotationError({ annotationType: type, testTitle: testTitle })),
  )

const AnyAnnotation = Schema.Union(
  MeasurementAnnotation,
  MeasurementUnitAnnotation,
  CpuThrottlingRateAnnotation,
  WarmupRunsAnnotation,
)
type AnyAnnotation = Schema.Schema.Type<typeof AnyAnnotation>

const Annotations = Schema.NonEmptyArray(AnyAnnotation)

const Cpus = Schema.NonEmptyArray(
  Schema.Struct({
    model: Schema.String,
    speed: Schema.Number,
  }),
).pipe(
  Schema.transform(
    Schema.Struct({
      model: Schema.String,
      count: Schema.Number,
      speed: Schema.Number.annotations({
        pretty: () => (value) => `${(value / 1000).toFixed(2)} GHz`,
      }),
    }),
    {
      encode: ({ count, ...value }) => ReadonlyArray.replicate(value, count),
      decode: (cpus) => ({
        model: cpus[0].model,
        speed: cpus[0].speed,
        count: cpus.length,
      }),
      strict: false,
    },
  ),
)

const SystemInfo = Schema.Struct({
  os: Schema.Struct({
    type: Schema.String,
    platform: Schema.String,
    release: Schema.String,
    arch: Schema.String,
  }),
  cpus: Cpus,
  memory: Schema.Struct({
    total: Schema.Number.annotations({
      pretty: () => (value) => `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`,
    }),
    free: Schema.Number.annotations({
      pretty: () => (value) => `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`,
    }),
  }),
}).annotations({
  pretty: () => (value) => {
    return `
🖥️  System Information:

Operating System:
  Type: ${value.os.type}
  Platform: ${value.os.platform}
  Release: ${value.os.release}
  Architecture: ${value.os.arch}

CPU:
  Model: ${value.cpus.model}
  Count: ${value.cpus.count}
  Speed: ${value.cpus.speed}

Memory:
  Total: ${value.memory.total}
  Free: ${value.memory.free}`
  },
})

type SystemInfo = typeof SystemInfo.Type

const decodeSystemInfo = Schema.decodeUnknownSync(SystemInfo)

const PrettySystemInfo = Pretty.make(SystemInfo)

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
  return decodeSystemInfo({
    os: {
      type: os.type(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
    },
    cpus,
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
    },
  })
}

type TrackedMetric = {
  metric: Metric.Metric.Summary<number>
  meta: {
    unit: MeasurementUnit
    testSuiteTitle: string
    testSuiteTitlePath: string
  }
}

export default class MeasurementsReporter implements Reporter {
  private readonly systemInfo = collectSystemInfo()
  private metricsByTestTitle: Record<string, TrackedMetric> = {}
  private measurementEffects: Effect.Effect<unknown, ParseResult.ParseError | MissingAnnotationError>[] = []
  private runtime = ManagedRuntime.make(OtelLayer)

  onBegin = (config: FullConfig, suite: Suite): void => {
    this.runtime.runSync(
      Effect.forEach(
        suite.allTests(),
        (test) =>
          Effect.gen(this, function* () {
            const decodedAnnotations = yield* Schema.decodeUnknown(Annotations)(test.annotations)

            const measurementUnitAnnotation = yield* getRequiredAnnotation(
              decodedAnnotations,
              'measurement unit',
              test.title,
            )
            const unit = measurementUnitAnnotation.description

            const testSuiteTitle = test.parent?.parent?.title ?? 'n/a'
            const testSuiteTitlePath = test.parent.titlePath().slice(1, -2).join(' > ')

            const snakeCase = (str: string) => str.replaceAll(/[^a-zA-Z0-9]/g, '_').toLowerCase()

            const testName = `${testSuiteTitle} ${test.title}`

            let metric = Metric.summary({
              name: snakeCase(testName),
              maxAge: '1 hour',
              maxSize: 100,
              error: 0,
              quantiles: [0.25, 0.5, 0.75],
              description: testName,
            }).pipe(
              Metric.tagged('unit', unit),
              Metric.tagged('test.suite.title', testSuiteTitle),
              Metric.tagged('test.title', test.title),
              Metric.tagged('test.name', testName),
              Metric.tagged('os.type', this.systemInfo.os.type),
              Metric.tagged('os.version', this.systemInfo.os.release),
              Metric.tagged('host.arch', this.systemInfo.os.arch),
              Metric.tagged('host.cpu.model.name', this.systemInfo.cpus.model),
              Metric.tagged('system.memory.limit', this.systemInfo.memory.total.toString()),
              Metric.tagged(
                'system.memory.usage',
                (this.systemInfo.memory.total - this.systemInfo.memory.free).toString(),
              ),
            )

            const isCi = yield* Config.boolean('CI').pipe(Config.withDefault(false))
            if (isCi) {
              const commitSha = yield* Config.string('GITHUB_SHA')
              const refName = yield* Config.string('GITHUB_REF_NAME')
              metric = metric.pipe(
                Metric.tagged('github.commit_sha', commitSha),
                Metric.tagged('github.ref_name', refName),
              )
            }

            this.metricsByTestTitle[test.title] = {
              metric: metric,
              meta: {
                unit: unit,
                testSuiteTitle: testSuiteTitle,
                testSuiteTitlePath: testSuiteTitlePath,
              },
            }
          }),
        { concurrency: 'unbounded' },
      ),
    )
  }

  onTestEnd = (test: TestCase, result: TestResult): void => {
    if (result.status !== 'passed') return

    const processMeasurementEffect = Effect.gen(this, function* () {
      const decodedAnnotations = yield* Schema.decodeUnknown(Annotations)(test.annotations)
      const measurementAnnotation = yield* getRequiredAnnotation(decodedAnnotations, 'measurement', test.title)
      const value = measurementAnnotation.description

      const trackedMetric = this.metricsByTestTitle[test.title]
      if (trackedMetric === undefined) {
        return Effect.void
      }
      return trackedMetric.metric(Effect.succeed(value))
    }).pipe(Effect.flatten)

    this.measurementEffects.push(processMeasurementEffect)
  }

  onEnd = async (): Promise<void> => {
    this.runtime.runSync(Effect.all(this.measurementEffects, { concurrency: 'unbounded' }))
    this.printSystemInfo()
    this.printMeasurements()
    await this.runtime.dispose()
  }

  printsToStdio = (): boolean => true

  // Private methods
  private printSystemInfo = (): void => {
    console.log(PrettySystemInfo(this.systemInfo))
  }

  private printMeasurements = (): void => {
    const metricsByTitlePath = this.groupMetricsByTitlePath()

    for (const [testSuiteTitlePath, trackedMetricsInGroup] of Object.entries(metricsByTitlePath)) {
      if (Object.keys(trackedMetricsInGroup).length === 0) continue

      const firstTrackedMetric = Object.values(trackedMetricsInGroup)[0]
      if (!firstTrackedMetric) continue

      const testSuiteTitle = firstTrackedMetric.meta.testSuiteTitle

      console.log(`\n🧪 ${testSuiteTitlePath}:\n`)
      this.printMeasurementsTable(testSuiteTitle, trackedMetricsInGroup)
    }
  }

  private groupMetricsByTitlePath = (): Record<string, Record<string, TrackedMetric>> => {
    const result: Record<string, Record<string, TrackedMetric>> = {}

    for (const [testTitle, trackedMetric] of Object.entries(this.metricsByTestTitle)) {
      const path = trackedMetric.meta.testSuiteTitlePath

      if (!result[path]) {
        result[path] = {}
      }
      result[path]![testTitle] = trackedMetric
    }

    return result
  }

  private printMeasurementsTable = (
    testSuiteTitle: string,
    trackedMetricsInGroup: Record<string, TrackedMetric>,
  ): void => {
    if (Object.keys(trackedMetricsInGroup).length === 0) return

    const metricStatesResult = this.runtime.runSync(
      Effect.all(
        Object.entries(trackedMetricsInGroup).reduce(
          (acc, [testTitle, trackedMetric]) => {
            acc[testTitle] = Metric.value(trackedMetric.metric)
            return acc
          },
          {} as Record<string, Effect.Effect<MetricState.MetricState.Summary>>,
        ),
        { concurrency: 'unbounded' },
      ),
    )

    const hasSingleMeasurementPerTestTitle = Object.values(metricStatesResult).every((state) => state.count === 1)

    const firstTrackedMetric = Object.values(trackedMetricsInGroup)[0]!
    const unit = firstTrackedMetric.meta.unit
    const displayUnit = measurementUnitToDisplayUnit[unit]
    const formatValue = unitFormatters[unit]

    if (hasSingleMeasurementPerTestTitle) {
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
        const median = Option.map(quantiles[0.5] ?? Option.none(), (q) => `${formatValue(q)} ${displayUnit}`).pipe(
          Option.getOrElse(() => 'n/a'),
        )
        const lowerQuartile = quantiles[0.25] ?? Option.none()
        const upperQuartile = quantiles[0.75] ?? Option.none()
        const iqr = Option.zipWith(
          lowerQuartile,
          upperQuartile,
          (lower, upper) => `${formatValue(upper - lower)} ${displayUnit}`,
        ).pipe(Option.getOrElse(() => 'n/a'))

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
}
