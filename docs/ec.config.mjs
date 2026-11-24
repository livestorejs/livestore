import { pluginHighlights } from './ec-plugin-highlights.ts'

// Astro's Code component must load function-valued plugins from this separate module.
// Both site variants intentionally retain GitHub dark. Twoslash keeps its own Shiki renderer.
export default {
  themes: ['github-dark', 'github-dark'],
  shiki: false,
  plugins: [pluginHighlights()],
}
