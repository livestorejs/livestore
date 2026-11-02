import { describe, expect, it } from 'vitest'

import { makeExtensionLaunchOptions } from './launch-options.ts'

describe('makeExtensionLaunchOptions', () => {
  it('preserves caller args alongside extension-required args', () => {
    const options = makeExtensionLaunchOptions({
      extensionPath: '/tmp/livestore-extension',
      headless: true,
      launchOptions: {
        args: ['--auto-open-devtools-for-tabs'],
        chromiumSandbox: true,
      },
    })

    expect(options).toEqual({
      args: [
        '--auto-open-devtools-for-tabs',
        '--headless=new',
        '--disable-extensions-except=/tmp/livestore-extension',
        '--load-extension=/tmp/livestore-extension',
      ],
      chromiumSandbox: true,
      headless: false,
    })
  })
})
