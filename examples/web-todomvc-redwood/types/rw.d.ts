import type { AppContext } from '../src/worker.tsx'

declare module 'rwsdk/worker' {
  interface DefaultAppContext extends AppContext {}
}
