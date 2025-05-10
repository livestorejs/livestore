// @ts-check

import netlify from '@astrojs/netlify'
import react from '@astrojs/react'
import starlight from '@astrojs/starlight'
import clerk from '@clerk/astro'
import { liveStoreVersion } from '@livestore/common'
import tailwind from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'
import remarkCustomHeaderId from 'remark-custom-header-id'
import starlightAutoSidebar from 'starlight-auto-sidebar'
import starlightLinksValidator from 'starlight-links-validator'
import starlightTypeDoc from 'starlight-typedoc'

import { DISCORD_INVITE_URL } from '../CONSTANTS.js'

if (!process.env.PUBLIC_CLERK_PUBLISHABLE_KEY) {
  console.warn('PUBLIC_CLERK_PUBLISHABLE_KEY is not set')
}

// Netlify preview domain (see https://docs.netlify.com/configure-builds/environment-variables/#build-metadata)
const domain = process.env.DEPLOY_PRIME_URL ? new URL(process.env.DEPLOY_PRIME_URL).hostname : 'livestore.dev'

const site = `https://${domain}`

// https://astro.build/config
export default defineConfig({
  site,
  output: 'static',
  adapter: process.env.NODE_ENV === 'production' ? netlify() : undefined,
  experimental: process.env.NODE_ENV === 'production' ? { session: true } : undefined, // Required for Clerk+Netlify setup
  integrations: [
    clerk(),
    react(),
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
        // Used to adjust the order of sidebar items
        // https://starlight-auto-sidebar.netlify.app/guides/using-metadata/
        starlightAutoSidebar(),
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
          autogenerate: { directory: 'getting-started' },
        },
        {
          label: 'Evaluating LiveStore',
          autogenerate: { directory: 'evaluation' },
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
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
          label: 'API Reference (generated)',
          autogenerate: { directory: 'api' },
          collapsed: true,
        },
        {
          label: 'Contributing',
          autogenerate: { directory: 'contributing' },
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
