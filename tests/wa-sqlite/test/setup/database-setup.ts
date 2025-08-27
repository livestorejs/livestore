/**
 * Vitest Setup File - Large SQLite Database Generator
 * This runs before all tests to ensure the large test database is available
 */

import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { exec, exportDb, loadSqlite3Wasm } from '../lib/sqlite-utils.ts'

const FIXTURES_DIR = path.join(path.dirname(path.dirname(__filename || import.meta.url)), 'fixtures')

async function ensureDirectoryExists(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

async function generateLargeTestDatabase(): Promise<void> {
  const testDbPath = path.join(FIXTURES_DIR, 'large_test.db')

  // Check if database already exists and is large enough
  if (existsSync(testDbPath)) {
    const stats = statSync(testDbPath)
    const sizeMB = Math.round(stats.size / (1024 * 1024))

    if (sizeMB >= 500) {
      console.log(`✓ Large test database ready (${sizeMB}MB)`)
      return
    } else {
      console.log(`Existing database too small (${sizeMB}MB), regenerating...`)
      unlinkSync(testDbPath)
    }
  }

  console.log('⏳ Generating large test database for wa-sqlite testing...')

  try {
    // Load wa-sqlite WASM
    const sqlite3 = await loadSqlite3Wasm()

    // Create in-memory database
    const db = sqlite3.open_v2Sync(':memory:', 0, undefined)

    // Create schema
    exec(
      sqlite3,
      db,
      `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT UNIQUE,
        email TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        profile_data TEXT
      )
    `,
    )

    exec(
      sqlite3,
      db,
      `
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        title TEXT,
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        view_count INTEGER DEFAULT 0
      )
    `,
    )

    exec(
      sqlite3,
      db,
      `
      CREATE TABLE comments (
        id INTEGER PRIMARY KEY,
        post_id INTEGER REFERENCES posts(id),
        user_id INTEGER REFERENCES users(id),
        content TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
    )

    // Create indexes
    exec(sqlite3, db, 'CREATE INDEX idx_posts_user_id ON posts(user_id)')
    exec(sqlite3, db, 'CREATE INDEX idx_posts_created_at ON posts(created_at)')
    exec(sqlite3, db, 'CREATE INDEX idx_comments_post_id ON comments(post_id)')
    exec(sqlite3, db, 'CREATE INDEX idx_comments_user_id ON comments(user_id)')

    const NUM_USERS = 50_000
    const NUM_POSTS = 200_000
    const NUM_COMMENTS = 800_000

    // Begin transaction for better performance
    exec(sqlite3, db, 'BEGIN TRANSACTION')

    // Insert users using exec with bulk inserts for performance
    const userValues: string[] = []
    for (let i = 1; i <= NUM_USERS; i++) {
      const profileData = `Profile data for user ${i} ${'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. '.repeat(Math.floor(Math.random() * 3) + 2)}`
      userValues.push(`('user${i}', 'user${i}@example.com', '${profileData.replace(/'/g, "''")}')`)

      if (i % 1000 === 0 || i === NUM_USERS) {
        const sql = `INSERT INTO users (username, email, profile_data) VALUES ${userValues.join(', ')}`
        exec(sqlite3, db, sql)
        userValues.length = 0

        if (i % 10_000 === 0) {
          process.stdout.write(`  Users: ${i}/${NUM_USERS}\r`)
        }
      }
    }
    console.log(`  Users: ${NUM_USERS}/${NUM_USERS} ✓`)

    // Insert posts
    const postValues: string[] = []
    for (let i = 1; i <= NUM_POSTS; i++) {
      const userId = Math.floor(Math.random() * NUM_USERS) + 1
      const title = `Post Title ${i} - ${Math.random().toString(36).substring(2, 15)} Advanced Discussion`
      const content = `Post content ${i} - This is a comprehensive discussion about various topics. ${'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. '.repeat(Math.floor(Math.random() * 5) + 3)}`
      const viewCount = Math.floor(Math.random() * 10_000)

      postValues.push(`(${userId}, '${title.replace(/'/g, "''")}', '${content.replace(/'/g, "''")}', ${viewCount})`)

      if (i % 1000 === 0 || i === NUM_POSTS) {
        const sql = `INSERT INTO posts (user_id, title, content, view_count) VALUES ${postValues.join(', ')}`
        exec(sqlite3, db, sql)
        postValues.length = 0

        if (i % 25_000 === 0) {
          process.stdout.write(`  Posts: ${i}/${NUM_POSTS}\r`)
        }
      }
    }
    console.log(`  Posts: ${NUM_POSTS}/${NUM_POSTS} ✓`)

    // Insert comments
    const commentValues: string[] = []
    for (let i = 1; i <= NUM_COMMENTS; i++) {
      const postId = Math.floor(Math.random() * NUM_POSTS) + 1
      const userId = Math.floor(Math.random() * NUM_USERS) + 1
      const content = `Comment content ${i} - ${'This is a thoughtful response to the post. I really appreciate the insights shared here. '.repeat(Math.floor(Math.random() * 3) + 2)}`

      commentValues.push(`(${postId}, ${userId}, '${content.replace(/'/g, "''")}')`)

      if (i % 1000 === 0 || i === NUM_COMMENTS) {
        const sql = `INSERT INTO comments (post_id, user_id, content) VALUES ${commentValues.join(', ')}`
        exec(sqlite3, db, sql)
        commentValues.length = 0

        if (i % 50_000 === 0) {
          process.stdout.write(`  Comments: ${i}/${NUM_COMMENTS}\r`)
        }
      }
    }
    console.log(`  Comments: ${NUM_COMMENTS}/${NUM_COMMENTS} ✓`)

    // Commit transaction
    exec(sqlite3, db, 'COMMIT')

    // Update statistics
    exec(sqlite3, db, 'ANALYZE')

    // Export the database to file
    const exported = exportDb(sqlite3, db)
    writeFileSync(testDbPath, exported)

    // Clean up
    sqlite3.close(db)

    const stats = statSync(testDbPath)
    const sizeMB = Math.round(stats.size / (1024 * 1024))

    console.log(`✓ Generated test database: ${sizeMB}MB`)
  } catch (error) {
    console.error('❌ Failed to generate test database:', error)
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
    throw error
  }
}
// This runs as a Vitest setup file
;(async () => {
  try {
    await ensureDirectoryExists(FIXTURES_DIR)
    await generateLargeTestDatabase()
  } catch (error) {
    console.error('Setup failed:', error)
    process.exit(1)
  }
})()

export default async function setupDatabase() {
  await ensureDirectoryExists(FIXTURES_DIR)
  await generateLargeTestDatabase()
}
