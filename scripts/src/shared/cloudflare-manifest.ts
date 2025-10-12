import { Schema } from '@livestore/utils/effect'

export const CloudflareDomainSchema = Schema.Struct({
  domain: Schema.String,
  name: Schema.String,
  scope: Schema.Literal('prod', 'dev'),
})

export type CloudflareDomain = typeof CloudflareDomainSchema.Type

export const CloudflareExampleSchema = Schema.Struct({
  slug: Schema.String,
  workerName: Schema.String,
  repoRelativePath: Schema.String,
  buildOutputDir: Schema.String,
  durableObjects: Schema.Array(Schema.String),
  aliases: Schema.Struct({
    prod: Schema.String,
    dev: Schema.String,
  }),
  domains: Schema.Array(CloudflareDomainSchema),
})

export type CloudflareExample = typeof CloudflareExampleSchema.Type

/**
 * Manifest describing how each example maps to Cloudflare Workers and domains.
 * Used by the examples deploy workflow to orchestrate builds, deploys, and DNS updates.
 */
export const cloudflareExamples: readonly CloudflareExample[] = [
  {
    slug: 'cf-chat',
    workerName: 'example-cf-chat',
    repoRelativePath: 'examples/cf-chat',
    buildOutputDir: 'websocket_server',
    durableObjects: ['SyncBackendDO'],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'cf-chat', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.cf-chat', scope: 'dev' },
    ],
  },
  {
    slug: 'web-linearlite',
    workerName: 'example-web-linearlite',
    repoRelativePath: 'examples/web-linearlite',
    buildOutputDir: 'server',
    durableObjects: ['SyncBackendDO'],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'web-linearlite', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.web-linearlite', scope: 'dev' },
    ],
  },
  {
    slug: 'web-todomvc',
    workerName: 'example-web-todomvc',
    repoRelativePath: 'examples/web-todomvc',
    buildOutputDir: 'example_web_todomvc',
    durableObjects: [],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'web-todomvc', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.web-todomvc', scope: 'dev' },
    ],
  },
  {
    slug: 'web-todomvc-custom-elements',
    workerName: 'example-web-todomvc-custom-elements',
    repoRelativePath: 'examples/web-todomvc-custom-elements',
    buildOutputDir: 'server',
    durableObjects: [],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'web-todomvc-custom-elements', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.web-todomvc-custom-elements', scope: 'dev' },
    ],
  },
  {
    slug: 'web-todomvc-experimental',
    workerName: 'example-web-todomvc-experimental',
    repoRelativePath: 'examples/web-todomvc-experimental',
    buildOutputDir: 'server',
    durableObjects: [],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'web-todomvc-experimental', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.web-todomvc-experimental', scope: 'dev' },
    ],
  },
  {
    slug: 'web-todomvc-script',
    workerName: 'example-web-todomvc-script',
    repoRelativePath: 'examples/web-todomvc-script',
    buildOutputDir: 'server',
    durableObjects: [],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'web-todomvc-script', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.web-todomvc-script', scope: 'dev' },
    ],
  },
  {
    slug: 'web-todomvc-solid',
    workerName: 'example-web-todomvc-solid',
    repoRelativePath: 'examples/web-todomvc-solid',
    buildOutputDir: 'server',
    durableObjects: [],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'web-todomvc-solid', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.web-todomvc-solid', scope: 'dev' },
    ],
  },
  {
    slug: 'web-todomvc-sync-cf',
    workerName: 'example-web-todomvc-sync-cf',
    repoRelativePath: 'examples/web-todomvc-sync-cf',
    buildOutputDir: 'websocket_server',
    durableObjects: ['SyncBackendDO'],
    aliases: {
      prod: 'prod',
      dev: 'dev',
    },
    domains: [
      { domain: 'livestore.dev', name: 'web-todomvc-sync-cf', scope: 'prod' },
      { domain: 'livestore.dev', name: 'dev.web-todomvc-sync-cf', scope: 'dev' },
    ],
  },
]

export const cloudflareExamplesBySlug = new Map(cloudflareExamples.map((example) => [example.slug, example]))
