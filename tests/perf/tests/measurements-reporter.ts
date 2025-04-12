/* eslint-disable unicorn/throw-new-error */
import os from 'node:os'

import {
  Effect,
  ManagedRuntime,
  Metric,
  Option,
  ParseResult,
  Pretty,
  ReadonlyArray,
  Schema,
} from '@livestore/utils/effect'
import { OtelLiveHttp } from '@livestore/utils/node'
import type { FullConfig, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter'

const MeasurementUnit = Schema.Literal('ms', 'bytes')
type MeasurementUnit = typeof MeasurementUnit.Type

const DisplayUnit = Schema.Literal('ms', 'MB')
type DisplayUnit = typeof DisplayUnit.Type

const Measurement = Schema.Struct({
  testSuiteTitle: Schema.String,
  testSuiteTitlePath: Schema.String,
  testTitle: Schema.String,
  value: Schema.Number,
  unit: MeasurementUnit,
  cpuThrottlingRate: Schema.optional(Schema.Number),
  warmupCount: Schema.optional(Schema.Number),
})
type Measurement = typeof Measurement.Type

class MissingAnnotationError extends Schema.TaggedError<MissingAnnotationError>()('MissingAnnotationError', {
  annotationType: Schema.String,
  testTitle: Schema.String,
}) {}

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

const AnyAnnotation = Schema.Union(
  MeasurementAnnotation,
  MeasurementUnitAnnotation,
  CpuThrottlingRateAnnotation,
  WarmupRunsAnnotation,
)
type AnyAnnotation = Schema.Schema.Type<typeof AnyAnnotation>

const Annotations = Schema.NonEmptyArray(AnyAnnotation)
type Annotations = Schema.Schema.Type<typeof Annotations>

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

const OtelTestLayer = OtelLiveHttp({serviceName: 'livestore-perf-tests', skipLogUrl: true})

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

export default class MeasurementsReporter implements Reporter {
  private readonly systemInfo: SystemInfo
  private measurements: Measurement[] = []
  private metricsByTestTitle: Record<string, Metric.Metric.Summary<number>>
  private effects: Effect.Effect<number>[] = []
  private runtime = ManagedRuntime.make(OtelTestLayer)

  constructor() {
    this.systemInfo = collectSystemInfo()
    this.metricsByTestTitle = {}
  }

  onBegin = (config: FullConfig, suite: Suite): void => {
    this.metricsByTestTitle = Object.fromEntries(
      suite.allTests().map((test) => {
        const decodedAnnotations = Schema.decodeUnknownSync(Annotations)(test.annotations)
        const measurementUnitAnnotationOption = ReadonlyArray.findFirst(
          decodedAnnotations,
          (a): a is Extract<AnyAnnotation, { type: 'measurement unit' }> => a.type === 'measurement unit',
        )

        if (Option.isNone(measurementUnitAnnotationOption)) {
          throw new MissingAnnotationError({ annotationType: 'measurement unit', testTitle: test.title })
        }
        const unit = measurementUnitAnnotationOption.value.description

        const metric = Metric.summary({
          name: `perf_test_${test.title.replaceAll(/[^a-zA-Z0-9]/g, '_')}`,
          maxAge: '1 hour',
          maxSize: 100_000,
          error: 0.01,
          quantiles: [0.5, 0.9],
          description: `Performance measurement ${test.title}`,
        }).pipe(
          Metric.tagged('unit', unit),
          Metric.tagged('test_suite', test.parent.parent!.title),
          Metric.tagged('os.type', this.systemInfo.os.type),
          Metric.tagged('os.platform', this.systemInfo.os.platform),
          Metric.tagged('os.release', this.systemInfo.os.release),
          Metric.tagged('os.arch', this.systemInfo.os.arch),
          Metric.tagged('cpu.model', this.systemInfo.cpus.model),
          Metric.tagged('cpu.count', this.systemInfo.cpus.count.toString()),
          Metric.tagged('cpu.speed', this.systemInfo.cpus.speed.toString()),
          Metric.tagged('memory.total', this.systemInfo.memory.total.toString()),
          Metric.tagged('memory.free', this.systemInfo.memory.free.toString()),
        )

        return [test.title, metric]
      }),
    )
  }

  onTestEnd = async (test: TestCase, result: TestResult): Promise<void> => {
    if (result.status !== 'passed') return

    const measurement = this.runtime.runSync(this.extractMeasurement(test))
    if (!measurement) return
    this.measurements.push(measurement)

    const metric = this.metricsByTestTitle[measurement.testTitle]
    if (!metric) return

    this.effects.push(metric(Effect.succeed(measurement.value)))
  }

  onEnd = async (): Promise<void> => {
    this.printSystemInfo()
    await this.printMeasurements()
  }

  printsToStdio = (): boolean => true

  // Private methods
  private extractMeasurement = (test: TestCase) =>
    Effect.gen(function* () {
      // Decode all annotations using the schema. This now handles parsing.
      const decodedAnnotations: Annotations = yield* Schema.decodeUnknown(Annotations)(test.annotations)

      // Helper to find a required annotation or fail
      const getRequiredAnnotation = <T extends AnyAnnotation['type']>(type: T) =>
        ReadonlyArray.findFirst(
          decodedAnnotations,
          (a): a is Extract<AnyAnnotation, { type: T }> => a.type === type,
        ).pipe(
          Effect.mapError(
            () => new MissingAnnotationError({ annotationType: type, testTitle: test.title }), // Pass context
          ),
        )

      const measurementUnitAnnotation = yield* getRequiredAnnotation('measurement unit')
      const measurementAnnotation = yield* getRequiredAnnotation('measurement')

      const cpuAnnotationOption = ReadonlyArray.findFirst(decodedAnnotations, (a) => a.type === 'cpu throttling rate')
      const warmupAnnotationOption = ReadonlyArray.findFirst(decodedAnnotations, (a) => a.type === 'warmup runs')

      const parsedCpuThrottlingRate = Option.map(cpuAnnotationOption, (a) => a.description).pipe(Option.getOrUndefined)
      const parsedWarmupCount = Option.map(warmupAnnotationOption, (a) => a.description).pipe(Option.getOrUndefined)

      const measurement: Measurement = {
        testSuiteTitle: test.parent.parent!.title,
        testSuiteTitlePath: test.parent.titlePath().slice(1, -2).join(' > '),
        testTitle: test.title,
        value: measurementAnnotation.description,
        unit: measurementUnitAnnotation.description,
        ...(parsedCpuThrottlingRate !== undefined && { cpuThrottlingRate: parsedCpuThrottlingRate }),
        ...(parsedWarmupCount !== undefined && { warmupCount: parsedWarmupCount }),
      }

      return measurement
    })

  private printSystemInfo = (): void => {
    console.log(PrettySystemInfo(this.systemInfo))
  }

  private printMeasurements = async (): Promise<void> => {
    console.log('\n📊 Performance Test Measurements:\n')

    // Group measurements by test suite title path
    const measurementsByFile = this.groupMeasurementsByTitlePath()

    // Print measurements for each file
    for (const [testSuiteTitlePath, measurements] of Object.entries(measurementsByFile)) {
      console.log(`\n🧪 ${testSuiteTitlePath}:\n`)
      await this.printMeasurementsTable(measurements)
    }
  }

  private groupMeasurementsByTitlePath = (): Record<string, Measurement[]> => {
    const result: Record<string, Measurement[]> = {}

    for (const measurement of this.measurements) {
      if (!result[measurement.testSuiteTitlePath]) {
        result[measurement.testSuiteTitlePath] = []
      }
      result[measurement.testSuiteTitlePath]?.push(measurement)
    }

    return result
  }

  private printMeasurementsTable = async (measurements: Measurement[]): Promise<void> => {
    if (measurements.length === 0) return

    const testSuiteTitle = measurements[0]!.testSuiteTitle
    const unit = measurements[0]!.unit
    const displayUnit = measurementUnitToDisplayUnit[unit]

    const headers = [testSuiteTitle, 'Mean', 'Median', 'P90', 'Min', 'Max']

    // Filter metrics for the current test suite
    const metricEntries = Object.entries(this.metricsByTestTitle).filter(([key]) =>
      measurements.some((m) => m.testTitle === key),
    )

    const measurementRecordings = Effect.all(this.effects)

    const rows = await Effect.gen(function* () {
      yield* measurementRecordings
      const rows = []
      for (const [testTitle, metric] of metricEntries) {
        const metricState = yield* Metric.value(metric)
        const quantiles = Object.fromEntries(metricState.quantiles)

        const getQuantileValue = (q: number): number | undefined => {
          const quantileOption = quantiles[q]
          return quantileOption && Option.isSome(quantileOption) ? Option.getOrUndefined(quantileOption) : undefined
        }

        const median = getQuantileValue(0.5)
        const p90 = getQuantileValue(0.9)
        const mean = metricState.sum / metricState.count

        const formatValue = unitFormatters[unit]
        const row = [
          testTitle,
          `${formatValue(mean)} ${displayUnit}`,
          median ? `${formatValue(median)} ${displayUnit}` : 'n/a',
          p90 ? `${formatValue(p90)} ${displayUnit}` : 'n/a',
          `${formatValue(metricState.min)} ${displayUnit}`,
          `${formatValue(metricState.max)} ${displayUnit}`,
        ]
        rows.push(row)
      }

      return rows
    }).pipe(this.runtime.runPromise)

    TableRenderer.renderTable(headers, rows)
  }
}

class TableRenderer {
  static renderTable = (headers: string[], rows: string[][], firstColumnLeftAligned = true): void => {
    const columnWidths = this.calculateColumnWidths(headers, rows)
    this.printTableHeader(headers, columnWidths, firstColumnLeftAligned)
    this.printTableRows(rows, columnWidths, firstColumnLeftAligned)
    this.printTableFooter(columnWidths)
  }

  private static calculateColumnWidths = (headers: string[], rows: string[][]): number[] =>
    headers.map((header, columnIndex) => {
      const maxContentWidth = Math.max(
        header.length,
        ...rows.map((row) => (row[columnIndex] ? row[columnIndex]!.toString().length : 0)),
      )
      return maxContentWidth + 2 // Add padding
    })

  private static printTableHeader = (
    headers: string[],
    columnWidths: number[],
    firstColumnLeftAligned: boolean,
  ): void => {
    console.log('┌' + columnWidths.map((width) => '─'.repeat(width)).join('┬') + '┐')

    const headerRow = headers
      .map((header, i) => {
        // First column left-aligned if specified, others right-aligned
        return i === 0 && firstColumnLeftAligned
          ? header.padEnd(columnWidths[i]!)
          : header.padStart(columnWidths[i]! - 1).padEnd(columnWidths[i]!)
      })
      .join('│')

    console.log('│' + headerRow + '│')
    console.log('├' + columnWidths.map((width) => '─'.repeat(width)).join('┼') + '┤')
  }

  private static printTableRows = (rows: string[][], columnWidths: number[], firstColumnLeftAligned: boolean): void => {
    for (const row of rows) {
      const formattedRow = row
        .map((cell, i) => {
          // First column left-aligned if specified, others right-aligned
          return i === 0 && firstColumnLeftAligned
            ? cell.toString().padEnd(columnWidths[i]!)
            : cell
                .toString()
                .padStart(columnWidths[i]! - 1)
                .padEnd(columnWidths[i]!)
        })
        .join('│')
      console.log('│' + formattedRow + '│')
    }
  }

  private static printTableFooter = (columnWidths: number[]): void => {
    console.log('└' + columnWidths.map((width) => '─'.repeat(width)).join('┴') + '┘')
  }
}
