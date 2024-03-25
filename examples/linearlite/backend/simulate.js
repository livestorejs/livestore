import createPool, { sql } from '@databases/pg'
import { getConfig } from 'electric-sql/cli'
import { nanoid } from 'nanoid'

const { DATABASE_URL } = getConfig()
const INTERVAL = parseInt(process.env.INTERVAL) || 1000
const INTERVAL_JITTER = parseFloat(process.env.JITTER) || 0.2

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

let issueCount = 0

function makeRandomIssue() {
  const priority = Math.random() < 0.5 ? 'low' : 'medium'
  const status = Math.random() < 0.9 ? 'todo' : 'in_progress'
  return {
    title: `Issue ${issueCount}`,
    username: 'test',
    priority,
    status,
    description: 'This is a description',
  }
}

async function main() {
  console.info(`Simulating issue creation..`)
  console.info(`Interval: ${INTERVAL}ms ± ${INTERVAL_JITTER * 100}%`)
  console.log('')
  while (true) {
    await db.tx(async (db) => {
      // process.stdout.write(`Creating issue ${issueCount}\r`)
      await importIssue(db, makeRandomIssue())
    })
    issueCount++
    const interval = INTERVAL + (Math.random() - 0.5) * INTERVAL_JITTER * INTERVAL
    console.log(`Created issue ${issueCount}, waiting ${interval}ms`)
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
}).finally(() => {
  db.dispose()
})
