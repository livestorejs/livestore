import { nanoid } from '@livestore/livestore'
import { describe, expect, test } from 'vitest'

const BASE_URL = `http://localhost:${process.env.LIVESTORE_SYNC_PORT}`

interface Todo {
  id: string
  text: string
  completed: boolean
}

interface CreateTodoResponse {
  success: boolean
}

interface StatusResponse {
  isWarm: boolean
  storeType: string
  adapter: string
}

describe('Real Hibernation-Aware LiveStore Integration', { timeout: 60_00000 }, () => {
  // test('hibernation status endpoint shows cold/warm state correctly', async () => {
  //   const storeId = `hibernation-status-test-${nanoid()}`

  //   // First request should show cold state
  //   const coldStatusResponse = await fetch(`${BASE_URL}/hibernation/status?storeId=${storeId}`)
  //   expect(coldStatusResponse.status).toBe(200)

  //   const coldStatus = (await coldStatusResponse.json()) as StatusResponse
  //   expect(coldStatus.isWarm).toBe(false)
  //   expect(coldStatus.storeType).toBe('Not initialized')
  //   expect(coldStatus.adapter).toBe('Real CloudFlare Adapter')

  //   // Second request to same DO should now show warm state
  //   const warmStatusResponse = await fetch(`${BASE_URL}/hibernation/status?storeId=${storeId}`)
  //   const warmStatus = (await warmStatusResponse.json()) as StatusResponse

  //   expect(warmStatus.isWarm).toBe(true)
  //   expect(warmStatus.storeType).toBe('Real LiveStore')
  // })

  test('data persists across DO requests (simulating hibernation cycles)', async () => {
    const storeId = `hibernation-persistence-test-${nanoid()}`

    // TODO there is an issue when using the same storeId again, the client seems to pull the same events from the sync backend and local eventlog which leads to a race condition/unique constraint violation
    // const storeId = 'hibernation-persistence-test1'

    // Create a todo in the DO
    const createResponse = await fetch(`${BASE_URL}/hibernation/create-todo?storeId=${storeId}`, {
      method: 'POST',
      body: JSON.stringify({ text: 'Persistent todo' }),
      headers: { 'Content-Type': 'application/json' },
    })

    expect(createResponse.status).toBe(200)
    const createResult = (await createResponse.json()) as CreateTodoResponse
    expect(createResult.success).toBe(true)

    // Query todos - this should work immediately
    const queryResponse = await fetch(`${BASE_URL}/hibernation/query-todos?storeId=${storeId}`)
    expect(queryResponse.status).toBe(200)

    const todos = (await queryResponse.json()) as Todo[]
    expect(Array.isArray(todos)).toBe(true)
    expect(todos).toHaveLength(1)
    expect(todos[0]?.text).toBe('Persistent todo')
    expect(todos[0]?.completed).toBe(false)
  })

  // test('different DO instances are properly isolated', async () => {
  //   const doName1 = 'hibernation-isolation-test-1'
  //   const doName2 = 'hibernation-isolation-test-2'

  //   // Create different todos in different DOs
  //   await fetch(`${BASE_URL}/hibernation/create-todo?do=${doName1}`, {
  //     method: 'POST',
  //     body: JSON.stringify({ text: 'Todo in DO 1' }),
  //     headers: { 'Content-Type': 'application/json' },
  //   })

  //   await fetch(`${BASE_URL}/hibernation/create-todo?do=${doName2}`, {
  //     method: 'POST',
  //     body: JSON.stringify({ text: 'Todo in DO 2' }),
  //     headers: { 'Content-Type': 'application/json' },
  //   })

  //   // Verify isolation
  //   const todos1Response = await fetch(`${BASE_URL}/hibernation/query-todos?do=${doName1}`)
  //   const todos1 = (await todos1Response.json()) as Todo[]
  //   expect(todos1).toHaveLength(1)
  //   expect(todos1[0].text).toBe('Todo in DO 1')

  //   const todos2Response = await fetch(`${BASE_URL}/hibernation/query-todos?do=${doName2}`)
  //   const todos2 = (await todos2Response.json()) as Todo[]
  //   expect(todos2).toHaveLength(1)
  //   expect(todos2[0].text).toBe('Todo in DO 2')
  // })

  // test('store initialization is idempotent across multiple requests', async () => {
  //   const doName = 'hibernation-idempotent-test'

  //   // Make multiple rapid requests to same DO
  //   const responses = await Promise.all([
  //     fetch(`${BASE_URL}/hibernation/status?do=${doName}`),
  //     fetch(`${BASE_URL}/hibernation/status?do=${doName}`),
  //     fetch(`${BASE_URL}/hibernation/status?do=${doName}`),
  //   ])

  //   // All should succeed
  //   responses.forEach((response) => {
  //     expect(response.status).toBe(200)
  //   })

  //   const statuses = await Promise.all(responses.map((r) => r.json() as Promise<StatusResponse>))

  //   // All should show warm state (store initialized)
  //   statuses.forEach((status) => {
  //     expect(status.isWarm).toBe(true)
  //     expect(status.storeType).toBe('Real LiveStore')
  //   })
  // })

  // test('hibernation force endpoint exists (for future testing)', async () => {
  //   const doName = 'hibernation-force-test'

  //   const response = await fetch(`${BASE_URL}/hibernation/force-hibernation?do=${doName}`, {
  //     method: 'POST',
  //   })

  //   expect(response.status).toBe(200)
  //   const result = await response.json()
  //   expect(result.success).toBe(true)
  //   expect(result.message).toContain('hibernate')
  // })
})
