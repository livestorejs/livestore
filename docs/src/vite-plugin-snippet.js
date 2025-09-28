// @ts-check
import fs from 'node:fs'
import path from 'node:path'

/**
 * Vite plugin to build multi-file Twoslash snippets via `?snippet` imports.
 *
 * Why this exists
 * - Twoslash runs a TypeScript program over the provided virtual files. Feeding it
 *   unrelated files dramatically increases type-check cost per snippet.
 * - We therefore start from the snippet's main file and follow only its relative
 *   imports and triple-slash references, instead of scanning the whole directory.
 *   This keeps the virtual project minimal and fast.
 *
 * How it works
 * - Usage: `import snippet from './main-file.ts?snippet'`
 * - We enqueue `main-file.ts`, parse its imports and triple-slash references,
 *   resolve them relative to the file, and repeat (BFS) while de-duping.
 * - We flatten paths relative to a shared `baseDir` and emit `@filename` headers
 *   so Twoslash can see all files in a single flat namespace.
 * - We order files with `.d.ts` first (ambient types), dependencies before main,
 *   and then alphabetically for stable output.
 *
 * Caveats / Notes
 * - Only relative import specifiers (./ or ../) are supported; path aliases and
 *   bare module specifiers are intentionally ignored to keep examples self-contained.
 * - We try both `.ts` and `.tsx` when the import has no extension; directory
 *   index resolution (e.g. `./dir/index.ts`) is not supported by design.
 * - Circular imports are handled via a `processed` set.
 * - `@filename` paths use forward slashes; Twoslash expects POSIX-style paths.
 * - If performance ever regresses again, consider memoizing per main file keyed
 *   by file content hash and import graph, but current overhead is small.
 *
 * @returns {import('vite').Plugin}
 */
export function vitePluginSnippet() {
  return {
    name: 'vite-plugin-snippet',

    transform(_code, id) {
      // Check if this is a ?snippet import
      const [filepath, query] = id.split('?')
      if (!query || !query.includes('snippet') || !filepath) {
        return null
      }

      const dir = path.dirname(filepath)
      const mainFile = path.basename(filepath)
      // Base directory for flattening `@filename` paths.
      // Example: from `/patterns/effect/batch-example/batch.ts` we want `/patterns/effect/`.
      // Keeping the same base across related examples allows sharing stub types.
      const baseDir = path.dirname(path.dirname(filepath))

      /**
       * Extract relative import specifiers and triple-slash references.
       * - Only `./` and `../` specifiers are considered.
       * - Bare specifiers and aliases are ignored on purpose to avoid pulling in large graphs.
       *
       * @param {string} content
       * @returns {string[]}
       */
      function extractImports(content) {
        /** @type {string[]} */
        const imports = []
        // Match both import statements and export ... from statements
        const importRegex = /(?:import|export)\s+(?:.*?\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g
        let match
        match = importRegex.exec(content)
        while (match !== null && match[1] !== undefined) {
          imports.push(match[1])
          match = importRegex.exec(content)
        }

        // Match triple-slash references to local files (e.g. /// <reference path="../types.d.ts" />)
        const referenceRegex = /\/\/\/\s*<reference\s+path=["'](.+?)["']\s*\/>/g
        let referenceMatch = referenceRegex.exec(content)
        while (referenceMatch !== null && referenceMatch[1] !== undefined) {
          imports.push(referenceMatch[1])
          referenceMatch = referenceRegex.exec(content)
        }

        return imports
      }

      // Track discovered files keyed by path relative to the base directory
      const allFiles = new Map()
      const processed = new Set()

      /** @type {Array<{ path: string; relative: string }>} */
      const queue = []
      const addedPreludes = new Set()
      const baseDirReal = fs.realpathSync.native(baseDir)

      /**
       * Enqueue a file (if it exists) so it becomes part of the virtual program.
       * Normalises paths relative to `baseDir` to keep `@filename` directives stable.
       *
       * @param {string} absolutePath
       */
      function enqueueFile(absolutePath) {
        if (!fs.existsSync(absolutePath)) {
          return
        }
        const relativePath = path.relative(baseDir, absolutePath)
        if (allFiles.has(relativePath)) {
          return
        }
        const entry = { path: absolutePath, relative: relativePath }
        allFiles.set(relativePath, entry)
        queue.push(entry)
      }

      /**
       * Include `prelude.ts` files for the provided file and its ancestor directories.
       * Ensures shared shims (e.g. vite/client) are available regardless of import order.
       *
       * Example (✓ included, ✗ skipped when resolving `patterns/effect/store-setup/atoms.ts`):
       *
       * patterns/
       * ├─ effect/
       * │  ├─ prelude.ts          ✓
       * │  ├─ store-setup/
       * │  │  ├─ prelude.ts       ✓
       * │  │  └─ atoms.ts         (lookup origin)
       * │  └─ other/
       * │     └─ prelude.ts       ✗ (sibling branch)
       *
       * @param {string} absolutePath
       */
      function enqueuePreludes(absolutePath) {
        let currentDir = path.dirname(absolutePath)
        while (currentDir.startsWith(baseDirReal)) {
          const preludePath = path.resolve(currentDir, 'prelude.ts')
          if (!addedPreludes.has(preludePath)) {
            addedPreludes.add(preludePath)
            enqueueFile(preludePath)
          }
          if (currentDir === baseDirReal) {
            break
          }
          const parentDir = path.dirname(currentDir)
          if (parentDir === currentDir) {
            break
          }
          currentDir = parentDir
        }
      }

      // Seed the queue with the main file; we follow imports from there for performance
      enqueueFile(filepath)
      enqueuePreludes(filepath)

      while (queue.length > 0) {
        const fileInfo = queue.shift()
        if (!fileInfo) continue
        if (processed.has(fileInfo.path)) continue
        processed.add(fileInfo.path)

        const content = fs.readFileSync(fileInfo.path, 'utf-8')
        const imports = extractImports(content)

        for (const importPath of imports) {
          // Resolve the import relative to the file's directory
          const resolvedPath = path.resolve(path.dirname(fileInfo.path), importPath)

          // Check if file exists (try with and without extension, .ts then .tsx)
          const candidatePaths = [resolvedPath]
          if (!resolvedPath.endsWith('.ts') && !resolvedPath.endsWith('.tsx')) {
            candidatePaths.push(`${resolvedPath}.ts`, `${resolvedPath}.tsx`)
          }

          for (const candidate of candidatePaths) {
            if (fs.existsSync(candidate)) {
              enqueueFile(candidate)
              enqueuePreludes(candidate)
              break
            }
          }
        }
      }

      // Convert to array and sort for stable, dependency-first order
      const files = Array.from(allFiles.values()).sort((a, b) => {
        // Ensure .d.ts files come first
        const aIsDts = a.relative.endsWith('.d.ts')
        const bIsDts = b.relative.endsWith('.d.ts')
        if (aIsDts && !bIsDts) return -1
        if (!aIsDts && bIsDts) return 1

        // Put the main file last (after its dependencies) so Twoslash shows it after type context
        const aIsMain = path.basename(a.relative) === mainFile && a.relative.includes(path.basename(dir))
        const bIsMain = path.basename(b.relative) === mainFile && b.relative.includes(path.basename(dir))
        if (aIsMain && !bIsMain) return 1
        if (!aIsMain && bIsMain) return -1

        // Otherwise sort alphabetically for stability
        return a.relative.localeCompare(b.relative)
      })

      let snippetContent = ''

      for (const fileInfo of files) {
        const fileContent = fs.readFileSync(fileInfo.path, 'utf-8')

        // Add @filename directive:
        // Twoslash expects a flat virtual FS; use baseDir-relative POSIX paths.
        const filenameForTwoslash = fileInfo.relative.replace(/\\/g, '/')

        snippetContent += `// @filename: ${filenameForTwoslash}\n`

        // Add ---cut--- before the main file to focus the rendered snippet
        if (path.basename(fileInfo.relative) === mainFile && fileInfo.relative.includes(path.basename(dir))) {
          snippetContent += '// ---cut---\n'
        }

        snippetContent += fileContent

        // Add newline between files
        if (files.indexOf(fileInfo) < files.length - 1) {
          snippetContent += '\n\n'
        }
      }

      // Return as a module that exports the snippet
      if (snippetContent.length === 0) {
        // Fallback: include the main file content so downstream renderers don't error on empty code
        try {
          const fallback = fs.readFileSync(filepath, 'utf-8')
          if (fallback && typeof fallback === 'string') {
            return { code: `export default ${JSON.stringify(fallback)}`, map: null }
          }
        } catch {}
        // At least return a comment to avoid runtime errors in Code component
        return { code: `export default ${JSON.stringify(`/* snippet not found: ${filepath}?${query} */`)}`, map: null }
      }
      return {
        code: `export default ${JSON.stringify(snippetContent)}`,
        map: null,
      }
    },
  }
}
