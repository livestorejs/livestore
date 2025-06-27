import { createServer } from 'node:http'
import { chromium } from '@playwright/test'

process.env.PW_CHROMIUM_ATTACH_TO_OTHER = '1'

class BrowserManager {
  constructor() {
    this.currentBrowserServer = null
    this.currentWsEndpoint = null
  }

  async launchBrowser(launchOptions = {}) {
    // Close previous browser if exists
    if (this.currentBrowserServer) {
      console.log('Closing previous browser server...')
      await this.currentBrowserServer.close()
      this.currentBrowserServer = null
      this.currentWsEndpoint = null
    }

    // Launch new browser server
    console.log('Launching new browser server with options:', launchOptions)
    this.currentBrowserServer = await chromium.launchServer({
      ...launchOptions,
      _sharedBrowser: true,
    })
    this.currentWsEndpoint = this.currentBrowserServer.wsEndpoint()
    console.log('Browser server launched at:', this.currentWsEndpoint)

    return this.currentWsEndpoint
  }

  async closeBrowser() {
    console.trace('closing browser')
    if (this.currentBrowserServer) {
      await this.currentBrowserServer.close()
      this.currentBrowserServer = null
      this.currentWsEndpoint = null
    }
  }

  getCurrentEndpoint() {
    return this.currentWsEndpoint
  }
}

class BrowserServer {
  constructor() {
    this.browserManager = new BrowserManager()
    this.setupServer()
  }

  setupServer() {
    const server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/launch') {
        let body = ''
        req.on('data', (chunk) => {
          body += chunk.toString()
        })

        req.on('end', async () => {
          try {
            const launchOptions = JSON.parse(body)
            const wsEndpoint = await this.browserManager.launchBrowser(launchOptions)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ wsEndpoint }))
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: error.message }))
          }
        })
      } else if (req.method === 'GET' && req.url === '/endpoint') {
        const endpoint = this.browserManager.getCurrentEndpoint()
        if (endpoint) {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ wsEndpoint: endpoint }))
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'No browser running' }))
        }
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    server.listen(8080, () => {
      console.log('Browser management server started on port 8080')
    })

    return server
  }

  async shutdown() {
    await this.browserManager.closeBrowser()
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...')
  await server.shutdown()
  process.exit(0)
})

const server = new BrowserServer()
