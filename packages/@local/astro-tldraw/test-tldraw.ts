import fs from 'node:fs/promises'
import { tldrawToImage } from '@kitschpatrol/tldraw-cli'

const tldrPath = process.argv[2]
if (!tldrPath) {
  console.error('Usage: bun test-tldraw.ts <path-to-tldr>')
  process.exit(1)
}

const tempDir = '/tmp/tldraw-test'
await fs.mkdir(tempDir, { recursive: true })

console.log('Rendering', tldrPath, '...')
const startTime = Date.now()

try {
  const outputPaths = await tldrawToImage(tldrPath, {
    format: 'svg',
    output: tempDir,
    dark: false,
    transparent: true,
    stripStyle: false,
  })
  const elapsed = (Date.now() - startTime) / 1000
  console.log('Rendered in', elapsed, 's:', outputPaths)
} catch (error) {
  const elapsed = (Date.now() - startTime) / 1000
  console.error('Failed after', elapsed, 's:', error)
}
