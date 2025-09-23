import { getBranchName, IS_MAIN_BRANCH } from '../../data.js'

// Hosted assets - To upload new assets:
// 1. Get auth token: TOKEN=$(curl -s -X POST https://gitbucket.schickling.dev/api/auth | jq -r '.token')
// 2. Upload file: curl -X POST https://gitbucket.schickling.dev/api/upload -H "Authorization: Bearer $TOKEN" -F "file=@image.png" -F "tags=example,screenshot,docs"
// 3. Use the returned hash in the URL with file extension: https://gitbucket.schickling.dev/api/get/{hash}.png

// Screenshot expectations: All example screenshots should be 1000w x 700h pixels
// This ensures consistent display in the documentation CardGrid layout

export interface Example {
  title: string
  description: string
  adapters: ('web' | 'node' | 'expo' | 'cloudflare')[]
  syncProvider?: 'cloudflare' | 'electric' | 's2'
  technologies: string[]
  image?: {
    url: string
    width: number
    height: number
  }
  demoUrl?: string
  devDemoUrl?: string
  sourceUrl: string
  status: 'available' | 'placeholder'
}

export const getExampleDemoLinks = (example: Example) => {
  const url = IS_MAIN_BRANCH ? (example.demoUrl ?? example.devDemoUrl) : (example.devDemoUrl ?? example.demoUrl)

  return {
    url,
    label: IS_MAIN_BRANCH ? 'Try Demo →' : 'Try Dev Demo →',
  }
}

const branch = getBranchName()

export const examples: Example[] = [
  // Web Adapter Examples
  {
    title: 'TodoMVC (React)',
    description:
      'Classic TodoMVC implementation with React, showcasing local-first data persistence and real-time synchronization.',
    adapters: ['web'],
    technologies: ['React', 'TypeScript', 'LiveStore'],
    image: {
      url: 'https://gitbucket.schickling.dev/api/get/b86f8e3a89e967dc2091575a18d6f5f1b28623916a064f0b806a81da62fc6c66.png',
      width: 1000,
      height: 700,
    },
    demoUrl: 'https://web-todomvc.livestore.dev',
    devDemoUrl: 'https://dev.web-todomvc.livestore.dev',
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/web-todomvc`,
    status: 'available',
  },
  {
    title: 'LinearLite (React)',
    description:
      'Issue tracking application inspired by Linear, demonstrating complex data relationships and collaborative editing.',
    adapters: ['web'],
    technologies: ['React', 'TypeScript', 'LiveStore'],
    image: {
      url: 'https://gitbucket.schickling.dev/api/get/0937342202cf657f34f48e9de9084211b88f0f41040ff786dd11f4e61f9f91f0.png',
      width: 1000,
      height: 700,
    },
    demoUrl: 'https://web-linearlite.livestore.dev',
    devDemoUrl: 'https://dev.web-linearlite.livestore.dev',
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
    image: {
      url: 'https://gitbucket.schickling.dev/api/get/7c3314ad88b842aa6454f8b8c28ddc91984badb86316dc27afa86a58fbfabc1d.png',
      width: 1000,
      height: 700,
    },
    demoUrl: 'https://web-todomvc-sync-cf.livestore.dev',
    devDemoUrl: 'https://dev.web-todomvc-sync-cf.livestore.dev',
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/web-todomvc-sync-cf`,
    status: 'available',
  },
  {
    title: 'TodoMVC (SolidJS)',
    description: "TodoMVC implementation using SolidJS, demonstrating LiveStore's framework-agnostic approach.",
    adapters: ['web'],
    technologies: ['SolidJS', 'TypeScript', 'LiveStore'],
    image: {
      url: 'https://gitbucket.schickling.dev/api/get/c134001882fb15fc7d5c991fab87c49d7df9e51e24caacae200c17eca4d2c00a.png',
      width: 1000,
      height: 700,
    },
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/web-todomvc-solid`,
    status: 'available',
  },
  {
    title: 'TodoMVC (Custom Elements)',
    description:
      'Web Components implementation using TypeScript and React, demonstrating custom element patterns with LiveStore.',
    adapters: ['web'],
    technologies: ['Web Components', 'TypeScript', 'React', 'LiveStore'],
    image: {
      url: 'https://gitbucket.schickling.dev/api/get/cbd68aec51fbd042c20faa10994fd4d8e9b29de79602e9752c885aa565bfc3a0.png',
      width: 1000,
      height: 700,
    },
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/web-todomvc-custom-elements`,
    status: 'available',
  },
  {
    title: 'TodoMVC + Electric Sync',
    description: 'TodoMVC with ElectricSQL integration, demonstrating real-time sync with PostgreSQL backend.',
    adapters: ['web'],
    syncProvider: 'electric',
    technologies: ['React', 'ElectricSQL', 'PostgreSQL', 'LiveStore'],
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/web-todomvc-sync-electric`,
    status: 'available',
  },
  {
    title: 'TodoMVC (Experimental)',
    description: 'Experimental TodoMVC implementation showcasing cutting-edge LiveStore features and patterns.',
    adapters: ['web'],
    technologies: ['React', 'TypeScript', 'LiveStore'],
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/web-todomvc-experimental`,
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
    image: {
      url: 'https://gitbucket.schickling.dev/api/get/fc916aa7aa9532bbb97f1447889c6c53515079322d26bedd2e2c4ab6accd00d0.png',
      width: 1000,
      height: 700,
    },
    demoUrl: 'https://example-cf-chat.netlify.app',
    devDemoUrl: 'https://dev.cf-chat.livestore.dev',
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/cf-chat`,
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
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/node-effect-cli`,
    status: 'available',
  },
  {
    title: 'Node TodoMVC + CF Sync',
    description:
      'Server-side todo application with Cloudflare sync integration, perfect for understanding backend LiveStore patterns.',
    adapters: ['node'],
    syncProvider: 'cloudflare',
    technologies: ['Node.js', 'Cloudflare', 'Server-side', 'TypeScript', 'LiveStore'],
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/node-todomvc-sync-cf`,
    status: 'available',
  },

  // Expo Adapter Examples
  {
    title: 'Expo LinearLite',
    description:
      'Mobile issue tracker built with Expo and React Native, bringing the full Linearlite experience to iOS and Android with offline-first capabilities.',
    adapters: ['expo'],
    technologies: ['React Native', 'Expo', 'Mobile', 'TypeScript', 'LiveStore'],
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/expo-linearlite`,
    status: 'available',
  },
  {
    title: 'Expo TodoMVC + CF Sync',
    description:
      'Mobile todo application with Cloudflare synchronization, demonstrating cross-platform data sync between web and mobile clients.',
    adapters: ['expo'],
    syncProvider: 'cloudflare',
    technologies: ['React Native', 'Expo', 'Cloudflare', 'Real-time Sync', 'LiveStore'],
    sourceUrl: `https://github.com/livestorejs/livestore/tree/${branch}/examples/expo-todomvc-sync-cf`,
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
