import type { ImageMetadata } from 'astro'

import { getExampleDeployment } from '@local/shared'

import cfChatImage from '../assets/examples/cf-chat.png'
import linearliteReactImage from '../assets/examples/linearlite-react.png'
import todomvcCloudflareSyncImage from '../assets/examples/todomvc-cloudflare-sync.png'
import todomvcCustomElementsImage from '../assets/examples/todomvc-custom-elements.png'
import todomvcReactImage from '../assets/examples/todomvc-react.png'
import todomvcSolidImage from '../assets/examples/todomvc-solid.png'
import { getBranchName, IS_MAIN_BRANCH } from './data.ts'

// Example screenshots are committed to docs/src/assets/examples so docs builds
// do not depend on fetching remote images during Astro optimization.
//
// To upload new source assets:
// 1. Get auth token: TOKEN=$(curl -s -X POST https://gitbucket.schickling.dev/api/auth | jq -r '.token')
// 2. Upload file: curl -X POST https://gitbucket.schickling.dev/api/upload -H "Authorization: Bearer $TOKEN" -F "file=@image.png" -F "tags=example,screenshot,docs"
// 3. Download the returned asset into docs/src/assets/examples and import it below.

// Screenshot expectations: All example screenshots should be 1000w x 700h pixels
// This ensures consistent display in the documentation CardGrid layout

export interface Example {
  title: string
  description: string
  adapters: ('web' | 'node' | 'expo' | 'cloudflare')[]
  syncProvider?: 'cloudflare' | 'electric' | 's2'
  technologies: string[]
  image?: ImageMetadata
  demoUrl?: string
  devDemoUrl?: string
  sourceUrl: string
  status: 'available' | 'placeholder'
}

export const getExampleDemoLinks = (example: Example) => {
  const url =
    IS_MAIN_BRANCH === true ? (example.demoUrl ?? example.devDemoUrl) : (example.devDemoUrl ?? example.demoUrl)

  return {
    url,
    label: IS_MAIN_BRANCH === true ? 'Try Demo →' : 'Try Dev Demo →',
  }
}

const branch = getBranchName()
const contribBranch = 'main'
export const contribExamplesUrl = `https://github.com/livestorejs/livestore-contrib/tree/${contribBranch}/examples`

const webTodomvcDeployment = getExampleDeployment('web-todomvc')
const webLinearliteDeployment = getExampleDeployment('web-linearlite')
const webTodomvcSyncCfDeployment = getExampleDeployment('web-todomvc-sync-cf')

export const examples: Example[] = [
  // Web Adapter Examples
  {
    title: 'TodoMVC (React)',
    description:
      'Classic TodoMVC implementation with React, showcasing local-first data persistence and real-time synchronization.',
    adapters: ['web'],
    technologies: ['React', 'TypeScript', 'LiveStore'],
    image: todomvcReactImage,
    demoUrl: webTodomvcDeployment.endpoints.prod.url,
    devDemoUrl: webTodomvcDeployment.endpoints.dev.url,
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/web-todomvc`,
    status: 'available',
  },
  {
    title: 'LinearLite (React)',
    description:
      'Issue tracking application inspired by Linear, demonstrating complex data relationships and collaborative editing.',
    adapters: ['web'],
    technologies: ['React', 'TypeScript', 'LiveStore'],
    image: linearliteReactImage,
    demoUrl: webLinearliteDeployment.endpoints.prod.url,
    devDemoUrl: webLinearliteDeployment.endpoints.dev.url,
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/web-linearlite`,
    status: 'available',
  },
  {
    title: 'TodoMVC + CF Sync',
    description:
      'TodoMVC with Cloudflare Workers integration, showcasing server-side synchronization and Durable Objects.',
    adapters: ['web'],
    syncProvider: 'cloudflare',
    technologies: ['React', 'Cloudflare Workers', 'Durable Objects', 'LiveStore'],
    image: todomvcCloudflareSyncImage,
    demoUrl: webTodomvcSyncCfDeployment.endpoints.prod.url,
    devDemoUrl: webTodomvcSyncCfDeployment.endpoints.dev.url,
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/web-todomvc-sync-cf`,
    status: 'available',
  },
  {
    title: 'TodoMVC (SolidJS)',
    description: "TodoMVC implementation using SolidJS, demonstrating LiveStore's framework-agnostic approach.",
    adapters: ['web'],
    technologies: ['SolidJS', 'TypeScript', 'LiveStore'],
    image: todomvcSolidImage,
    sourceUrl: `https://github.com/livestorejs/livestore-contrib/tree/${contribBranch}/examples/web-todomvc-solid`,
    status: 'available',
  },
  {
    title: 'TodoMVC (Svelte)',
    description: 'TodoMVC implementation using Svelte with LiveStore-powered reactivity via `@livestore/svelte`.',
    adapters: ['web'],
    technologies: ['Svelte', 'TypeScript', 'LiveStore'],
    sourceUrl: `https://github.com/livestorejs/livestore-contrib/tree/${contribBranch}/examples/web-todomvc-svelte`,
    status: 'available',
  },
  {
    title: 'TodoMVC (Custom Elements)',
    description:
      'Web Components implementation using TypeScript and React, demonstrating custom element patterns with LiveStore.',
    adapters: ['web'],
    technologies: ['Web Components', 'TypeScript', 'React', 'LiveStore'],
    image: todomvcCustomElementsImage,
    sourceUrl: `https://github.com/livestorejs/livestore-contrib/tree/${contribBranch}/examples/web-todomvc-custom-elements`,
    status: 'available',
  },
  {
    title: 'TodoMVC + Electric Sync',
    description: 'TodoMVC with ElectricSQL integration, demonstrating real-time sync with PostgreSQL backend.',
    adapters: ['web'],
    syncProvider: 'electric',
    technologies: ['React', 'ElectricSQL', 'PostgreSQL', 'LiveStore'],
    sourceUrl: `https://github.com/livestorejs/livestore-contrib/tree/${contribBranch}/examples/web-todomvc-sync-electric`,
    status: 'available',
  },
  {
    title: 'TodoMVC (Experimental)',
    description: 'Experimental TodoMVC implementation showcasing cutting-edge LiveStore features and patterns.',
    adapters: ['web'],
    technologies: ['React', 'TypeScript', 'LiveStore'],
    sourceUrl: `https://github.com/livestorejs/livestore-contrib/tree/${contribBranch}/examples/web-todomvc-experimental`,
    status: 'available',
  },
  {
    title: 'TodoMVC (Script)',
    description: 'Minimal TypeScript implementation demonstrating basic LiveStore integration patterns.',
    adapters: ['web'],
    technologies: ['TypeScript', 'LiveStore'],
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/web-todomvc-script`,
    status: 'available',
  },

  // Cloudflare Adapter Examples (including dual-adapter examples)
  {
    title: 'CF Chat',
    description:
      'Real-time chat application with Cloudflare Durable Objects, WebSocket synchronization, and bot interactions.',
    adapters: ['web', 'cloudflare'], // Uses both adapters
    syncProvider: 'cloudflare',
    technologies: ['React', 'Cloudflare Workers', 'Durable Objects', 'WebSockets', 'LiveStore'],
    image: cfChatImage,
    sourceUrl: `https://github.com/livestorejs/livestore-contrib/tree/${contribBranch}/examples/cf-chat`,
    status: 'available',
  },
  {
    title: 'Cloudflare TodoMVC',
    description:
      'Server-side TodoMVC implementation running on Cloudflare Workers, demonstrating edge computing with LiveStore.',
    adapters: ['cloudflare'],
    syncProvider: 'cloudflare',
    technologies: ['Cloudflare Workers', 'Durable Objects', 'TypeScript', 'LiveStore'],
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/cloudflare-todomvc`,
    status: 'available',
  },

  // Node Adapter Examples
  {
    title: 'Node Effect CLI',
    description:
      "Command-line application built with Effect, showcasing LiveStore's Node.js capabilities and server-side data management patterns.",
    adapters: ['node'],
    technologies: ['Node.js', 'Effect', 'CLI', 'TypeScript', 'LiveStore'],
    sourceUrl: `https://github.com/livestorejs/livestore-contrib/tree/${contribBranch}/examples/node-effect-cli`,
    status: 'available',
  },
  {
    title: 'Node TodoMVC + CF Sync',
    description:
      'Server-side todo application with Cloudflare sync integration, perfect for understanding backend LiveStore patterns.',
    adapters: ['node'],
    syncProvider: 'cloudflare',
    technologies: ['Node.js', 'Cloudflare', 'Server-side', 'TypeScript', 'LiveStore'],
    sourceUrl: `https://github.com/livestorejs/livestore-contrib/tree/${contribBranch}/examples/node-todomvc-sync-cf`,
    status: 'available',
  },

  // Expo Adapter Examples
  {
    title: 'Expo LinearLite',
    description:
      'Mobile issue tracker built with Expo and React Native, bringing the full Linearlite experience to iOS and Android with offline-first capabilities.',
    adapters: ['expo'],
    technologies: ['React Native', 'Expo', 'Mobile', 'TypeScript', 'LiveStore'],
    sourceUrl: `https://github.com/livestorejs/livestore-contrib/tree/${contribBranch}/examples/expo-linearlite`,
    status: 'available',
  },
  {
    title: 'Expo TodoMVC + CF Sync',
    description:
      'Mobile todo application with Cloudflare synchronization, demonstrating cross-platform data sync between web and mobile clients.',
    adapters: ['expo'],
    syncProvider: 'cloudflare',
    technologies: ['React Native', 'Expo', 'Cloudflare', 'Real-time Sync', 'LiveStore'],
    sourceUrl: `https://github.com/livestorejs/livestore-contrib/tree/${contribBranch}/examples/expo-todomvc-sync-cf`,
    status: 'available',
  },
]

// Helper functions to filter examples by adapter
export const getExamplesByAdapter = (adapter: 'web' | 'node' | 'expo' | 'cloudflare') =>
  examples.filter((example) => example.adapters.includes(adapter))

export const webExamples = getExamplesByAdapter('web')
export const nodeExamples = getExamplesByAdapter('node')
export const expoExamples = getExamplesByAdapter('expo')
export const cloudflareExamples = getExamplesByAdapter('cloudflare')
