// @ts-check

import netlify from '@astrojs/netlify'
import react from '@astrojs/react'
import starlight from '@astrojs/starlight'
import { liveStoreVersion } from '@livestore/common'
import { DISCORD_INVITE_URL } from '@local/shared'
import tailwind from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import rehypeMermaid from 'rehype-mermaid'
import remarkCustomHeaderId from 'remark-custom-header-id'
// import starlightAutoSidebar from 'starlight-auto-sidebar'
import starlightLinksValidator from 'starlight-links-validator'
import starlightSidebarTopics from 'starlight-sidebar-topics'
import starlightTypeDoc from 'starlight-typedoc'
import { getBranchName } from './data.js'
import { starlightMixedbread } from './src/plugins/starlight/mixedbread/plugin.ts'
import { vitePluginSnippet } from './src/vite-plugin-snippet.js'

const port = 5252

const branch = getBranchName()

// Netlify preview domain (see https://docs.netlify.com/configure-builds/environment-variables/#build-metadata)
const domain = process.env.DEPLOY_PRIME_URL
  ? new URL(process.env.DEPLOY_PRIME_URL).hostname
  : process.env.NODE_ENV === 'production'
    ? branch === 'main'
      ? 'docs.livestore.dev'
      : 'dev.docs.livestore.dev'
    : `localhost:${port}`

const site = `https://${domain}`

// https://astro.build/config
export default defineConfig({
  site,
  output: 'static',
  server: { port },
  adapter: process.env.NODE_ENV === 'production' ? netlify() : undefined,
  image: {
    domains: ['gitbucket.schickling.dev'],
  },
  integrations: [
    react(),
    starlight({
      title: `LiveStore (${liveStoreVersion})`,
      social: [
        { icon: 'github', label: 'GitHub', href: `https://github.com/livestorejs/livestore/tree/${branch}` },
        { icon: 'discord', label: 'Discord', href: DISCORD_INVITE_URL },
        { icon: 'x.com', label: 'X', href: 'https://x.com/livestoredev' },
        { icon: 'blueSky', label: 'Bluesky', href: 'https://bsky.app/profile/livestore.dev' },
      ],

      components: {
        SocialIcons: './src/components/SocialIcons.astro',
      },
      editLink: {
        baseUrl: `https://github.com/livestorejs/livestore/edit/${getBranchName()}/docs/`,
      },
      routeMiddleware: './src/routeMiddleware.ts',
      plugins: [
        // Used to adjust the order of sidebar items
        // https://starlight-auto-sidebar.netlify.app/guides/using-metadata/
        // TODO re-enable this when fixed https://github.com/HiDeoo/starlight-auto-sidebar/issues/4
        // starlightAutoSidebar(),

        starlightMixedbread({
          apiKey: process.env.MXBAI_API_KEY || '',
          vectorStoreId: process.env.VECTOR_STORE_ID || '',
          maxResults: 8,
        }),

        starlightSidebarTopics([
          {
            label: 'Docs',
            link: '/',
            icon: 'open-book',
            items: [
              'index',
              {
                label: 'Getting Started',
                autogenerate: { directory: 'getting-started' },
              },
              {
                label: 'Evaluating LiveStore',
                autogenerate: { directory: 'evaluation' },
              },
              {
                label: 'Data Modeling',
                autogenerate: { directory: 'data-modeling' },
              },
              // TODO bring back when fixed https://github.com/HiDeoo/starlight-auto-sidebar/issues/4
              // Until when we're manually maintaining the sidebar for reference
              // {
              //   label: 'Reference',
              //   autogenerate: { directory: 'reference' },
              // },
              {
                label: 'Reference',
                items: [
                  'reference/concepts',
                  'reference/store',
                  'reference/reactivity-system',
                  'reference/events',
                  'reference/devtools',
                  'reference/debugging',
                  'reference/opentelemetry',
                  'reference/cli',
                  'reference/mcp',
                  { label: 'State', autogenerate: { directory: 'reference/state' } },
                  {
                    label: 'Syncing',
                    items: [
                      'reference/syncing',
                      'reference/syncing/server-side-clients',
                      { label: 'Sync Provider', autogenerate: { directory: 'reference/syncing/sync-provider' } },
                    ],
                  },
                  { label: 'Platform Adapters', autogenerate: { directory: 'reference/platform-adapters' } },
                  { label: 'Framework Integrations', autogenerate: { directory: 'reference/framework-integrations' } },
                ],
              },
              {
                label: 'Patterns',
                autogenerate: { directory: 'patterns' },
              },
              {
                label: 'Miscellaneous',
                autogenerate: { directory: 'misc' },
              },
              {
                label: 'Changelog',
                link: '/changelog',
              },
              {
                label: 'Contributing',
                autogenerate: { directory: 'contributing' },
              },
            ],
          },
          {
            label: 'API',
            link: '/api/',
            icon: 'forward-slash',

            items: [
              'api', // 'api/index.mdx'
              {
                label: '@livestore/livestore',
                autogenerate: { directory: 'api/livestore' },
                collapsed: true,
              },
              {
                label: '@livestore/react',
                autogenerate: { directory: 'api/react' },
                collapsed: true,
              },
              {
                label: 'Adapters',
                items: [
                  {
                    label: '@livestore/adapter-web',
                    autogenerate: { directory: 'api/adapter-web' },
                    collapsed: true,
                  },
                  {
                    label: '@livestore/adapter-node',
                    autogenerate: { directory: 'api/adapter-node' },
                    collapsed: true,
                  },
                  {
                    label: '@livestore/adapter-expo',
                    autogenerate: { directory: 'api/adapter-expo' },
                    collapsed: true,
                  },
                ],
              },
              {
                label: 'Syncing',
                items: [
                  {
                    label: '@livestore/sync-cf',
                    autogenerate: { directory: 'api/sync-cf' },
                    collapsed: true,
                  },
                  {
                    label: '@livestore/sync-electric',
                    autogenerate: { directory: 'api/sync-electric' },
                    collapsed: true,
                  },
                ],
              },
            ],
          },
          {
            label: 'Examples',
            link: '/examples/',
            icon: 'rocket',
            items: [
              'examples', // 'examples/index.mdx'
              'examples/web-adapter',
              'examples/node-adapter',
              'examples/expo-adapter',
              'examples/cloudflare-adapter',
            ],
          },
        ]),

        // Only runs on `astro build`
        starlightLinksValidator({
          // `exclude` specifies the links to be excluded, not the files that contain the links
          exclude: [
            '/examples', // Custom pages are not yet supported by this plugin https://github.com/HiDeoo/starlight-links-validator/issues/39
            '/api/**',
          ],
          // Currently ignoring relative links as there are some problems with the generated api docs
          // Didn't yet take the time to investigate/fix the root cause https://share.cleanshot.com/88lpCkCl
          errorOnRelativeLinks: false,
        }),
        ...(process.env.STARLIGHT_INCLUDE_API_DOCS
          ? [
              starlightTypeDoc({
                entryPoints: ['../packages/@livestore/livestore/src/mod.ts'],
                tsconfig: '../packages/@livestore/livestore/tsconfig.json',
                output: 'api/livestore',
              }),
              starlightTypeDoc({
                entryPoints: ['../packages/@livestore/react/src/mod.ts'],
                tsconfig: '../packages/@livestore/react/tsconfig.json',
                output: 'api/react',
              }),
              starlightTypeDoc({
                entryPoints: ['../packages/@livestore/adapter-web/src/index.ts'],
                tsconfig: '../packages/@livestore/adapter-web/tsconfig.json',
                output: 'api/adapter-web',
              }),
              starlightTypeDoc({
                entryPoints: ['../packages/@livestore/adapter-node/src/index.ts'],
                tsconfig: '../packages/@livestore/adapter-node/tsconfig.json',
                output: 'api/adapter-node',
              }),
              starlightTypeDoc({
                entryPoints: ['../packages/@livestore/adapter-expo/src/index.ts'],
                tsconfig: '../packages/@livestore/adapter-expo/tsconfig.json',
                output: 'api/adapter-expo',
              }),
              starlightTypeDoc({
                entryPoints: [
                  '../packages/@livestore/sync-cf/src/sync-impl/mod.ts',
                  '../packages/@livestore/sync-cf/src/cf-worker/mod.ts',
                ],
                tsconfig: '../packages/@livestore/sync-cf/tsconfig.json',
                output: 'api/sync-cf',
              }),
              starlightTypeDoc({
                entryPoints: ['../packages/@livestore/sync-electric/src/index.ts'],
                tsconfig: '../packages/@livestore/sync-electric/tsconfig.json',
                output: 'api/sync-electric',
              }),
            ]
          : []),
      ],
      customCss: ['./src/tailwind.css'],
      logo: {
        src: './src/assets/livestore.png',
        alt: 'LiveStore Logo',
        replacesTitle: true,
      },
    }),
  ],
  redirects: {
    '/getting-started': '/getting-started/react-web',
    '/reference/syncing/sync-provider': '/reference/syncing/sync-provider/cloudflare',
  },
  vite: {
    server: {
      fs: {
        // Needed to load the CHANGELOG.md file which is outside this package
        strict: false,
      },
    },
    plugins: [tailwind(), vitePluginSnippet()],
  },
  markdown: {
    syntaxHighlight: {
      type: 'shiki',
      excludeLangs: ['mermaid', 'math'],
    },
    remarkPlugins: [
      // MD: {#custom-id}
      // MDX: \{#custom-id\}
      remarkCustomHeaderId,
    ],
    rehypePlugins: [[rehypeMermaid, { strategy: 'img-svg', dark: true }]],
  },
})
