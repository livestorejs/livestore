/**
 * Enforcement checks for the intent layer (`context/` VRS tree).
 *
 * Validates the mechanical invariants that `context/spec.md` declares:
 * ID uniqueness and namespace↔directory mapping (parsed from the spec's ID
 * Scheme table — the single source of truth, not hardcoded here), `refines:`
 * target integrity, relative-link integrity, spec Status headers, absence of
 * empty companion dirs, decision-record shape, and the maturity-marker
 * vocabulary. Semantic review (testability of requirements, decision
 * evidence quality) stays human/agent judgment and is out of scope.
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const repoRoot = (() => {
  let dir = import.meta.dirname
  while (fs.existsSync(path.join(dir, 'context', 'spec.md')) === false) {
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('repo root with context/spec.md not found')
    dir = parent
  }
  return dir
})()
const contextDir = path.join(repoRoot, 'context')

const walkFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory() === true) return walkFiles(entryPath)
    return entry.isFile() === true ? [entryPath] : []
  })

const walkDirs = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory() === false) return []
    const entryPath = path.join(dir, entry.name)
    return [entryPath, ...walkDirs(entryPath)]
  })

const mdFiles = walkFiles(contextDir).filter((f) => f.endsWith('.md'))
const rel = (f: string) => path.relative(repoRoot, f)

interface IdSite {
  id: string
  namespace: string
  file: string
  line: number
}

const ID_PATTERN = String.raw`LS(?:\.[A-Z]+)*-(?:A|T|R|DQ)\d+`
/** A definition is a bulleted bold ID whose bold span ends in `:` or `.` —
 * pointer bullets (`**LS-DQ1 …** — see`) intentionally don't match. */
const DEFINITION_RE = new RegExp(String.raw`^\s*-\s+\*\*(${ID_PATTERN})[^*]*[:.]\*\*`)

const namespaceOf = (id: string) => id.slice(0, id.lastIndexOf('-'))

const definitions: IdSite[] = mdFiles.flatMap((file) =>
  fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((lineText, i) => {
      const match = DEFINITION_RE.exec(lineText)
      if (match === null) return []
      const id = match[1]!
      return [{ id, namespace: namespaceOf(id), file, line: i + 1 }]
    }),
)

const definedIds = new Set(definitions.map((d) => d.id))

/** Parse the `## ID Scheme` table of context/spec.md into
 * namespace → { dir, isRealization } (first namespace of a row anchors to the
 * row's first backticked path; further namespaces are realizations living
 * under that path). */
const parseNamespaceTable = () => {
  const specText = fs.readFileSync(path.join(contextDir, 'spec.md'), 'utf8')
  const section = specText.split(/^## ID Scheme$/m)[1]?.split(/^## /m)[0]
  if (section === undefined) throw new Error('context/spec.md: `## ID Scheme` section not found')
  const map = new Map<string, { dir: string; isRealization: boolean }>()
  for (const row of section.split('\n')) {
    if (row.trimStart().startsWith('|') === false) continue
    const cells = row.split('|').map((c) => c.trim())
    if (cells.length < 3) continue
    const namespaces = [...cells[1]!.matchAll(/`(LS(?:\.[A-Z]+)*)-\*`/g)].map((m) => m[1]!)
    if (namespaces.length === 0) continue
    const firstPath = /`([\w./-]+\/)`/.exec(cells[2]!)?.[1] ?? ''
    namespaces.forEach((namespace, i) => {
      map.set(namespace, { dir: firstPath, isRealization: i > 0 })
    })
  }
  return map
}

describe('intent layer (context/)', () => {
  it('defines every ID exactly once', () => {
    const byId = new Map<string, IdSite[]>()
    for (const d of definitions) {
      byId.set(d.id, [...(byId.get(d.id) ?? []), d])
    }
    const duplicates = [...byId.values()]
      .filter((sites) => sites.length > 1)
      .map((sites) => `${sites[0]!.id} defined at ${sites.map((s) => `${rel(s.file)}:${s.line}`).join(', ')}`)
    expect(duplicates, `duplicate ID definitions:\n${duplicates.join('\n')}`).toEqual([])
  })

  it('defines IDs only in the directory their namespace maps to (spec.md ID Scheme table)', () => {
    const table = parseNamespaceTable()
    const violations: string[] = []
    for (const d of definitions) {
      const entry = table.get(d.namespace)
      if (entry === undefined) {
        violations.push(`${rel(d.file)}:${d.line} — namespace ${d.namespace} (${d.id}) missing from spec.md ID table`)
        continue
      }
      const fileDirRel = path.relative(contextDir, path.dirname(d.file))
      const nodeDir = entry.dir.replace(/\/$/, '')
      const inNode =
        entry.isRealization === true
          ? fileDirRel.startsWith(nodeDir === '' ? '' : `${nodeDir}${path.sep}`) // realization: strictly below the dimension dir
          : fileDirRel === nodeDir // dimension/branch: exactly its node dir
      if (inNode === false) {
        violations.push(
          `${rel(d.file)}:${d.line} — ${d.id} (namespace ${d.namespace}) expected under context/${entry.dir}`,
        )
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })

  it('has a resolvable target for every refines: marker', () => {
    const violations: string[] = []
    for (const file of mdFiles) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((lineText, i) => {
          for (const match of lineText.matchAll(/`refines: ([^`]+)`/g)) {
            for (const token of match[1]!.split(',').map((t) => t.trim())) {
              if (/^<[^>]+>$/.test(token) === true) continue // syntax placeholder in convention docs
              if (new RegExp(`^${ID_PATTERN}$`).test(token) === false) {
                violations.push(`${rel(file)}:${i + 1} — malformed refines target ${JSON.stringify(token)}`)
              } else if (definedIds.has(token) === false) {
                violations.push(`${rel(file)}:${i + 1} — refines target ${token} is not defined anywhere`)
              }
            }
          }
        })
    }
    expect(violations, violations.join('\n')).toEqual([])
  })

  it('has no broken relative markdown links', () => {
    const violations: string[] = []
    for (const file of mdFiles) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((lineText, i) => {
          for (const match of lineText.matchAll(/\[[^\]]*\]\(([^()\s]+)\)/g)) {
            const target = match[1]!
            if (/^(https?:|mailto:|#)/.test(target) === true) continue
            const targetPath = path.resolve(path.dirname(file), target.split('#')[0]!)
            if (fs.existsSync(targetPath) === false) {
              violations.push(`${rel(file)}:${i + 1} — broken link ${target}`)
            }
          }
        })
    }
    expect(violations, violations.join('\n')).toEqual([])
  })

  it('has a Status section (Draft/Active/Stable) in every spec.md', () => {
    const violations: string[] = []
    for (const file of mdFiles.filter((f) => path.basename(f) === 'spec.md')) {
      const text = fs.readFileSync(file, 'utf8')
      const statusBody = text
        .split(/^## Status$/m)[1]
        ?.split(/^## /m)[0]
        ?.trim()
      const status = statusBody?.split(/[\s.]/)[0]
      if (status === undefined || ['Draft', 'Active', 'Stable'].includes(status) === false) {
        violations.push(`${rel(file)} — missing or invalid \`## Status\` (got ${JSON.stringify(status)})`)
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })

  it('has no empty companion directories', () => {
    const empty = walkDirs(contextDir).filter((dir) => walkFiles(dir).length === 0)
    expect(
      empty.map((d) => rel(d)),
      'empty directories (delete until they carry real content)',
    ).toEqual([])
  })

  it('keeps decision records well-formed and .proposed/ out of the tree', () => {
    const violations: string[] = []
    for (const dir of walkDirs(contextDir).filter((d) => path.basename(d) === '.decisions')) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const entryPath = path.join(dir, entry.name)
        if (entry.isDirectory() === true) {
          if (entry.name === '.proposed' && walkFiles(entryPath).length > 0) {
            violations.push(`${rel(entryPath)} — .decisions/.proposed/ must not contain committed records`)
          }
          continue
        }
        if (/^\d{4}-[a-z0-9-]+\.md$/.test(entry.name) === false) {
          violations.push(`${rel(entryPath)} — decision filename must match NNNN-slug.md`)
        }
        if (/^Status: /m.test(fs.readFileSync(entryPath, 'utf8')) === false) {
          violations.push(`${rel(entryPath)} — decision record missing a \`Status:\` line`)
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })

  it('uses only the declared maturity vocabulary', () => {
    const violations: string[] = []
    for (const file of mdFiles) {
      fs.readFileSync(file, 'utf8')
        .split('\n')
        .forEach((lineText, i) => {
          for (const match of lineText.matchAll(/\*\*Maturity: ([a-zA-Z-]+)/g)) {
            if (['experimental', 'proposal'].includes(match[1]!) === false) {
              violations.push(`${rel(file)}:${i + 1} — unknown maturity ${JSON.stringify(match[1])}`)
            }
          }
        })
    }
    expect(violations, violations.join('\n')).toEqual([])
  })
})
