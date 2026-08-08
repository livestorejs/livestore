import type * as PW from '@playwright/test'

export const makeExtensionLaunchOptions = ({
  extensionPath,
  headless,
  launchOptions,
}: {
  extensionPath: string
  headless: boolean
  launchOptions: Omit<PW.LaunchOptions, 'headless'> | undefined
}): PW.LaunchOptions => ({
  ...launchOptions,
  headless: false, // Use Chromium's new headless mode so extensions remain available.
  args: [
    ...(launchOptions?.args ?? []),
    ...(headless === true ? ['--headless=new'] : []),
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
})
