import { describe, expect, it } from 'vitest'

/**
 * Test Architecture - Effect RPC between 2 Durable Objects
 *
 *   ┌─────────────┐    HTTP     ┌─────────────────┐
 *   │ Test Client │ ──────────▶ │ Worker (router) │
 *   │  (vitest)   │             └─────────────────┘
 *   └─────────────┘                       │
 *                                         │ routes to DOs
 *              ┌────────────────────────────────────────────┐
 *              │                                            │
 *              │ /test-rpc-client                           │ /test-rpc
 *              ▼                                            ▼
 *   ┌─────────────────┐        CF DO RPC          ┌─────────────────┐
 *   │   Client DO     │ ─────────────────────────▶│   Server DO     │
 *   │                 │  serverDO.rpc(payload)    │                 │
 *   │ RpcClient.make  │                           │ toDurableObject │
 *   │ TestRpcs        │                           │ Handler         │
 *   │                 │                           │                 │
 *   │ client.Ping()   │                           │ TestRpcs.toLayer│
 *   │ client.Echo()   │                           │                 │
 *   │ client.Add()    │                           │ Ping/Echo/Add   │
 *   └─────────────────┘                           └─────────────────┘
 *
 * Test Path: Test → Worker → Client DO → Server DO (full Effect RPC)
 */

describe('Durable Object RPC', { timeout: 5000 }, () => {
  // Idiomatic Effect RPC client tests
  it('should use RPC client to call ping method', async () => {
    const port = process.env.LIVESTORE_SYNC_PORT
    const response = await fetch(`http://localhost:${port}/test-rpc-client?method=ping&message=Hello RPC Client`)

    expect(response.status).toBe(200)
    const result: any = await response.json()
    expect(result.success).toBe(true)
    expect(result.result).toEqual({ response: 'Pong: Hello RPC Client' })
  })

  it('should use RPC client to call echo method', async () => {
    const port = process.env.LIVESTORE_SYNC_PORT
    const response = await fetch(`http://localhost:${port}/test-rpc-client?method=echo&text=Echo via RPC Client`)

    expect(response.status).toBe(200)
    const result: any = await response.json()
    expect(result.success).toBe(true)
    expect(result.result).toEqual({ echo: 'Echo: Echo via RPC Client' })
  })

  it('should use RPC client to call add method', async () => {
    const port = process.env.LIVESTORE_SYNC_PORT
    const response = await fetch(`http://localhost:${port}/test-rpc-client?method=add&a=10&b=20`)

    expect(response.status).toBe(200)
    const result: any = await response.json()
    expect(result.success).toBe(true)
    expect(result.result).toEqual({ result: 30 })
  })

  it('should handle RPC fail method using Effect.fail', async () => {
    const port = process.env.LIVESTORE_SYNC_PORT
    const response = await fetch(`http://localhost:${port}/test-rpc-client?method=fail&message=test failure`)

    expect(response.status).toBe(500)
    const result: any = await response.json()
    expect(result.success).toBe(false)
    expect(result.error).toContain('RPC failure: test failure')
  })

  it('should handle defect method using Effect.die', async () => {
    const port = process.env.LIVESTORE_SYNC_PORT
    const response = await fetch(`http://localhost:${port}/test-rpc-client?method=defect&message=test defect`)

    expect(response.status).toBe(500)
    const result: any = await response.json()
    expect(result.success).toBe(false)
    expect(result.error).toContain('some defect: test defect')
  })

  it('should handle streaming RPC method', async () => {
    const port = process.env.LIVESTORE_SYNC_PORT
    const response = await fetch(`http://localhost:${port}/test-rpc-client?method=stream&count=4`)

    expect(response.status).toBe(200)
    const result: any = await response.json()
    expect(result.success).toBe(true)
    expect(result.result).toEqual({ streamValues: [1, 4, 9, 16] }) // squares of 1,2,3,4
  })

  it('should handle streaming RPC with different count', async () => {
    const port = process.env.LIVESTORE_SYNC_PORT
    const response = await fetch(`http://localhost:${port}/test-rpc-client?method=stream&count=2`)

    expect(response.status).toBe(200)
    const result: any = await response.json()
    expect(result.success).toBe(true)
    expect(result.result).toEqual({ streamValues: [1, 4] }) // squares of 1,2
  })

  it('should handle streaming RPC with error during stream', async () => {
    const port = process.env.LIVESTORE_SYNC_PORT
    const response = await fetch(`http://localhost:${port}/test-rpc-client?method=stream-error&count=5&errorAfter=4`)

    expect(response.status).toBe(500)
    const result: any = await response.json()
    expect(result.success).toBe(false)
    expect(result.error).toContain('Stream error after 4: got 9') // Fails at square of 3 (9 > 4)
  })

  it('should handle streaming RPC with defect during stream', async () => {
    const port = process.env.LIVESTORE_SYNC_PORT
    const response = await fetch(`http://localhost:${port}/test-rpc-client?method=stream-defect&count=4&defectAfter=1`)

    expect(response.status).toBe(500)
    const result: any = await response.json()
    expect(result.success).toBe(false)
    expect(result.error).toContain('Stream defect after 1: got 4') // Dies at square of 2 (4 > 1)
  })
})
