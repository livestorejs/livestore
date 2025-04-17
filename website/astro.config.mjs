// @ts-check

import starlight from '@astrojs/starlight'
import { liveStoreVersion } from '@livestore/common'
import tailwind from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import remarkCustomHeaderId from 'remark-custom-header-id'
import starlightLinksValidator from 'starlight-links-validator'
import starlightTypeDoc from 'starlight-typedoc'

import { DISCORD_INVITE_URL } from '../CONSTANTS.js'

// Netlify preview domain (see https://docs.netlify.com/configure-builds/environment-variables/#build-metadata)
const domain = process.env.DEPLOY_PRIME_URL ? new URL(process.env.DEPLOY_PRIME_URL).hostname : 'livestore.dev'

const site = `https://${domain}`

// https://astro.build/config
export default defineConfig({
  site,
  integrations: [
    starlight({
      title: `LiveStore (${liveStoreVersion})`,
      social: {
        github: 'https://github.com/livestorejs/livestore',
        discord: DISCORD_INVITE_URL,
        'x.com': 'https://x.com/livestoredev',
      },

      components: {
        SocialIcons: './src/components/SocialIcons.astro',
      },
      plugins: [
        starlightLinksValidator({
          // `exclude` specifies the links to be excluded, not the files that contain the links
          exclude: [
            '/examples', // Custom pages are not yet supported by this plugin https://github.com/HiDeoo/starlight-links-validator/issues/39
            '/docs/api/**',
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
                output: 'docs/api/livestore',
              }),
              starlightTypeDoc({
                entryPoints: ['../packages/@livestore/react/src/mod.ts'],
                tsconfig: '../packages/@livestore/react/tsconfig.json',
                output: 'docs/api/react',
              }),
              starlightTypeDoc({
                entryPoints: ['../packages/@livestore/adapter-web/src/index.ts'],
                tsconfig: '../packages/@livestore/adapter-web/tsconfig.json',
                output: 'docs/api/adapter-web',
              }),
              starlightTypeDoc({
                entryPoints: ['../packages/@livestore/adapter-node/src/index.ts'],
                tsconfig: '../packages/@livestore/adapter-node/tsconfig.json',
                output: 'docs/api/adapter-node',
              }),
              starlightTypeDoc({
                entryPoints: ['../packages/@livestore/adapter-expo/src/index.ts'],
                tsconfig: '../packages/@livestore/adapter-expo/tsconfig.json',
                output: 'docs/api/adapter-expo',
              }),
              starlightTypeDoc({
                entryPoints: [
                  '../packages/@livestore/sync-cf/src/sync-impl/mod.ts',
                  '../packages/@livestore/sync-cf/src/cf-worker/mod.ts',
                ],
                tsconfig: '../packages/@livestore/sync-cf/tsconfig.json',
                output: 'docs/api/sync-cf',
              }),
              starlightTypeDoc({
                entryPoints: ['../packages/@livestore/sync-electric/src/index.ts'],
                tsconfig: '../packages/@livestore/sync-electric/tsconfig.json',
                output: 'docs/api/sync-electric',
              }),
            ]
          : []),
      ],

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
        {
          label: 'Contributing',
          autogenerate: { directory: 'docs/contributing' },
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
  markdown: {
    remarkPlugins: [remarkCustomHeaderId],
  },
})
