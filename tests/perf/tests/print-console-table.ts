export const printConsoleTable = (headers: string[], rows: string[][], firstColumnLeftAligned = true): void => {
  const columnWidths = calculateColumnWidths(headers, rows)
  printTableHeader(headers, columnWidths, firstColumnLeftAligned)
  printTableRows(rows, columnWidths, firstColumnLeftAligned)
  printTableFooter(columnWidths)
}

const calculateColumnWidths = (headers: string[], rows: string[][]): number[] =>
  headers.map((header, columnIndex) => {
    const maxContentWidth = Math.max(
      header.length,
      ...rows.map((row) => (row[columnIndex] ? row[columnIndex]!.toString().length : 0)),
    )
    return maxContentWidth + 2 // Add padding
  })

const printTableHeader = (headers: string[], columnWidths: number[], firstColumnLeftAligned: boolean): void => {
  console.log(`┌${columnWidths.map((width) => '─'.repeat(width)).join('┬')}┐`)

  const headerRow = headers
    .map((header, i) => {
      // First column left-aligned if specified, others right-aligned
      return i === 0 && firstColumnLeftAligned
        ? header.padEnd(columnWidths[i]!)
        : header.padStart(columnWidths[i]! - 1).padEnd(columnWidths[i]!)
    })
    .join('│')

  console.log(`│${headerRow}│`)
  console.log(`├${columnWidths.map((width) => '─'.repeat(width)).join('┼')}┤`)
}

const printTableRows = (rows: string[][], columnWidths: number[], firstColumnLeftAligned: boolean): void => {
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
    console.log(`│${formattedRow}│`)
  }
}

const printTableFooter = (columnWidths: number[]): void => {
  console.log(`└${columnWidths.map((width) => '─'.repeat(width)).join('┴')}┘`)
}
