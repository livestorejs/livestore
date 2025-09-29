import { Effect } from '@livestore/utils/effect'
import { blogSchemaContent } from '../mcp-content/schemas/blog.ts'
import { ecommerceSchemaContent } from '../mcp-content/schemas/ecommerce.ts'
import { socialSchemaContent } from '../mcp-content/schemas/social.ts'
import { todoSchemaContent } from '../mcp-content/schemas/todo.ts'
import * as Runtime from '../mcp-runtime/runtime.ts'
import { coachToolHandler } from './mcp-coach.ts'
import { livestoreToolkit } from './mcp-tools-defs.ts'

// Tool handlers using Tim Smart's pattern
export const toolHandlers: any = livestoreToolkit.of({
  livestore_coach: coachToolHandler,

  livestore_generate_schema: Effect.fnUntraced(function* ({ schemaType, customDescription }) {
    let schemaCode: string
    let explanation: string

    switch (schemaType.toLowerCase()) {
      case 'todo':
        schemaCode = todoSchemaContent
        explanation = 'Todo application schema with tasks, tags, and many-to-many relationships'
        break
      case 'blog':
        schemaCode = blogSchemaContent
        explanation = 'Blog platform schema with posts, comments, and publishing workflow'
        break
      case 'social':
        schemaCode = socialSchemaContent
        explanation = 'Social media schema with users, posts, follows, and likes'
        break
      case 'ecommerce':
        schemaCode = ecommerceSchemaContent
        explanation = 'E-commerce schema with products, categories, orders, and inventory'
        break
      case 'custom': {
        if (!customDescription) {
          schemaCode = `// Custom schema requested but no description provided
import { Schema } from '@livestore/livestore'

// Please provide a description of your data model needs
export const CustomSchema = Schema.table('items', {
  id: Schema.id,
  name: Schema.text,
  createdAt: Schema.datetime.default('now')
})

export const schema = Schema.create({
  items: CustomSchema
})`
          explanation = 'Basic custom schema template - please provide more details about your requirements'
          break
        }

        // Generate a basic custom schema based on description
        const tableName = customDescription.toLowerCase().includes('user')
          ? 'users'
          : customDescription.toLowerCase().includes('product')
            ? 'products'
            : customDescription.toLowerCase().includes('post')
              ? 'posts'
              : 'items'

        schemaCode = `// Custom schema based on: ${customDescription}
import { Schema } from '@livestore/livestore'

export const ${tableName.charAt(0).toUpperCase() + tableName.slice(0, -1)}Schema = Schema.table('${tableName}', {
  id: Schema.id,
  name: Schema.text,
  description: Schema.text.optional(),
  createdAt: Schema.datetime.default('now'),
  updatedAt: Schema.datetime.default('now')
})

export const schema = Schema.create({
  ${tableName}: ${tableName.charAt(0).toUpperCase() + tableName.slice(0, -1)}Schema
})`

        explanation = `Custom schema generated for: ${customDescription}. This is a basic template - you may need to customize the fields based on your specific requirements.`
        break
      }
      default:
        schemaCode = todoSchemaContent
        explanation =
          'Unknown schema type, returning todo example. Available types: todo, blog, social, ecommerce, custom'
    }

    return { schemaCode, explanation }
  }),

  livestore_get_example_schema: Effect.fnUntraced(function* ({ type }) {
    let schemaCode: string
    let description: string

    switch (type.toLowerCase()) {
      case 'todo':
        schemaCode = todoSchemaContent
        description =
          'Complete todo application with tasks, tags, and many-to-many relationships. Includes boolean completion status and timestamps.'
        break
      case 'blog':
        schemaCode = blogSchemaContent
        description =
          'Blog platform with posts and comments. Features published status, unique slugs, and author attribution.'
        break
      case 'social':
        schemaCode = socialSchemaContent
        description =
          'Social media platform with users, posts, follows, and likes. Includes user profiles and social interactions.'
        break
      case 'ecommerce':
        schemaCode = ecommerceSchemaContent
        description =
          'E-commerce platform with products, categories, orders, and inventory management. Features order items and status tracking.'
        break
      default:
        schemaCode = todoSchemaContent
        description = 'Default todo example (unknown type requested). Available types: todo, blog, social, ecommerce'
    }

    return { schemaCode, description }
  }),

  // Connect the single in-process LiveStore instance from user module
  livestore_instance_connect: Effect.fnUntraced(function* ({ storePath, storeId, clientId, sessionId }) {
    const store = yield* Runtime.init({ storePath, storeId, clientId, sessionId }).pipe(Effect.orDie)
    const eventNames = Array.from(store.schema.eventsDefsMap.keys())
    const tableNames = Array.from(store.schema.state.sqlite.tables.keys())

    return {
      storeId: store.storeId,
      clientId: store.clientId,
      sessionId: store.sessionId,
      schemaInfo: {
        tableNames,
        eventNames,
      },
    }
  }),

  // Execute a raw SQL query against the local client DB
  livestore_instance_query: Effect.fnUntraced(function* ({ sql, bindValues }) {
    return yield* Runtime.query({ sql, bindValues })
  }),

  // Validate and commit events
  livestore_instance_commit_events: Effect.fnUntraced(function* ({ events }) {
    return yield* Runtime.commit({ events })
  }),

  // Status
  livestore_instance_status: Effect.fnUntraced(function* () {
    return yield* Runtime.status
  }),

  // Disconnect
  livestore_instance_disconnect: Effect.fnUntraced(function* () {
    return yield* Runtime.disconnect
  }),
})
