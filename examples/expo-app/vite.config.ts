/* eslint-disable prefer-arrow/prefer-arrow-functions */
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import { WebSocketServer } from 'ws'

// Needed for OPFS Sqlite to work
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements
const credentiallessHeaders = {
  // https://developer.chrome.com/blog/coep-credentialless-origin-trial/
  // 'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Service-Worker-Allowed': '/',
}

const isProdBuild = process.env.NODE_ENV === 'production'

const websocketPlugin = (): Plugin => {
  let wsServer: WebSocketServer

  return {
    name: 'vite-plugin-websocket',
    configureServer(server) {
      wsServer = new WebSocketServer({ noServer: true })

      server.httpServer?.on('upgrade', (request, socket, head) => {
        console.log('upgrade', request.url)
        if (request.url === '/message') {
          wsServer.handleUpgrade(request, socket, head, (ws) => {
            wsServer.emit('connection', ws, request)
          })
        }
      })

      wsServer.on('connection', (socket) => {
        socket.on('message', (message) => {
          // console.log(`Received and broadcasting message: ${message}`)
          // Broadcast the message to all connected clients except the sender
          wsServer.clients.forEach((client) => {
            if (client !== socket && client.readyState === WebSocket.OPEN) {
              client.send(message)
            }
          })
        })

        socket.on('error', (error) => {
          console.error('WebSocket error:', error)
        })

        console.log(`New WebSocket connection (${wsServer.clients.size} total)`)
      })

      wsServer.on('error', (error) => {
        console.error('WebSocket server error:', error)
      })
    },
    closeBundle() {
      if (wsServer) {
        wsServer.clients.forEach((client) => client.terminate())
        wsServer.close()
      }
    },
  }
}

// https://vitejs.dev/config
export default defineConfig({
  server: {
    port: 60_100,
    host: '0.0.0.0',
    hmr: process.env.DISABLE_HMR === undefined ? true : false,
    headers: credentiallessHeaders,
    fs: {
      // NOTE currently needed for embedding the `LiveStore` monorepo in another monorepo (e.g. under `/other-monorepo/submodules/livestore`)
      // Feel free to remove this if you're just copying this example
      allow: ['../../../..'],
    },
  },
  preview: {
    headers: credentiallessHeaders,
  },
  build: {
    //   sourcemap: true,
    //   minify: false,
  },
  worker: isProdBuild ? { format: 'es' } : undefined,
  optimizeDeps: {
    // TODO remove once fixed https://github.com/vitejs/vite/issues/8427
    exclude: ['@livestore/sqlite-wasm'],
  },
  plugins: [
    websocketPlugin(),
    // Needed for OPFS Sqlite to work
    {
      name: 'configure-response-headers',
      configureServer: (server) => {
        server.middlewares.use((_req, res, next) => {
          Object.entries(credentiallessHeaders).forEach(([key, value]) => res.setHeader(key, value))
          next()
        })
      },
    },
  ],
})
