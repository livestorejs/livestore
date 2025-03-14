// MeasurementsReporter.ts
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

const measurementUnitToDisplayUnit: Record<MeasurementUnit, DisplayUnit> = {
  ms: 'ms',
  bytes: 'MB',
}

const isMeasurementUnit = (unit: string): unit is MeasurementUnit => unit in measurementUnitToDisplayUnit

const unitFormatters: Record<MeasurementUnit, (value: number) => string> = {
  ms: (value) => value.toFixed(2),
  bytes: (value) => (value / (1024 * 1024)).toFixed(2),
}

class MeasurementsReporter implements Reporter {
  private measurements: Measurement[] = []

  onBegin = () => {
    console.log('Starting performance tests...')
  }

  onTestEnd = (test: TestCase, result: TestResult) => {
    if (result.status !== 'passed') return

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

    this.measurements.push(measurement)
  }

  onEnd = (): void => {
    // Group measurements by test suite title path
    const measurementsByFile: Record<string, Measurement[]> = {}
    for (const measurement of this.measurements) {
      if (!measurementsByFile[measurement.testSuiteTitlePath]) {
        measurementsByFile[measurement.testSuiteTitlePath] = []
      }
      measurementsByFile[measurement.testSuiteTitlePath]?.push(measurement)
    }

    console.log('\n📊 Performance Test Measurements:\n')

    // Print measurements for each file
    for (const [testSuiteTitlePath, measurements] of Object.entries(measurementsByFile)) {
      console.log(`\n🧪 ${testSuiteTitlePath}:\n`)

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

      // Calculate column widths
      const columnWidths = headers.map((header, columnIndex) => {
        const maxContentWidth = Math.max(header.length, ...rows.map((row) => row[columnIndex]!.toString().length))
        return maxContentWidth + 2 // Add padding
      })

      // Print table header
      const headerRow = headers
        .map((header, i) => {
          // First column left-aligned, others right-aligned
          return i === 0
            ? header.padEnd(columnWidths[i]!)
            : header.padStart(columnWidths[i]! - 1).padEnd(columnWidths[i]!) // Right-align with space at end
        })
        .join('│')

      const separator = columnWidths.map((width) => '─'.repeat(width)).join('┼')

      console.log('┌' + columnWidths.map((width) => '─'.repeat(width)).join('┬') + '┐')
      console.log('│' + headerRow + '│')
      console.log('├' + separator + '┤')

      // Print table rows
      for (const row of rows) {
        const formattedRow = row
          .map((cell, i) => {
            // First column left-aligned, others right-aligned
            return i === 0
              ? cell.toString().padEnd(columnWidths[i]!)
              : cell
                  .toString()
                  .padStart(columnWidths[i]! - 1)
                  .padEnd(columnWidths[i]!) // Right-align with space at end
          })
          .join('│')
        console.log('│' + formattedRow + '│')
      }

      console.log('└' + columnWidths.map((width) => '─'.repeat(width)).join('┴') + '┘')
    }

    // Print summary statistics in a table
    console.log('\n📈 Summary Statistics:')

    // Group by test suite title
    const groupedMeasurements: Record<string, Measurement[]> = this.measurements.reduce(
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

    // Create summary table
    const headers = ['Test Suite', 'Total Tests', 'Average', 'Min', 'Max']

    // Create table rows for summary statistics
    const rows = Object.entries(groupedMeasurements).map(([testSuiteTitle, measurements]) => {
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

    // Calculate column widths
    const columnWidths = headers.map((header, columnIndex) => {
      const maxContentWidth = Math.max(header.length, ...rows.map((row) => row[columnIndex]!.toString().length))
      return maxContentWidth + 2 // Add padding
    })

    // Print table header
    const headerRow = headers
      .map((header, i) => {
        // First column left-aligned, others right-aligned
        return i === 0
          ? header.padEnd(columnWidths[i]!)
          : header.padStart(columnWidths[i]! - 1).padEnd(columnWidths[i]!) // Right-align with space at end
      })
      .join('│')

    const separator = columnWidths.map((width) => '─'.repeat(width)).join('┼')

    console.log('\n┌' + columnWidths.map((width) => '─'.repeat(width)).join('┬') + '┐')
    console.log('│' + headerRow + '│')
    console.log('├' + separator + '┤')

    // Print table rows
    for (const row of rows) {
      const formattedRow = row
        .map((cell, i) => {
          // First column left-aligned, others right-aligned
          return i === 0
            ? cell.toString().padEnd(columnWidths[i]!)
            : cell
                .toString()
                .padStart(columnWidths[i]! - 1)
                .padEnd(columnWidths[i]!) // Right-align with space at end
        })
        .join('│')
      console.log('│' + formattedRow + '│')
    }

    console.log('└' + columnWidths.map((width) => '─'.repeat(width)).join('┴') + '┘')
  }

  printsToStdio = (): boolean => true
}

export default MeasurementsReporter
