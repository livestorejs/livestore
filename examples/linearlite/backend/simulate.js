import createPool, { sql } from '@databases/pg'
import { getConfig } from 'electric-sql/cli'
import { nanoid } from 'nanoid'
import crypto from 'crypto'

const { DATABASE_URL } = getConfig()
const INTERVAL = process.env.INTERVAL ?? parseInt(process.env.INTERVAL)
const INTERVAL_JITTER = parseFloat(process.env.JITTER) || 0.2
const BATCH = parseInt(process.env.BATCH) || 1
const CONTENT_SIZE = parseInt(process.env.CONTENT_SIZE) || 10

console.info(`Connecting to Postgres..`)
const db = createPool(DATABASE_URL)

async function makeInsertQuery(db, table, data) {
  const columns = Object.keys(data)
  const columnsNames = columns.map(n => `"${n}"`).join(', ')
  const values = columns.map((column) => data[column])
  return await db.query(sql`
    INSERT INTO ${sql.ident(table)} (${sql(columnsNames)})
    VALUES (${sql.join(values.map(sql.value), ', ')})
  `)
}

async function importIssue(db, issueData) {
  const { description, ...issue } = issueData;
  const id = nanoid()
  const now = (new Date()).getTime()
  await makeInsertQuery(db, 'issue', {
    id: id,
    title: issue.title,
    creator: issue.username,
    priority: issue.priority,
    status: issue.status,
    created: now,
    modified: now,
    kanbanorder: '',
  })
  await makeInsertQuery(db, 'description', {
    id: id,
    body: description,
  })
}

let insertCount = 0

function makeRandomIssue(i) {
  const priority = Math.random() < 0.5 ? 'low' : 'medium'
  const status = Math.random() < 0.9 ? 'todo' : 'in_progress'
  const timestamp = Date.now()
  return {
    title: `Issue ${timestamp} ${i}`,
    username: 'test',
    priority,
    status,
    description: crypto.randomBytes(Math.ceil(CONTENT_SIZE / 2)).toString('hex').slice(0, CONTENT_SIZE),
  }
}

async function main() {
  console.info(`Simulating issue creation..`)
  if (INTERVAL) console.info(`Interval: ${INTERVAL}ms ± ${INTERVAL_JITTER * 100}%`)
  console.log('')
  while (true) {
    await db.tx(async (db) => {
      process.stdout.write(`Creating inset ${insertCount}\r`)
      for (let i = 0; i < BATCH; i++) {
        await importIssue(db, makeRandomIssue(i))
      }
    })
    insertCount++
    if (INTERVAL) {
      const interval = INTERVAL + (Math.random() - 0.5) * INTERVAL_JITTER * INTERVAL
      await new Promise((resolve) => setTimeout(resolve, interval))
    } else {
      break
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
}).finally(() => {
  db.dispose()
})
