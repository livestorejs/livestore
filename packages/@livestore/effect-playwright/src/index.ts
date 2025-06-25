import process from 'node:process'

import { envTruish } from '@livestore/utils'
import { Context, Effect, Layer, Option, Schema, Stream } from '@livestore/utils/effect'
import * as PW from '@playwright/test'

export class BrowserContext extends Context.Tag('Playwright.BrowserContext')<
  BrowserContext,
  {
    browserContext: PW.BrowserContext
    // backgroundPageConsoleFiber: Fiber.Fiber<void, SiteError> | undefined
  }
>() {}

export type MakeBrowserContextParams = {
  extensionPath?: string
  persistentContextPath: string
  launchOptions?: Omit<PW.LaunchOptions, 'headless'>
}

export const handlePageConsole = ({
  page,
  name,
  shouldEvaluateArgs = false,
}: {
  page: PW.Page
  name: string
  shouldEvaluateArgs?: boolean
}) =>
  pageConsole({ page, label: name, shouldEvaluateArgs }).pipe(
    // Stream.tap((_) => Effect.log(`${name}[${_.type}]: ${_.message}`, ..._.args)),
    Stream.runDrain,
    Effect.withSpan(`handlePageConsole-${name}`),
  )

export const browserContext = ({ extensionPath, persistentContextPath, launchOptions }: MakeBrowserContextParams) =>
  Effect.gen(function* () {
    const headless = envTruish(process.env.PLAYWRIGHT_HEADLESS)
    let browserContext: PW.BrowserContext
    // let backgroundPageConsoleFiber: Fiber.Fiber<void, SiteError> | undefined

    if (extensionPath === undefined) {
      browserContext = yield* Effect.promise(() =>
        PW.chromium.launchPersistentContext(persistentContextPath, {
          ...launchOptions,
          headless,
          devtools: true,
        }),
      )
    } else {
      process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1'

      browserContext = yield* Effect.promise(() =>
        PW.chromium.launchPersistentContext(persistentContextPath, {
          ...launchOptions,
          headless: false, // Using `--headless` flag below instead
          args: [
            headless ? `--headless=new` : '', // Headless mode https://playwright.dev/docs/chrome-extensions#headless-mode
            `--disable-extensions-except=${extensionPath}`,
            `--load-extension=${extensionPath}`,
          ],
        }),
      )

      // TODO bring back once Playwright supports console messages for workers/service workers
      // const backgroundPage = browserContext.serviceWorkers()[0] ?? (yield* Effect.promise(() => browserContext.waitForEvent('serviceworker')))
      // backgroundPageConsoleFiber = yield* handlePageConsole(backgroundPage, 'background').pipe(Effect.fork)
    }

    yield* Effect.addFinalizer(() => Effect.promise(() => browserContext.close()))

    return {
      browserContext,
      // backgroundPageConsoleFiber
    }
  })

export const browserContextLayer = (params: MakeBrowserContextParams) =>
  Layer.scoped(BrowserContext, browserContext(params))

export const withPage = <T>(f: () => Promise<T>, options?: { label?: string }): Effect.Effect<T, SiteError> =>
  Effect.tryPromise({
    try: () => f(),
    catch: (cause) => new SiteError({ label: options?.label ?? f.toString(), messages: cause }),
  }).pipe(Effect.withSpan(`withPage:${options?.label ?? f.toString()}`))

export class ConsoleMessage extends Schema.TaggedStruct('Playwright.ConsoleMessage', {
  type: Schema.Literal('error', 'log', 'warn', 'info', 'debug', 'group', 'groupCollapsed', 'groupEnd'),
  message: Schema.String,
  args: Schema.Array(Schema.Any),
}) {}

type PlaywrightConsoleMessageType =
  | 'log'
  | 'debug'
  | 'info'
  | 'error'
  | 'warning'
  | 'dir'
  | 'dirxml'
  | 'table'
  | 'trace'
  | 'clear'
  | 'startGroup'
  | 'startGroupCollapsed'
  | 'endGroup'
  | 'assert'
  | 'profile'
  | 'profileEnd'
  | 'count'
  | 'timeEnd'

// https://playwright.dev/docs/api/class-consolemessage
const parsePlaywrightConsoleMessage = async (
  message: PW.ConsoleMessage,
  shouldEvaluateArgs: boolean,
): Promise<Option.Option<typeof ConsoleMessage.Type>> => {
  const msgType = message.type() as PlaywrightConsoleMessageType
  const msg = message.text()
  const args_ = shouldEvaluateArgs
    ? await Promise.all(
        message.args().map(async (argHandle) => {
          const isDisposable = await argHandle
            .evaluate((arg) => arg instanceof MessagePort || arg instanceof Uint8Array || arg instanceof ArrayBuffer)
            .catch((e) => `<Error in serialization: ${e.message}>`)
          return isDisposable
            ? '<Disposable>'
            : await argHandle.jsonValue().catch((e) => `<Error in serialization: ${e.message}>`)
        }),
      )
    : []

  // We don't want to repeat the message in the args
  const args = args_.join(' ') === msg ? [] : args_

  const type = (() => {
    switch (msgType) {
      case 'error': {
        return 'error'
      }
      case 'log': {
        return 'log'
      }
      case 'warning': {
        return 'warn'
      }
      case 'debug': {
        return 'debug'
      }
      case 'info': {
        return 'info'
      }
      case 'endGroup': {
        return 'groupEnd'
      }
      case 'startGroup': {
        return 'group'
      }
      case 'startGroupCollapsed': {
        return 'groupCollapsed'
      }
      default: {
        console.warn(`Unsupported console message type: ${msgType}`, msg, args)
        return undefined
      }
    }
  })()

  if (type === undefined) {
    return Option.none()
  }

  return Option.some(ConsoleMessage.make({ type, message: msg, args }))
}

const ref = <T>(initial: T) => ({ current: initial })

// TODO remove `label` again once error tracing works properly with Playwright
export const pageConsole = ({
  page,
  label,
  shouldEvaluateArgs,
}: {
  page: PW.Page
  label: string
  shouldEvaluateArgs: boolean
}) =>
  Stream.asyncPush<typeof ConsoleMessage.Type, SiteError>((emit) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const errorGroupRef = ref<{ errorMessages: (typeof ConsoleMessage.Type)[] } | undefined>(undefined)
        const onConsole = async (pwConsoleMessage: PW.ConsoleMessage) => {
          const parsed = await parsePlaywrightConsoleMessage(pwConsoleMessage, shouldEvaluateArgs)
          if (Option.isSome(parsed)) {
            const message = parsed.value

            // TODO nested groups
            if (
              (message.type === 'group' || message.type === 'groupCollapsed') &&
              message.message.includes('%cERROR%c')
            ) {
              errorGroupRef.current = { errorMessages: [message] }
            } else if (message.type === 'groupEnd' && errorGroupRef.current !== undefined) {
              emit.fail(new SiteError({ label, messages: errorGroupRef.current.errorMessages }))
            } else if (
              message.type === 'error' &&
              message.message.includes(
                'Failed to load resource: the server responded with a status of 404 (Not Found)',
              ) === false &&
              message.message.includes('All fibers interrupted without errors') === false
            ) {
              if (errorGroupRef.current === undefined) {
                emit.fail(new SiteError({ label, messages: [message] }))
              } else {
                errorGroupRef.current.errorMessages.push(message)
              }
            } else {
              emit.single(message)
            }
          }
        }
        page.on('console', onConsole)

        const onPageError = (cause: Error) => emit.fail(new SiteError({ label, messages: [cause] }))
        page.on('pageerror', onPageError)

        return { onConsole, onPageError }
      }),
      ({ onConsole, onPageError }) =>
        Effect.sync(() => {
          console.log('stop listening to page console')
          page.off('console', onConsole)
          page.off('pageerror', onPageError)
        }),
    ),
  )

export class SiteError extends Schema.TaggedError<SiteError>()('Playwright.SiteError', {
  // TODO remove `label` again once error tracing works properly with Playwright
  label: Schema.String,
  messages: Schema.Union(Schema.Array(ConsoleMessage), Schema.Defect),
}) {}
