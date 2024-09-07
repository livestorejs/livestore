import type { ActionFunctionArgs } from '@remix-run/node'
import { json } from '@remix-run/node'

import { makeDb } from '../../server/db.js'

export const action = async ({ request }: ActionFunctionArgs) => {
  const db = makeDb()

  const events = [
    {
      id: Date.now().toString(),
      argsJson: JSON.stringify({ test: 'test' }),
      mutation: 'test',
      schemaHash: 1,
      createdAt: new Date().toISOString(),
      syncStatus: 'synced' as const,
    },
  ]
  await db.createEvents(events)

  await db.disconnect()

  return json(events)

  // return json({ id: '123' })

  // if (request.method === `POST`) {
  //   const body = await request.json()
  //   const result = await db.query(
  //     `INSERT INTO items (id)
  //   VALUES ($1) RETURNING id;`,
  //     [body.uuid],
  //   )
  //   return json({ id: result.rows[0].id })
  // }
  // if (request.method === `DELETE`) {
  //   await db.query(`DELETE FROM items;`)
  //   return `ok`
  // }
}
