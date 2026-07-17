import { build } from 'esbuild'
import { expect, it } from 'vitest'

it('bundles the Effect facade for browsers without Node builtins', async () => {
  const result = await build({
    bundle: true,
    format: 'esm',
    platform: 'browser',
    stdin: {
      contents: `import { Schema } from './mod.ts'; export const BrowserSchema = Schema.Struct({ value: Schema.String })`,
      loader: 'ts',
      resolveDir: import.meta.dirname,
      sourcefile: 'browser-build-fixture.ts',
    },
    write: false,
  })

  expect(result.outputFiles).toHaveLength(1)
})
