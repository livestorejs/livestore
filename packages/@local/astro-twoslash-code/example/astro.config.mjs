import os from 'node:os'
import starlight from '@astrojs/starlight'
import { createAstroTwoslashCodeIntegration } from '@local/astro-twoslash-code/integration'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'astro/config'

export default defineConfig({
  integrations: [
    createAstroTwoslashCodeIntegration(),
    starlight({
      title: 'Twoslash Code Demo',
      sidebar: [],
    }),
  ],
  vite: {
    server: { allowedHosts: [os.hostname()] },
    plugins: [tailwindcss()],
  },
})
