import { AiTool, AiToolkit, Effect, Schema } from '@livestore/utils/effect'
import { blogSchemaContent } from '../mcp-content/schemas/blog.ts'
import { ecommerceSchemaContent } from '../mcp-content/schemas/ecommerce.ts'
import { socialSchemaContent } from '../mcp-content/schemas/social.ts'
import { todoSchemaContent } from '../mcp-content/schemas/todo.ts'
import { coachTool, coachToolHandler } from './mcp-coach.ts'

// Create toolkit with tools and handlers following Tim Smart's pattern
export const livestoreToolkit = AiToolkit.make(
  coachTool,

  AiTool.make('livestore_generate_schema', {
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
      schemaCode: Schema.String.annotations({
        description: 'The generated LiveStore schema TypeScript code',
      }),
      explanation: Schema.String.annotations({
        description: 'Brief explanation of the schema structure',
      }),
    }),
  }),

  AiTool.make('livestore_get_example_schema', {
    description:
      'Get a complete example LiveStore schema with TypeScript code. Returns ready-to-use schema definitions for common application types.',
    parameters: {
      type: Schema.String.annotations({
        description: "Example type: 'todo', 'blog', 'social', or 'ecommerce'",
      }),
    },
    success: Schema.Struct({
      schemaCode: Schema.String.annotations({
        description: 'The complete LiveStore schema code',
      }),
      description: Schema.String.annotations({
        description: 'Description of what this schema models',
      }),
    }),
  })
    .annotate(AiTool.Readonly, true)
    .annotate(AiTool.Destructive, false),
)

// Tool handlers using Tim Smart's pattern
export const toolHandlers = livestoreToolkit.of({
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
})
