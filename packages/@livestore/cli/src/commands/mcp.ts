import { Effect, Layer, Logger, McpServer } from '@livestore/utils/effect'
import { Cli, PlatformNode } from '@livestore/utils/node'
import { architectureContent } from '../mcp-content/architecture.ts'
import { featuresContent } from '../mcp-content/features.ts'
import { gettingStartedContent } from '../mcp-content/getting-started.ts'
// Content imports
import { overviewContent } from '../mcp-content/overview.ts'
import { blogSchemaContent } from '../mcp-content/schemas/blog.ts'
import { ecommerceSchemaContent } from '../mcp-content/schemas/ecommerce.ts'
import { socialSchemaContent } from '../mcp-content/schemas/social.ts'
import { todoSchemaContent } from '../mcp-content/schemas/todo.ts'

// Tools imports
import { livestoreToolkit, toolHandlers } from './mcp-tools.ts'

const LivestoreResources = Layer.mergeAll(
  McpServer.resource({
    uri: 'livestore://overview',
    name: 'LiveStore Overview',
    description: 'Overview of LiveStore - the local-first data platform',
    content: Effect.succeed(overviewContent),
  }),

  McpServer.resource({
    uri: 'livestore://features',
    name: 'LiveStore Features',
    description: 'Core features and capabilities of LiveStore',
    content: Effect.succeed(featuresContent),
  }),

  McpServer.resource({
    uri: 'livestore://getting-started',
    name: 'Getting Started with LiveStore',
    description: 'Quick start guide for LiveStore development',
    content: Effect.succeed(gettingStartedContent),
  }),

  McpServer.resource({
    uri: 'livestore://architecture',
    name: 'LiveStore Architecture',
    description: 'Technical architecture and design principles of LiveStore',
    content: Effect.succeed(architectureContent),
  }),

  McpServer.resource({
    uri: 'livestore://schemas/todo',
    name: 'Todo App Schema',
    description: 'Complete LiveStore schema for a todo application with tags',
    content: Effect.succeed(todoSchemaContent),
  }),

  McpServer.resource({
    uri: 'livestore://schemas/blog',
    name: 'Blog Platform Schema',
    description: 'LiveStore schema for a blog platform with posts and comments',
    content: Effect.succeed(blogSchemaContent),
  }),

  McpServer.resource({
    uri: 'livestore://schemas/social',
    name: 'Social Media Schema',
    description: 'LiveStore schema for a social media platform with users, posts, and interactions',
    content: Effect.succeed(socialSchemaContent),
  }),

  McpServer.resource({
    uri: 'livestore://schemas/ecommerce',
    name: 'E-commerce Schema',
    description: 'LiveStore schema for an e-commerce platform with products, orders, and categories',
    content: Effect.succeed(ecommerceSchemaContent),
  }),
)

const LivestoreTools = McpServer.toolkit(livestoreToolkit).pipe(Layer.provide(livestoreToolkit.toLayer(toolHandlers)))

const mcpServerCommand = Cli.Command.make(
  'server',
  {},
  Effect.fn(function* () {
    yield* Effect.log('🚀 Starting LiveStore MCP Server...')

    // Following Tim Smart's exact pattern from main.ts
    return yield* McpServer.layerStdio({
      name: 'livestore-mcp',
      version: '0.1.0',
      stdin: PlatformNode.NodeStream.stdin,
      stdout: PlatformNode.NodeSink.stdout,
    }).pipe(
      Layer.provide(LivestoreResources),
      Layer.provide(LivestoreTools),
      Layer.provide(Logger.add(Logger.prettyLogger({ stderr: true }))),
      Layer.launch,
    )
  }),
)

export const mcpCommand = Cli.Command.make('mcp').pipe(Cli.Command.withSubcommands([mcpServerCommand]))
