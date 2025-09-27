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
      if (!query || !query.includes('snippet')) {
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
        const imports = []
        // Match both import statements and export ... from statements
        const importRegex = /(?:import|export)\s+(?:.*?\s+from\s+)?['"](\.\.?\/[^'"]+)['"]/g
        let match
        match = importRegex.exec(content)
        while (match !== null) {
          imports.push(match[1])
          match = importRegex.exec(content)
        }

        // Match triple-slash references to local files (e.g. /// <reference path="../types.d.ts" />)
        const referenceRegex = /\/\/\/\s*<reference\s+path=["'](.+?)["']\s*\/>/g
        let referenceMatch = referenceRegex.exec(content)
        while (referenceMatch !== null) {
          imports.push(referenceMatch[1])
          referenceMatch = referenceRegex.exec(content)
        }

        return imports
      }

      // Track discovered files keyed by path relative to the base directory
      const allFiles = new Map()
      const processed = new Set()

      // Seed the queue with only the main file; we follow imports from there for performance
      const mainRelativePath = path.relative(baseDir, filepath)
      const queue = [{ path: filepath, relative: mainRelativePath }]

      // Ensure the main file itself is included in the snippet output
      allFiles.set(mainRelativePath, { path: filepath, relative: mainRelativePath })

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
          let fullPath = resolvedPath
          if (!fs.existsSync(fullPath) && !fullPath.endsWith('.ts') && !fullPath.endsWith('.tsx')) {
            if (fs.existsSync(`${fullPath}.ts`)) {
              fullPath = `${fullPath}.ts`
            } else if (fs.existsSync(`${fullPath}.tsx`)) {
              fullPath = `${fullPath}.tsx`
            } else {
              continue // Skip if file doesn't exist
            }
          }

          // Calculate relative path from base directory
          const relativePath = path.relative(baseDir, fullPath)

          if (!allFiles.has(relativePath) && fs.existsSync(fullPath)) {
            const newFile = { path: fullPath, relative: relativePath }
            allFiles.set(relativePath, newFile)
            queue.push(newFile)
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
