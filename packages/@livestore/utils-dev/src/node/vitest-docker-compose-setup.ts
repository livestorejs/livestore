import { spawn } from 'node:child_process'
import path from 'node:path'
import { Effect, UnknownError } from '@livestore/utils/effect'
import { cmd } from './cmd.ts'

export const startDockerComposeServices = (args: StartDockerComposeServicesArgs) =>
  Effect.tryPromise({
    try: () => startDockerComposeServicesPromise(args),
    catch: (error) => UnknownError.make({ cause: new Error(`Failed to start Docker Compose: ${error}`) }),
  }).pipe(Effect.withSpan('startDockerComposeServices'))

type StartDockerComposeServicesArgs = {
  composeFilePath?: string
  cwd: string
  serviceName?: string
  waitForLog?: string
  env?: Record<string, string>
  healthCheck?: {
    url: string // URL template with ${port} placeholder
    expectedStatus?: number // default 200
    maxAttempts?: number // default 30
    delayMs?: number // default 1000
  }
  /** @default false */
  forwardLogs?: boolean
}

export const pullDockerComposeImages = ({
  cwd,
  composeFilePath,
}: Pick<StartDockerComposeServicesArgs, 'composeFilePath' | 'cwd'>) =>
  Effect.gen(function* () {
    const resolvedComposeFilePath = path.resolve(composeFilePath ?? path.join(cwd, 'docker-compose.yml'))
    yield* cmd(['docker', 'compose', '-f', resolvedComposeFilePath, 'pull'], { cwd })
  }).pipe(Effect.withSpan('pullDockerComposeImages'))

/**
 * Starts Docker Compose services for testing with automatic cleanup.
 * Automatically allocates a free port and passes it as EXPOSED_PORT environment variable.
 *
 * @param composeFilePath - Path to docker-compose.yml file (defaults to `${cwd}/docker-compose.yml`)
 * @param cwd - Working directory for Docker Compose commands
 * @param env - Environment variables to pass to the Docker Compose commands (useful for passing ports)
 * @param serviceName - Optional specific service to start (omit to start all)
 * @param waitForLog - Log pattern to wait for before considering services ready
 * @param healthCheck - Health check configuration for waiting until service is ready
 */
// TODO refactor implementation with Effect
// TODO add test for this
export const startDockerComposeServicesPromise = async ({
  composeFilePath,
  cwd,
  serviceName,
  waitForLog,
  healthCheck,
  env,
  forwardLogs = false,
}: StartDockerComposeServicesArgs) => {
  let dockerComposeProcess: ReturnType<typeof spawn> | undefined

  const setup = async () => {
    const resolvedComposeFilePath = path.resolve(composeFilePath ?? path.join(cwd, 'docker-compose.yml'))

    // Build the docker compose command arguments
    const composeArgs = ['compose', '-f', resolvedComposeFilePath, 'up']

    // Add service name if specified
    if (serviceName) {
      composeArgs.push(serviceName)
    }

    dockerComposeProcess = spawn('docker', composeArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env, ...env },
    })

    dockerComposeProcess.stdout?.setEncoding('utf8')
    dockerComposeProcess.stderr?.setEncoding('utf8')

    if (forwardLogs) {
      dockerComposeProcess.stdout?.on('data', (data: string) => {
        console.log(data)
      })

      dockerComposeProcess.stderr?.on('data', (data: string) => {
        console.error(data)
      })
    }

    // Wait for the service to be ready
    if (healthCheck) {
      // Use health check approach
      const maxAttempts = healthCheck.maxAttempts ?? 30
      const delayMs = healthCheck.delayMs ?? 1000
      const expectedStatus = healthCheck.expectedStatus ?? 200
      const healthUrl = healthCheck.url

      console.log(`Waiting for health check at ${healthUrl}...`)

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          const response = await fetch(healthUrl)
          if (response.status === expectedStatus) {
            console.log(`Health check passed after ${attempt} attempts`)
            break
          }
          console.log(`Health check attempt ${attempt}/${maxAttempts}: status ${response.status}`)
        } catch (error) {
          console.log(
            `Health check attempt ${attempt}/${maxAttempts}: ${error instanceof Error ? error.message : 'failed'}`,
          )
        }

        if (attempt === maxAttempts) {
          throw new Error(`Health check failed after ${maxAttempts} attempts at ${healthUrl}`)
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    } else if (waitForLog) {
      // Fallback to log-based waiting
      await new Promise<void>((resolve) => {
        const onData = (data: string) => {
          if (data.includes(waitForLog)) {
            dockerComposeProcess?.stdout?.off('data', onData)
            resolve()
          }
        }
        dockerComposeProcess?.stdout?.on('data', onData)
        dockerComposeProcess?.stderr?.on('data', onData)
      })
    } else {
      // No wait condition, just give it a moment to start
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }

    console.log(`Docker Compose services ready${serviceName ? ` (${serviceName})` : ''}`)
  }

  const stopDockerComposeServices = async () => {
    if (dockerComposeProcess) {
      console.log('Stopping Docker Compose services...')

      const resolvedComposeFilePath = path.resolve(composeFilePath ?? path.join(cwd, 'docker-compose.yml'))

      // Use docker compose down to properly stop and clean up
      const downProcess = spawn('docker', ['compose', '-f', resolvedComposeFilePath, 'down'], {
        stdio: 'inherit',
        cwd,
      })

      await new Promise<void>((resolve) => {
        downProcess.on('close', () => {
          resolve()
        })
      })

      dockerComposeProcess.kill('SIGTERM')
      dockerComposeProcess = undefined
    }
  }

  process.on('exit', () => {
    stopDockerComposeServices()
  })
  process.on('SIGINT', () => {
    stopDockerComposeServices()
  })
  process.on('SIGTERM', () => {
    stopDockerComposeServices()
  })

  // try {
  //   const { afterAll } = await import('vitest')
  //   afterAll(async () => {
  //     await stopDockerComposeServices()
  //   })
  // } catch {}

  await setup()
}
