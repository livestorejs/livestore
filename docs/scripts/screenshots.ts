/**
 * Capture example screenshots as LOCAL Astro assets under
 * `docs/src/assets/examples/`. Run via `devenv tasks run docs:screenshots`.
 *
 * Why local assets: the docs production build optimizes these images at build
 * time via the local `sharp` service. Vendoring them (instead of fetching remote
 * `gitbucket.schickling.dev` URLs through `image.domains`) keeps the build
 * hermetic — a transient image-fetch failure can no longer hard-abort the deploy.
 *
 * What this captures: the 3 in-repo web apps. For each we spawn the SAME Vite dev
 * server the example's `playwright.config.ts` uses (`pnpm vite --force`), drive it
 * with Playwright at a fixed 1000x700 viewport, seed DETERMINISTIC demo data, and
 * write `docs/src/assets/examples/<id>.png`.
 *
 * The 3 contrib apps (todomvc-solid, todomvc-custom-elements, cf-chat) live in the
 * external `livestore-contrib` repo and are NOT runnable from here; they are
 * refreshed manually from gitbucket until that repo grows its own capture task
 * (see the header comment in `docs/src/data/examples.ts`).
 *
 * Note: Playwright's browser is Nix-managed in this repo. Do not `npx playwright`
 * or set `PLAYWRIGHT_BROWSERS_PATH`; the `chromium` launcher resolves it.
 *
 * Fidelity caveat: the running dev apps render dev-mode chrome (e.g. an FPS
 * stats overlay and a version badge), so this task's output is NOT yet
 * pixel-equal to the polished screenshots currently vendored under
 * `docs/src/assets/examples/`. Those committed PNGs remain the source of truth;
 * see the follow-up issue to align capture output with the shipped look.
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium, type Page } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..', '..')
const assetsDir = path.resolve(__dirname, '..', 'src', 'assets', 'examples')

/** All example screenshots are 1000w x 700h for a consistent CardGrid layout. */
const VIEWPORT = { width: 1000, height: 700 } as const

interface CaptureTarget {
  /** Output basename → `docs/src/assets/examples/<id>.png`. */
  readonly id: string
  /** Example workspace dir (relative to repo root) whose Vite server we reuse. */
  readonly exampleDir: string
  /** Selector that signals the app has hydrated; waited for before seeding. */
  readonly readySelector: string
  /** Seed deterministic demo data, then leave the page in its capture state. */
  readonly seed: (page: Page) => Promise<void>
}

/** TodoMVC (React) and TodoMVC + CF Sync share the same DOM contract. */
const seedTodoMvc = async (page: Page): Promise<void> => {
  const todos = ['Buy groceries', 'Read the LiveStore docs', 'Ship the docs deploy fix']
  for (const text of todos) {
    await page.fill('.new-todo', text)
    await page.press('.new-todo', 'Enter')
  }
  // Toggle the first todo complete for a representative mixed (active/done) state.
  await page.locator('.todo-list li .toggle').first().check()
  await page.waitForTimeout(300)
}

const targets: CaptureTarget[] = [
  { id: 'todomvc-react', exampleDir: 'examples/web-todomvc', readySelector: '.new-todo', seed: seedTodoMvc },
  { id: 'todomvc-sync-cf', exampleDir: 'examples/web-todomvc-sync-cf', readySelector: '.new-todo', seed: seedTodoMvc },
  {
    id: 'linearlite',
    exampleDir: 'examples/web-linearlite',
    // LinearLite renders its main layout once the store is ready.
    readySelector: 'main',
    // It seeds its own deterministic sample issues on first load
    // (see `examples/web-linearlite/src/livestore/seed.ts`); give the seeded
    // issue list a moment to render so the capture is stable.
    seed: async (page) => {
      await page.waitForTimeout(3000)
    },
  },
]

const main = async (): Promise<void> => {
  for (const target of targets) {
    console.log(`\n▶ capturing ${target.id} (${target.exampleDir})`)
    await capture(target)
  }
  console.log('\n✅ screenshots captured to docs/src/assets/examples/')
}

const capture = async (target: CaptureTarget): Promise<void> => {
  const port = await getFreePort()
  const cwd = path.resolve(repoRoot, target.exampleDir)

  // Reuse each example's dev-server command (`pnpm vite --force`, PORT via env),
  // mirroring its `playwright.config.ts` `webServer` block.
  const server = spawn('pnpm', ['vite', '--force', '--host', '127.0.0.1'], {
    cwd,
    env: { ...process.env, PORT: String(port) },
    stdio: 'inherit',
  })

  try {
    const baseURL = `http://127.0.0.1:${port}`
    await waitForServer(baseURL, 180_000)

    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
      // LiveStore apps keep a persistent sync/devtools WebSocket open, so
      // `networkidle` never settles — wait for DOM + the app's ready selector.
      await page.goto(baseURL, { waitUntil: 'domcontentloaded' })
      await page.waitForSelector(target.readySelector, { timeout: 90_000 })
      await target.seed(page)
      const out = path.resolve(assetsDir, `${target.id}.png`)
      await page.screenshot({ path: out })
      console.log(`  wrote ${out}`)
    } finally {
      await browser.close()
    }
  } finally {
    server.kill('SIGTERM')
  }
}

const waitForServer = async (baseURL: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(baseURL)
      if (res.ok === true || res.status < 500) return
    } catch {
      // server not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Dev server at ${baseURL} did not become ready within ${timeoutMs}ms`)
}

const getFreePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to allocate a free port'))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })

await main()
