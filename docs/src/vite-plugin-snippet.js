// @ts-check
import fs from 'node:fs'
import path from 'node:path'

/**
 * Vite plugin that handles ?snippet imports for multi-file Twoslash code snippets
 *
 * Usage: import snippet from './main-file.ts?snippet'
 *
 * This will:
 * 1. Find all .ts files in the same directory
 * 2. Follow imports to include referenced files from other directories
 * 3. Sort them with .d.ts files first, dependencies before dependents
 * 4. Add @filename directives for each
 * 5. Place ---cut--- before the imported file
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
      // For the base directory, we want the parent of the parent
      // e.g., from /patterns/effect/batch-example/batch.ts we want /patterns/effect/
      const baseDir = path.dirname(path.dirname(filepath))

      /**
       * Extract relative imports from a file
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
        return imports
      }

      /**
       * Recursively find all .ts and .tsx files in the directory and subdirectories
       * @returns {{ path: string, relative: string }[]}
       */
      function findTsFiles(/** @type {string} */ dirPath, /** @type {string} */ baseDir = '') {
        const files = []
        const entries = fs.readdirSync(dirPath, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name)
          const relativePath = baseDir ? path.join(baseDir, entry.name) : entry.name

          if (entry.isDirectory()) {
            // Recursively search subdirectories
            files.push(...findTsFiles(fullPath, relativePath))
          } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
            files.push({
              path: fullPath,
              relative: relativePath,
            })
          }
        }

        return files
      }

      // Start with files in the current directory
      const filesInDir = findTsFiles(dir)
      const allFiles = new Map()
      const processed = new Set()

      // Add files from current directory
      for (const file of filesInDir) {
        // Calculate relative path from base directory
        const relativeFromBase = path.relative(baseDir, file.path)
        allFiles.set(relativeFromBase, { ...file, relative: relativeFromBase })
      }

      // Process imports to find additional files
      const queue = [...filesInDir]

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

          // Check if file exists (try with and without extension)
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

      // Convert to array and sort
      const files = Array.from(allFiles.values()).sort((a, b) => {
        // Ensure .d.ts files come first
        const aIsDts = a.relative.endsWith('.d.ts')
        const bIsDts = b.relative.endsWith('.d.ts')
        if (aIsDts && !bIsDts) return -1
        if (!aIsDts && bIsDts) return 1

        // Put the main file last (after its dependencies)
        const aIsMain = path.basename(a.relative) === mainFile && a.relative.includes(path.basename(dir))
        const bIsMain = path.basename(b.relative) === mainFile && b.relative.includes(path.basename(dir))
        if (aIsMain && !bIsMain) return 1
        if (!aIsMain && bIsMain) return -1

        // Otherwise sort alphabetically
        return a.relative.localeCompare(b.relative)
      })

      let snippetContent = ''

      for (const fileInfo of files) {
        const fileContent = fs.readFileSync(fileInfo.path, 'utf-8')

        // Add @filename directive
        // For Twoslash, we need to create a flat structure where all files can find each other
        // We'll use the full path relative to the base directory
        const filenameForTwoslash = fileInfo.relative.replace(/\\/g, '/')

        snippetContent += `// @filename: ${filenameForTwoslash}\n`

        // Add ---cut--- before the main file
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
      return {
        code: `export default ${JSON.stringify(snippetContent)}`,
        map: null,
      }
    },
  }
}
