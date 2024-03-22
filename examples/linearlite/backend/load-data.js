import createPool, { sql } from '@databases/pg'
import fs from 'fs'
import path from 'path'
import * as url from 'url'

const dirname = url.fileURLToPath(new URL('.', import.meta.url))
const DATABASE_URL =
  process.env.ELECTRIC_DATABASE_URL || process.env.DATABASE_URL
const DATA_DIR = process.env.DATA_DIR || path.resolve(dirname, 'data')
const ISSUES_TO_LOAD = process.env.ISSUES_TO_LOAD || 112

console.info(`Connecting to Postgres..`)
const db = createPool(DATABASE_URL)

const issues = JSON.parse(
  fs.readFileSync(path.join(DATA_DIR, 'issues.json'), 'utf8')
)

async function makeInsertQuery(db, table, data) {
  const columns = Object.keys(data)
  const columnsNames = columns.map(n => `"${n}"`).join(', ')
  const values = columns.map((column) => data[column])
  return await db.query(sql`
    INSERT INTO ${sql.ident(table)} (${sql(columnsNames)})
    VALUES (${sql.join(values.map(sql.value), ', ')})
  `)
}

async function importIssue(db, _issue) {
  const { comments, ...issue } = _issue
  await makeInsertQuery(db, 'issue', {
    id: issue.id,
    title: issue.title,
    creator: issue.username,
    priority: issue.priority,
    status: issue.status,
    created: (new Date(issue.created)).getTime(),
    modified: (new Date(issue.modified)).getTime(),
    kanbanorder: issue.kanbanorder,
  })
  await makeInsertQuery(db, 'description', {
    id: issue.id,
    body: issue.description,
  })
}

async function importComment(db, comment) {
  await makeInsertQuery(db, 'comment', {
    id: comment.id,
    body: comment.body,
    creator: comment.username,
    issueId: comment.issue_id,
    created: (new Date(comment.created)).getTime(),
  })
}

let commentCount = 0
const issueToLoad = Math.min(ISSUES_TO_LOAD, issues.length)
await db.tx(async (db) => {
  for (let i = 0; i < issueToLoad; i++) {
    process.stdout.write(`Loading issue ${i + 1} of ${issueToLoad}\r`)
    const issue = issues[i]
    await importIssue(db, issue)
    for (const comment of issue.comments) {
      commentCount++
      await importComment(db, comment)
    }
  }
})
process.stdout.write('\n')

db.dispose()
console.info(`Loaded ${issueToLoad} issues with ${commentCount} comments.`)