import { describe, expect, it } from 'vitest'

import { prepareMultiCodeData } from './multi-code.ts'

describe('prepareMultiCodeData', () => {
  it('keeps support files as raw escaped source when they are not pre-rendered', () => {
    const prepared = prepareMultiCodeData({
      code: {
        mainFilename: 'main.ts',
        fileOrder: ['main.ts', 'utils.ts'],
        files: {
          'main.ts': {
            content: `import { value } from './utils.ts'\nexport const message = value\n`,
            isMain: true,
            hash: 'main-hash',
          },
          'utils.ts': {
            content: `export const value = '<support & raw>'\n`,
            isMain: false,
            hash: 'utils-hash',
          },
        },
        rendered: {
          'main.ts': {
            html: '<div class="expressive-code"></div>',
            language: 'ts',
            meta: 'twoslash',
            diagnostics: [],
            styles: [],
          },
        },
      },
    })

    const [mainPanel, supportPanel] = prepared.panels

    expect(mainPanel?.isPreRendered).toBe(true)
    expect(mainPanel?.html).toContain('data-theme="github-dark"')
    expect(supportPanel?.isPreRendered).toBe(false)
    expect(supportPanel?.html).toBeNull()
    expect(supportPanel?.sourceHtml).toBe('export const value = &#39;&lt;support &amp; raw&gt;&#39;\n')
  })
})
