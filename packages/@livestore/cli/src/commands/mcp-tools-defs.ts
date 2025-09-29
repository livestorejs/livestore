import { Schema, Tool, Toolkit } from '@livestore/utils/effect'
import { coachTool } from './mcp-coach.ts'

export const livestoreToolkit = Toolkit.make(
  coachTool,

  Tool.make('livestore_generate_schema', {
    description:
      'Generate a LiveStore schema for a specific use case. Choose from predefined types (todo, blog, social, ecommerce) or request a custom schema by providing a description.',
    parameters: {
      schemaType: Schema.String.annotations({
        description: "Schema type: 'todo', 'blog', 'social', 'ecommerce', or 'custom'",
      }),
      customDescription: Schema.optional(
        Schema.String.annotations({
          description:
            "For custom schemas: describe your data model needs (e.g., 'user management system with roles and permissions')",
        }),
      ),
    },
    success: Schema.Struct({
      schemaCode: Schema.String.annotations({ description: 'The generated LiveStore schema TypeScript code' }),
      explanation: Schema.String.annotations({ description: 'Brief explanation of the schema structure' }),
    }),
  }),

  Tool.make('livestore_get_example_schema', {
    description:
      'Get a complete example LiveStore schema with TypeScript code. Returns ready-to-use schema definitions for common application types.',
    parameters: {
      type: Schema.String.annotations({ description: "Example type: 'todo', 'blog', 'social', or 'ecommerce'" }),
    },
    success: Schema.Struct({
      schemaCode: Schema.String.annotations({ description: 'The complete LiveStore schema code' }),
      description: Schema.String.annotations({ description: 'Description of what this schema models' }),
    }),
  })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),

  Tool.make('livestore_instance_connect', {
    description: `Connect a LiveStore instance (one active per MCP session) by dynamically importing a user module that exports a LiveStore \`schema\` and a \`syncBackend\` factory (and optionally \`syncPayload\`).
Notes:
- Only one instance can be active at a time; calling connect again shuts down and replaces the previous instance.
- Reconnecting creates a fresh, in-memory client database. The state visible to queries is populated by your backend's initial sync behavior; depending on configuration, you may briefly observe empty or partial data until sync completes.
- \`storePath\` is resolved relative to the current working directory.
- \`syncBackend\` must be a function (factory) that returns a backend; \`syncPayload\` must be JSON-serializable.

Module contract (generic example):
\`\`\`ts
// Choose any supported sync provider for your deployment
import { makeWsSync } from '@livestore/sync-cf/client' // or your own provider

// Export your app's schema
export { schema } from './src/livestore/schema.ts'

// Provide a sync backend (e.g., WebSocket). Configure via env in practice.
export const syncBackend = makeWsSync({ url: process.env.LIVESTORE_SYNC_URL ?? 'ws://localhost:8787' })

// Optionally, pass an auth payload for your backend (must be JSON-serializable)
export const syncPayload = { authToken: process.env.LIVESTORE_SYNC_AUTH_TOKEN ?? 'insecure-token-change-me' }
\`\`\`

Connect parameters:
{
  "storePath": "<path-to-your-mcp-module>.ts",
  "storeId": "<store-id>"
}

Optional identifiers to group client state on the server:
{
  "storePath": "<path-to-your-mcp-module>.ts",
  "storeId": "<store-id>",
  "clientId": "<client-id>",
  "sessionId": "<session-id>"
}

Returns on success:
{
  "storeId": "<store-id>",
  "clientId": "<client-id>",
  "sessionId": "<session-id>",
  "schemaInfo": {
    "tableNames": ["<table-1>", "<table-2>", "..."],
    "eventNames": ["<event-name-1>", "<event-name-2>", "..."]
  }
}`,
    parameters: {
      storePath: Schema.String.annotations({
        description: 'Path to a module that exports named variables: schema and syncBackend',
      }),
      storeId: Schema.String.annotations({ description: 'Required store id for the LiveStore instance.' }),
      clientId: Schema.optional(
        Schema.String.annotations({ description: 'Optional client id for the LiveStore instance.' }),
      ),
      sessionId: Schema.optional(
        Schema.String.annotations({ description: 'Optional session id for the LiveStore instance.' }),
      ),
    },
    success: Schema.Struct({
      storeId: Schema.String,
      clientId: Schema.String,
      sessionId: Schema.String,
      schemaInfo: Schema.Struct({
        tableNames: Schema.Array(Schema.String).annotations({
          description: 'Non-system table names in the connected schema',
        }),
        eventNames: Schema.Array(Schema.String).annotations({
          description: 'Canonical event names defined by the connected schema',
        }),
      }),
    }),
  }),

  Tool.make('livestore_instance_query', {
    description: `Execute a raw SQL query against the connected client's local database (read-only).
Notes:
- The client store runs SQLite under the hood; use valid SQLite syntax.
- Inspect your exported \`schema\` to learn table/column names.
- \`bindValues\` must be an array (positional "?") or a record (named "$key"); do not pass a stringified JSON value.

Examples (positional binds):
{
  "sql": "SELECT * FROM my_table WHERE userId = ? LIMIT 5",
  "bindValues": ["u1"]
}

Examples (named binds):
{
  "sql": "SELECT * FROM my_table WHERE userId = $userId LIMIT 5",
  "bindValues": { "userId": "u1" }
}

Returns on success:
{
  "rows": [{ "col": "value" }],
  "rowCount": 1
}`,
    parameters: {
      sql: Schema.String.annotations({ description: 'The SQL query to execute' }),
      bindValues: Schema.Union(
        Schema.Array(Schema.JsonValue),
        Schema.Record({ key: Schema.String, value: Schema.JsonValue }),
      ).annotations({
        description: 'Bind values for the SQL query (array or record). Record keys must not start with $.',
      }),
    },
    success: Schema.Struct({
      rows: Schema.Array(Schema.Record({ key: Schema.String, value: Schema.JsonValue })),
      rowCount: Schema.Number,
    }),
  }).annotate(Tool.Destructive, false),

  Tool.make('livestore_instance_commit_events', {
    description: `Commit one or more events defined by your connected LiveStore schema.
Notes:
- The \`name\` must match the event's canonical name declared in your schema (e.g., "v1.UserRegistered").
- \`args\` must be a JSON object matching the event schema; do not pass a stringified JSON.
- Use your app's own event names and fields; the example below is generic.
 - Date fields typically accept ISO 8601 strings (e.g., "2024-01-01T00:00:00.000Z").

Example parameters:
{
  "events": [
    {
      "name": "v1.EntityCreated",
      "args": {
        "id": "e1",
        "title": "Hello World",
        "createdAt": "2024-01-01T00:00:00.000Z"
      }
    }
  ]
}

Returns on success:
{ "committed": 1 }`,
    parameters: {
      events: Schema.Array(
        Schema.Struct({
          name: Schema.String.annotations({ description: 'The name of the event' }),
          args: Schema.JsonValue.annotations({
            description: 'The arguments for the event as a non-stringified JSON value',
          }),
        }),
      ),
    },
    success: Schema.Struct({ committed: Schema.Number }),
  }).annotate(Tool.Destructive, true),

  Tool.make('livestore_instance_status', {
    description: `Report the LiveStore runtime status for the current MCP session.

Returns when connected:
{
  "_tag": "connected",
  "storeId": "<store-id>",
  "clientId": "<client-id>",
  "sessionId": "<session-id>",
  "tableCounts": { "<table>": 123 }
}

Returns when not connected:
{
  "_tag": "disconnected"
}`,
    parameters: {},
    success: Schema.Union(
      Schema.TaggedStruct('connected', {
        storeId: Schema.String,
        clientId: Schema.String,
        sessionId: Schema.String,
        tableCounts: Schema.Record({ key: Schema.String, value: Schema.Number }).annotations({
          description: 'Tables in the LiveStore instance with their row count',
        }),
      }),
      Schema.TaggedStruct('disconnected', {}),
    ),
  }).annotate(Tool.Readonly, true),

  Tool.make('livestore_instance_disconnect', {
    description: `Disconnect the current LiveStore instance and release resources.

Example success:
{ "_tag": "disconnected" }`,
    parameters: {},
    success: Schema.TaggedStruct('disconnected', {}),
  }),
)
