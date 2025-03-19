// @ts-check

import starlight from '@astrojs/starlight'
import { liveStoreVersion } from '@livestore/common'
import tailwind from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import starlightTypeDoc from 'starlight-typedoc'

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: `LiveStore (${liveStoreVersion})`,
      social: {
        github: 'https://github.com/livestorejs/livestore',
        discord: 'https://discord.gg/RbMcjUAPd7',
        'x.com': 'https://x.com/livestoredev',
      },

      components: {
        SocialIcons: './src/components/SocialIcons.astro',
      },
      plugins: process.env.STARLIGHT_INCLUDE_API_DOCS
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
        : [],

      sidebar: [
        // {
        // 	label: 'Guides',
        // 	items: [
        // 		// Each item here is one entry in the navigation menu.
        // 		{ label: 'Example Guide', link: '/guides/example/' },
        // 	],
        // },
        {
          label: 'Getting Started',
          autogenerate: { directory: 'docs/getting-started' },
        },
        {
          label: 'Evaluating LiveStore',
          autogenerate: { directory: 'docs/evaluation' },
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'docs/reference' },
        },
        {
          label: 'Patterns',
          autogenerate: { directory: 'docs/patterns' },
        },
        {
          label: 'Miscellaneous',
          autogenerate: { directory: 'docs/misc' },
        },
        {
          label: 'Changelog',
          link: '/changelog',
        },
        {
          label: 'API Reference (generated)',
          autogenerate: { directory: 'docs/api' },
          collapsed: true,
        },
      ],
      customCss: ['./src/tailwind.css'],
      logo: {
        src: './src/assets/livestore.png',
        alt: 'LiveStore Logo',
        replacesTitle: true,
      },
    }),
  ],
  vite: {
    server: {
      fs: {
        // Needed to load the CHANGELOG.md file which is outside this package
        strict: false,
      },
    },
    plugins: [tailwind()],
  },
})
