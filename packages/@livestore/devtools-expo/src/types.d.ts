import type * as http from 'node:http'

import type * as Vite from 'vite'

export type Middleware = (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => void

export type Options = {
  viteConfig?: (config: Vite.UserConfig) => Vite.UserConfig
  /**
   * Path to the file exporting the LiveStore schema as `export const schema = ...`
   * File path must be relative to the project root and will be imported via Vite.
   *
   * Example: `./src/schema.ts`
   */
  schemaPath: string
  /**
   * The port to listen on for the devtools server
   *
   * @default 4242
   */
  port: number
  /**
   * The host to listen on for the devtools server
   *
   * @default 'localhost'
   */
  host: string
}
