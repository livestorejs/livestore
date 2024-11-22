import starlight from '@astrojs/starlight'
import tailwind from '@astrojs/tailwind'
import { defineConfig } from 'astro/config'

// https://astro.build/config
export default defineConfig({
  integrations: [
    starlight({
      title: 'LiveStore',
      social: {
        github: 'https://github.com/livestorejs/livestore',
      },
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
          label: 'Miscellaneous',
          autogenerate: { directory: 'misc' },
        },
      ],
      customCss: ['./src/tailwind.css'],
      logo: {
        src: './src/assets/livestore.png',
        alt: 'LiveStore Logo',
        replacesTitle: true,
      },
    }),
    tailwind({ applyBaseStyles: false }),
  ],
  vite: {
    server: {
      fs: {
        strict: false,
      },
    },
  },
})
