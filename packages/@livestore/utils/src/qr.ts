import qrcode from 'qrcode-generator'

export { default as QR } from 'qrcode-generator'

export type QRErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H'

export type PrintQrTerminalOptions = {
  errorCorrectionLevel?: QRErrorCorrectionLevel
  /** number of white-cell rows/cols around the QR (default 2) */
  margin?: number
  /** Swap dark/light rendering (default false) */
  invert?: boolean
  /** Use ANSI colors for compact half-block rendering. Default: auto (true on TTY) */
  useAnsi?: boolean
}

/**
 * Print a QR code to the terminal using Unicode block characters.
 *
 * Notes
 * - Uses `qrcode-generator` under the hood. `typeNumber` is set to `0` which means
 *   “auto-select the smallest QR version (1..40) that fits the data”. Larger versions
 *   create larger matrices (each version adds 4 modules per side). See the library:
 *   - Types (TypeNumber, ErrorCorrectionLevel):
 *     https://unpkg.com/qrcode-generator@2.0.4/dist/qrcode.d.ts
 *   - Repository / README:
 *     https://github.com/kazuhikoarase/qrcode-generator
 * - Error correction level (ECL) controls how much damage/occlusion can be
 *   tolerated by adding redundancy. Higher ECL means bigger codes and lower
 *   payload capacity:
 *   - L ≈ 7% recovery (highest capacity, lowest redundancy)
 *   - M ≈ 15% recovery (balanced, common default)
 *   - Q ≈ 25% recovery (more robust in noisy/low-contrast prints)
 *   - H ≈ 30% recovery (most robust; largest symbols)
 *   Reference: https://www.qrcode.com/en/about/error_correction.html
 * - `small` mode compresses two QR rows into one terminal row using the half-block
 *   character `▀` and optional ANSI colors (foreground=top, background=bottom).
 *   This roughly halves the height while keeping readability in modern terminals.
 * - The QR “quiet zone” (margin) is important for scanners. If scanning is unreliable,
 *   consider increasing `margin` to 2–4.
 */
export const printQrTerminal = (text: string, options?: PrintQrTerminalOptions): void => {
  const ec: QRErrorCorrectionLevel = options?.errorCorrectionLevel ?? 'M'
  const margin = options?.margin ?? 2
  const invert = options?.invert ?? false
  // Auto-enable ANSI on TTY; avoid in browsers
  const useAnsi = options?.useAnsi ?? (typeof process !== 'undefined' && !!(process as any)?.stdout?.isTTY)

  // Create the QR code. `0` means: choose the smallest possible version automatically.
  // Error correction level (L/M/Q/H) trades capacity for redundancy.
  const qr = qrcode(0, ec)
  qr.addData(text)
  qr.make()

  const size = qr.getModuleCount()

  // Helper: read a module, applying margin and optional inversion.
  // qrcode-generator’s `isDark` signature is (row, col) i.e. (y, x).
  const isDarkAt = (x: number, y: number): boolean => {
    const row = y - margin
    const col = x - margin
    if (row < 0 || col < 0 || row >= size || col >= size) return false
    const bit = qr.isDark(row, col)
    return invert ? !bit : bit
  }

  const lines: string[] = []

  // Compact rendering: combine two QR rows into one terminal row using half-blocks.
  // With ANSI enabled: use `▀` and paint top as FG, bottom as BG (clear and crisp).
  // Without ANSI: fall back to block chars (`█`, `▀`, `▄`, space). Note that the
  // non-ANSI fallback cannot enforce a white background on dark themes, which may
  // reduce scanner reliability—prefer ANSI when possible.
  const width = size + 2 * margin
  const height = size + 2 * margin

  // ANSI helpers (only used when enabled)
  // Use bright white for a strong “paper-like” background on dark terminals.
  const RESET = '\x1b[0m'
  const FG_BLACK = '\x1b[30m'
  const FG_WHITE = '\x1b[97m'
  const BG_BLACK = '\x1b[40m'
  const BG_WHITE = '\x1b[107m'

  for (let y = 0; y < height; y += 2) {
    let row = ''
    let currentStyle = ''
    const setStyle = (style: string) => {
      if (style !== currentStyle) {
        if (currentStyle) row += RESET
        if (style) row += style
        currentStyle = style
      }
    }

    for (let x = 0; x < width; x++) {
      const top = isDarkAt(x, y)
      const bottom = isDarkAt(x, y + 1)

      if (useAnsi) {
        // Represent two stacked modules with a single `▀` character.
        // Foreground corresponds to the top pixel; background to the bottom pixel.
        // Always paint both halves to enforce a white quiet zone even on dark terminals.
        const fg = top ? FG_BLACK : FG_WHITE
        const bg = bottom ? BG_BLACK : BG_WHITE
        setStyle(fg + bg)
        row += '▀'
      } else {
        // No ANSI: approximate using block characters.
        let ch = ' '
        if (top && bottom) ch = '█'
        else if (top && !bottom) ch = '▀'
        else if (!top && bottom) ch = '▄'
        row += ch
      }
    }

    if (useAnsi) {
      if (currentStyle) row += RESET
    }
    lines.push(row)
  }

  console.log(lines.join('\n'))
}
