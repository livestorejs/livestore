import { defineCollection } from 'astro:content'
import { docsSchema } from '@astrojs/starlight/schema'
import { autoSidebarLoader } from 'starlight-auto-sidebar/loader'
import { autoSidebarSchema } from 'starlight-auto-sidebar/schema'

export const collections = {
  docs: defineCollection({ schema: docsSchema() }),
  examples: defineCollection({ schema: docsSchema() }),
  autoSidebar: defineCollection({
    loader: autoSidebarLoader(),
    schema: autoSidebarSchema(),
  }),
}
