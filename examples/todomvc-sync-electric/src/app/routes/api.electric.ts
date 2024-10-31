import { ApiPayload } from '@livestore/sync-electric'
import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'
import { Schema } from 'effect'

import { makeDb } from '@/server/db.js'

export const action = async ({ request }: ActionFunctionArgs) => {
  const payload = await request.json()
  const parsedPayload = Schema.decodeUnknownSync(ApiPayload)(payload)

  const db = makeDb(parsedPayload.roomId)

  if (parsedPayload._tag === 'sync-electric.InitRoom') {
    await db.migrate()
    return json({ success: true })
  }

  if (parsedPayload.persisted) {
    await db.createEvents([parsedPayload.mutationEventEncoded])
  } else {
    console.warn(`Electric sync backend doesn't yet support unpersisted events`)
  }

  await db.disconnect()

  return json({ success: true })
}
