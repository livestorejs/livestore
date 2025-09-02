// Debug helpers for tracking process state and resource usage

export function logProcessState(label: string) {
  const mem = process.memoryUsage()
  console.log(`[PROCESS STATE] ${label}:`)
  console.log(`  PID: ${process.pid}`)
  console.log(`  Memory: heap=${Math.round(mem.heapUsed / 1024 / 1024)}MB, rss=${Math.round(mem.rss / 1024 / 1024)}MB`)
  console.log(`  Active handles: ${(process as any)._getActiveHandles?.()?.length || 'N/A'}`)
  console.log(`  Active requests: ${(process as any)._getActiveRequests?.()?.length || 'N/A'}`)

  // Log any unclosed handles (helps identify leaks)
  if ((process as any)._getActiveHandles) {
    const handles = (process as any)._getActiveHandles()
    const types = handles.map((h: any) => h.constructor?.name || 'unknown')
    const counts: Record<string, number> = {}
    for (const t of types) {
      counts[t] = (counts[t] || 0) + 1
    }
    console.log(`  Handle types:`, counts)
  }
}

export function setupProcessMonitoring() {
  // Track unhandled rejections and uncaught exceptions
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[UNHANDLED REJECTION]', reason)
    console.error('Promise:', promise)
  })

  process.on('uncaughtException', (error) => {
    console.error('[UNCAUGHT EXCEPTION]', error)
  })

  // Log when child processes exit
  process.on('exit', (code) => {
    console.log(`[PROCESS EXIT] Code: ${code}`)
    logProcessState('At exit')
  })
}

// Track worker processes
const activeWorkers = new Set<any>()

export function trackWorker(worker: any, name: string) {
  console.log(`[WORKER] Creating ${name}, PID: ${worker.pid || 'unknown'}`)
  activeWorkers.add(worker)

  worker.on('exit', (code: number) => {
    console.log(`[WORKER] ${name} exited with code ${code}`)
    activeWorkers.delete(worker)
  })

  worker.on('error', (err: Error) => {
    console.error(`[WORKER] ${name} error:`, err)
  })
}

export function logActiveWorkers() {
  console.log(`[WORKERS] Active count: ${activeWorkers.size}`)
}
