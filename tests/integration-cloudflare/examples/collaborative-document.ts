// @ts-nocheck
/**
 * Real-time Collaborative Document Client-DO Example
 *
 * This example demonstrates how a client-do can power a collaborative document editor
 * with real-time synchronization, conflict resolution, and persistent document state.
 * Multiple users can edit simultaneously with operational transform-style conflict resolution.
 */

import { makeClientDurableObject } from '@livestore/adapter-cloudflare'
import { Schema } from '@livestore/livestore'

// Schema for collaborative document state
const collaborativeDocSchema = Schema.struct({
  document: Schema.struct({
    id: Schema.string,
    title: Schema.string,
    content: Schema.string, // The document content
    version: Schema.number, // Document version for conflict resolution
    lastModified: Schema.string,
    owner: Schema.string,
    permissions: Schema.struct({
      public: Schema.boolean,
      allowedUsers: Schema.array(Schema.string),
      readOnly: Schema.boolean,
    }),
  }),
  operations: Schema.array(
    Schema.struct({
      id: Schema.string,
      userId: Schema.string,
      timestamp: Schema.string,
      version: Schema.number,
      type: Schema.literal('insert', 'delete', 'replace'),
      position: Schema.number,
      content: Schema.optional(Schema.string),
      length: Schema.optional(Schema.number), // For delete operations
    }),
  ),
  cursors: Schema.record(
    Schema.string, // userId
    Schema.struct({
      userId: Schema.string,
      position: Schema.number,
      selection: Schema.optional(
        Schema.struct({
          start: Schema.number,
          end: Schema.number,
        }),
      ),
      lastSeen: Schema.string,
      username: Schema.string,
      color: Schema.string, // Cursor color for visual distinction
    }),
  ),
  collaborators: Schema.record(
    Schema.string, // userId
    Schema.struct({
      userId: Schema.string,
      username: Schema.string,
      status: Schema.literal('online', 'idle', 'offline'),
      lastActivity: Schema.string,
      editCount: Schema.number,
    }),
  ),
})

type CollaborativeDocSchema = typeof collaborativeDocSchema

// Create the Collaborative Document Client-DO class
export class CollaborativeDocClientDO extends makeClientDurableObject({
  schema: collaborativeDocSchema,
  clientId: 'collab-doc',
  sessionId: 'doc-session',

  // Initialize document state and register real-time queries
  registerQueries: async (store) => {
    const subscriptions = []

    // Broadcast operations to all connected clients
    subscriptions.push(
      store.query.operations.subscribe((operations) => {
        const latestOp = operations[operations.length - 1]
        if (latestOp) {
          broadcastOperation(latestOp)
        }
      }),
    )

    // Track cursor movements and selections
    subscriptions.push(
      store.query.cursors.subscribe((cursors) => {
        broadcastCursorUpdates(cursors)
      }),
    )

    // Monitor collaborator status changes
    subscriptions.push(
      store.query.collaborators.subscribe((collaborators) => {
        updateCollaboratorPresence(collaborators)
      }),
    )

    // Auto-save document periodically
    setInterval(async () => {
      await performAutoSave(store)
    }, 30000) // Auto-save every 30 seconds

    return subscriptions
  },

  // Handle collaborative document endpoints
  handleCustomRequest: async (request, ensureStore) => {
    const url = new URL(request.url)
    const store = await ensureStore.pipe(Effect.runPromise)

    switch (url.pathname) {
      case '/document':
        if (request.method === 'GET') {
          return getDocument(store)
        } else if (request.method === 'POST') {
          return await createDocument(store, request)
        }
        break

      case '/operation':
        if (request.method === 'POST') {
          return await applyOperation(store, request)
        }
        break

      case '/cursor':
        if (request.method === 'POST') {
          return await updateCursor(store, request)
        }
        break

      case '/collaborators':
        if (request.method === 'GET') {
          return getCollaborators(store)
        } else if (request.method === 'POST') {
          return await joinDocument(store, request)
        }
        break

      case '/permissions':
        if (request.method === 'POST') {
          return await updatePermissions(store, request)
        }
        break

      case '/history':
        return getDocumentHistory(store)

      case '/export':
        return await exportDocument(store, url.searchParams.get('format') || 'json')
    }

    return null
  },
}) {}

// Real-time operation broadcasting (would use WebSockets in practice)
function broadcastOperation(operation: any) {
  console.log(`Broadcasting operation: ${operation.type} at position ${operation.position}`)
  // In a real implementation, this would broadcast to all connected WebSocket clients
}

function broadcastCursorUpdates(cursors: Record<string, any>) {
  console.log(`Broadcasting cursor updates for ${Object.keys(cursors).length} users`)
  // Broadcast cursor positions to all clients for real-time collaboration
}

function updateCollaboratorPresence(collaborators: Record<string, any>) {
  const onlineCount = Object.values(collaborators).filter((c: any) => c.status === 'online').length
  console.log(`${onlineCount} collaborators currently online`)
}

// Document operations with conflict resolution
async function applyOperation(store: any, request: Request): Promise<Response> {
  const { userId, type, position, content, length, expectedVersion } = await request.json()

  const currentDoc = store.query.document.get()

  // Check for version conflicts
  if (expectedVersion !== currentDoc.version) {
    return Response.json(
      {
        error: 'Version conflict',
        currentVersion: currentDoc.version,
        expectedVersion,
      },
      { status: 409 },
    )
  }

  // Create operation record
  const operation = {
    id: crypto.randomUUID(),
    userId,
    timestamp: new Date().toISOString(),
    version: currentDoc.version + 1,
    type,
    position,
    content,
    length,
  }

  // Apply operation to document content
  let newContent = currentDoc.content
  switch (type) {
    case 'insert':
      newContent = newContent.slice(0, position) + content + newContent.slice(position)
      break
    case 'delete':
      newContent = newContent.slice(0, position) + newContent.slice(position + length!)
      break
    case 'replace':
      newContent = newContent.slice(0, position) + content + newContent.slice(position + length!)
      break
  }

  // Transform existing cursors based on the operation
  const cursors = store.query.cursors.get()
  for (const [cursorUserId, cursor] of Object.entries(cursors)) {
    if (cursorUserId !== userId) {
      const transformedPosition = transformCursorPosition(cursor.position, operation)
      await store.mutate.cursors[cursorUserId].position.set(transformedPosition)
    }
  }

  // Update document
  await store.mutate.document.content.set(newContent)
  await store.mutate.document.version.set(operation.version)
  await store.mutate.document.lastModified.set(operation.timestamp)

  // Add operation to history
  await store.mutate.operations.push(operation)

  // Update collaborator activity
  if (store.query.collaborators[userId]) {
    await store.mutate.collaborators[userId].lastActivity.set(operation.timestamp)
    await store.mutate.collaborators[userId].editCount.increment()
  }

  return Response.json({ success: true, operation, newVersion: operation.version })
}

// Transform cursor position based on operations (operational transform)
function transformCursorPosition(cursorPos: number, operation: any): number {
  switch (operation.type) {
    case 'insert':
      return cursorPos > operation.position ? cursorPos + operation.content.length : cursorPos
    case 'delete':
      if (cursorPos > operation.position + operation.length) {
        return cursorPos - operation.length
      } else if (cursorPos > operation.position) {
        return operation.position
      }
      return cursorPos
    case 'replace':
      if (cursorPos > operation.position + operation.length) {
        return cursorPos - operation.length + operation.content.length
      } else if (cursorPos > operation.position) {
        return operation.position + operation.content.length
      }
      return cursorPos
    default:
      return cursorPos
  }
}

async function updateCursor(store: any, request: Request): Promise<Response> {
  const { userId, position, selection, username, color } = await request.json()

  await store.mutate.cursors[userId].set({
    userId,
    position,
    selection,
    lastSeen: new Date().toISOString(),
    username,
    color,
  })

  return Response.json({ success: true })
}

async function joinDocument(store: any, request: Request): Promise<Response> {
  const { userId, username } = await request.json()

  await store.mutate.collaborators[userId].set({
    userId,
    username,
    status: 'online',
    lastActivity: new Date().toISOString(),
    editCount: 0,
  })

  // Initialize cursor for new user
  await store.mutate.cursors[userId].set({
    userId,
    position: 0,
    lastSeen: new Date().toISOString(),
    username,
    color: generateUserColor(userId),
  })

  return Response.json({ success: true, document: store.query.document.get() })
}

function getDocument(store: any): Response {
  const document = store.query.document.get()
  const collaborators = store.query.collaborators.get()
  const cursors = store.query.cursors.get()

  return Response.json({
    document,
    collaborators,
    cursors,
    onlineCount: Object.values(collaborators).filter((c: any) => c.status === 'online').length,
  })
}

async function createDocument(store: any, request: Request): Promise<Response> {
  const { title, content = '', owner, permissions } = await request.json()

  const document = {
    id: crypto.randomUUID(),
    title,
    content,
    version: 1,
    lastModified: new Date().toISOString(),
    owner,
    permissions: {
      public: false,
      allowedUsers: [owner],
      readOnly: false,
      ...permissions,
    },
  }

  await store.mutate.document.set(document)

  return Response.json({ success: true, document })
}

function getCollaborators(store: any): Response {
  const collaborators = store.query.collaborators.get()
  const cursors = store.query.cursors.get()

  return Response.json({
    collaborators,
    cursors,
    stats: {
      total: Object.keys(collaborators).length,
      online: Object.values(collaborators).filter((c: any) => c.status === 'online').length,
      totalEdits: Object.values(collaborators).reduce((sum: number, c: any) => sum + c.editCount, 0),
    },
  })
}

function getDocumentHistory(store: any): Response {
  const operations = store.query.operations.get()
  const document = store.query.document.get()

  return Response.json({
    currentVersion: document.version,
    operations: operations.slice(-50), // Last 50 operations
    totalOperations: operations.length,
  })
}

async function exportDocument(store: any, format: string): Promise<Response> {
  const document = store.query.document.get()
  const operations = store.query.operations.get()

  switch (format) {
    case 'text':
      return new Response(document.content, {
        headers: { 'Content-Type': 'text/plain' },
      })
    case 'markdown':
      return new Response(`# ${document.title}\n\n${document.content}`, {
        headers: { 'Content-Type': 'text/markdown' },
      })
    default:
      return Response.json({
        document,
        metadata: {
          operationCount: operations.length,
          exportedAt: new Date().toISOString(),
        },
      })
  }
}

async function updatePermissions(store: any, request: Request): Promise<Response> {
  const { permissions } = await request.json()

  await store.mutate.document.permissions.set(permissions)

  return Response.json({ success: true })
}

async function performAutoSave(store: any) {
  const document = store.query.document.get()
  console.log(`Auto-saving document "${document.title}" (version ${document.version})`)
  // In practice, this might save to external storage or create snapshots
}

function generateUserColor(userId: string): string {
  const colors = [
    '#ff6b6b',
    '#4ecdc4',
    '#45b7d1',
    '#96ceb4',
    '#ffeaa7',
    '#dda0dd',
    '#ff7675',
    '#74b9ff',
    '#55a3ff',
    '#fd79a8',
  ]
  const index = userId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length
  return colors[index]
}

/**
 * Usage Example:
 *
 * 1. Create a new document:
 *    POST /document
 *    { "title": "Meeting Notes", "owner": "user-123" }
 *
 * 2. Join as collaborator:
 *    POST /collaborators
 *    { "userId": "user-456", "username": "Alice" }
 *
 * 3. Apply text operation:
 *    POST /operation
 *    {
 *      "userId": "user-456",
 *      "type": "insert",
 *      "position": 10,
 *      "content": "Hello world",
 *      "expectedVersion": 1
 *    }
 *
 * 4. Update cursor position:
 *    POST /cursor
 *    { "userId": "user-456", "position": 21, "username": "Alice" }
 *
 * 5. Get document state:
 *    GET /document
 *
 * 6. Export document:
 *    GET /export?format=markdown
 *
 * The client-do handles real-time collaboration with conflict resolution,
 * cursor synchronization, and persistent document state across all users.
 */
