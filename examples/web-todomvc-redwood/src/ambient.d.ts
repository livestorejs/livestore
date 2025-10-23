/// <reference types="vite/client" />

import type { WebAdapterSsrEncodedSnapshot } from '@livestore/adapter-web'

declare global {
  interface Window {
    __LIVESTORE_SSR__?: Record<string, WebAdapterSsrEncodedSnapshot>
  }
}
