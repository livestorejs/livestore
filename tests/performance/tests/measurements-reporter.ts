// MeasurementsReporter.ts
import os from 'node:os'

import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter'

type MeasurementUnit = 'ms' | 'bytes'
type DisplayUnit = 'ms' | 'MB'

type Measurement = {
  testSuiteTitle: string
  testSuiteTitlePath: string
  testTitle: string
  value: number
  unit: MeasurementUnit
  cpuThrottlingRate?: number
  warmupCount?: number
}

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
    speed: string
  }
  memory: {
    total: string
    free: string
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

const isMeasurementUnit = (unit: string): unit is MeasurementUnit => unit in measurementUnitToDisplayUnit

const collectSystemInfo = (): SystemInfo => {
  const cpus = os.cpus()
  return {
    os: {
      type: os.type(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
    },
    cpus: {
      model: cpus.length > 0 ? cpus[0]!.model : 'Unknown',
      count: cpus.length,
      speed: cpus.length > 0 ? `${(cpus[0]!.speed / 1000).toFixed(2)} GHz` : 'Unknown',
    },
    memory: {
      total: `${(os.totalmem() / (1024 * 1024 * 1024)).toFixed(2)} GB`,
      free: `${(os.freemem() / (1024 * 1024 * 1024)).toFixed(2)} GB`,
    },
  }
}

class MeasurementsReporter implements Reporter {
  private measurements: Measurement[] = []
  private systemInfo: SystemInfo

  constructor() {
    this.systemInfo = collectSystemInfo()
  }

  onBegin = (): void => {
    console.log('Starting performance tests...')
  }

  onTestEnd = (test: TestCase, result: TestResult): void => {
    if (result.status !== 'passed') return

    const measurement = this.extractMeasurement(test)
    if (measurement) {
      this.measurements.push(measurement)
    }
  }

  onEnd = (): void => {
    this.printSystemInfo()
    this.printMeasurements()
    this.printSummaryStatistics()
  }

  printsToStdio = (): boolean => true

  // Private methods
  private extractMeasurement = (test: TestCase): Measurement | null => {
    const measurementUnit = test.annotations.find((a) => a.type === 'measurement unit')?.description
    if (measurementUnit === undefined) {
      throw new Error(`"measurement unit" annotation is missing in test "${test.title}"`)
    }
    if (!isMeasurementUnit(measurementUnit)) {
      throw new Error(
        `Invalid "measurement unit" annotation "${measurementUnit}" in test "${test.title}". Must be "${Object.keys(measurementUnitToDisplayUnit).join('", "')}`,
      )
    }

    const measurementValue = test.annotations.find((a) => a.type === 'measurement')?.description
    if (measurementValue === undefined) {
      throw new Error(`"measurement" annotation is missing in test "${test.title}"`)
    }

    const measurement: Measurement = {
      testSuiteTitle: test.parent.title,
      testSuiteTitlePath: test.parent.titlePath().slice(1).join(' > '),
      testTitle: test.title,
      value: Number.parseFloat(measurementValue),
      unit: measurementUnit,
    }

    const cpuThrottlingRate = test.annotations.find((a) => a.type === 'cpu throttling rate')?.description
    if (cpuThrottlingRate) {
      measurement.cpuThrottlingRate = Number.parseFloat(cpuThrottlingRate)
    }

    const warmupCount = test.annotations.find((a) => a.type === 'warmup runs')?.description
    if (warmupCount) {
      measurement.warmupCount = Number.parseFloat(warmupCount)
    }

    return measurement
  }

  private printSystemInfo = (): void => {
    console.log('\n🖥️  System Information:')

    // OS Information
    console.log('\nOperating System:')
    console.log(`  Type: ${this.systemInfo.os.type}`)
    console.log(`  Platform: ${this.systemInfo.os.platform}`)
    console.log(`  Release: ${this.systemInfo.os.release}`)
    console.log(`  Architecture: ${this.systemInfo.os.arch}`)

    // CPU Information
    console.log('\nCPU:')
    console.log(`  Model: ${this.systemInfo.cpus.model}`)
    console.log(`  Count: ${this.systemInfo.cpus.count}`)
    console.log(`  Speed: ${this.systemInfo.cpus.speed}`)

    // Memory Information
    console.log('\nMemory:')
    console.log(`  Total: ${this.systemInfo.memory.total}`)
    console.log(`  Free: ${this.systemInfo.memory.free}`)

    console.log('') // Add an empty line for better readability
  }

  private printMeasurements = (): void => {
    console.log('\n📊 Performance Test Measurements:\n')

    // Group measurements by test suite title path
    const measurementsByFile = this.groupMeasurementsByTitlePath()

    // Print measurements for each file
    for (const [testSuiteTitlePath, measurements] of Object.entries(measurementsByFile)) {
      console.log(`\n🧪 ${testSuiteTitlePath}:\n`)

      this.printMeasurementsTable(measurements)
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

  private printMeasurementsTable = (measurements: Measurement[]): void => {
    if (measurements.length === 0) return

    // Determine columns based on available data
    const hasWarmup = measurements.some((m) => m.warmupCount !== undefined)
    const hasCpuThrottling = measurements.some((m) => m.cpuThrottlingRate !== undefined)

    const testSuiteTitle = measurements[0]!.testSuiteTitle
    const displayUnit = measurementUnitToDisplayUnit[measurements[0]!.unit]

    // Create table headers
    const headers = [testSuiteTitle, `Measurement (${displayUnit})`]
    if (hasWarmup) headers.push('Warmup Runs')
    if (hasCpuThrottling) headers.push('CPU Throttling')

    // Create table rows
    const rows = measurements.map((m) => {
      const formatValue = unitFormatters[m.unit]
      const row = [m.testTitle, formatValue(m.value)]

      if (hasWarmup) row.push(m.warmupCount ? m.warmupCount.toString() : '-')
      if (hasCpuThrottling) row.push(m.cpuThrottlingRate ? m.cpuThrottlingRate.toString() + 'x' : '-')

      return row
    })

    TableRenderer.renderTable(headers, rows)
  }

  private printSummaryStatistics = (): void => {
    console.log('\n📈 Summary Statistics:')

    // Group by test suite title
    const groupedMeasurements = this.groupMeasurementsByTestSuite()

    // Create summary table
    const headers = ['Test Suite', 'Total Tests', 'Average', 'Min', 'Max']

    // Create table rows for summary statistics
    const rows = this.createSummaryRows(groupedMeasurements)

    TableRenderer.renderTable(headers, rows)
  }

  private groupMeasurementsByTestSuite = (): Record<string, Measurement[]> =>
    this.measurements.reduce(
      (acc, measurement) => {
        const key = measurement.testSuiteTitle
        if (!acc[key]) {
          acc[key] = []
        }
        acc[key].push(measurement)
        return acc
      },
      {} as Record<string, Measurement[]>,
    )

  private createSummaryRows = (groupedMeasurements: Record<string, Measurement[]>): string[][] =>
    Object.entries(groupedMeasurements).map(([testSuiteTitle, measurements]) => {
      const avg = measurements.reduce((sum, m) => sum + m.value, 0) / measurements.length
      const min = Math.min(...measurements.map((m) => m.value))
      const max = Math.max(...measurements.map((m) => m.value))
      const unit = measurements[0]!.unit
      const displayUnit = measurementUnitToDisplayUnit[unit]
      const formatValue = unitFormatters[unit]

      return [
        testSuiteTitle,
        measurements.length.toString(),
        `${formatValue(avg)} ${displayUnit}`,
        `${formatValue(min)} ${displayUnit}`,
        `${formatValue(max)} ${displayUnit}`,
      ]
    })
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

export default MeasurementsReporter
