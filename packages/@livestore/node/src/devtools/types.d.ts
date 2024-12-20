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
   * The mode of the devtools server.
   *
   * @default 'node'
   */
  mode:
    | {
        _tag: 'node'
        storeId: string
        url: string
      }
    | {
        _tag: 'expo'
      }
}
