declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import('./src/worker')
  }

  interface Env {
    ASSETS: Fetcher
  }
}

interface Env extends Cloudflare.Env {}
