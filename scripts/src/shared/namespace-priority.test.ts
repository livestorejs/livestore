import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = path.resolve(import.meta.dirname, '../../..')
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && Array.isArray(value) === false
const readJobs = (filename: string) => {
  const workflow: unknown = parse(fs.readFileSync(path.join(root, '.github/workflows', filename), 'utf8'))
  if (isRecord(workflow) === false || isRecord(workflow.jobs) === false)
    throw new Error(`Invalid workflow: ${filename}`)
  return workflow.jobs
}
const workflows = Object.fromEntries(
  fs
    .readdirSync(path.join(root, '.github/workflows'))
    .filter((filename) => filename.endsWith('.yml'))
    .map((filename) => [filename, readJobs(filename)]),
)

// Deliberately independent of the generator: adding a Namespace job requires an explicit classification audit.
const deliveryJobs = [
  'source-policy',
  'lint',
  'changeset-check',
  'type-check',
  'test-unit',
  'test-integration-sync-provider',
  'test-integration-playwright',
  'wa-sqlite-test',
  'build-and-deploy-examples-src',
  'build-deploy-docs',
]
const backgroundJobs = ['publish-nix-cache', 'perf-test', 'report-pr-preview']
const expectedPriorities = new Map<string, 3 | 6>([
  ...deliveryJobs.map((job) => [`ci.yml/${job}`, 3] as const),
  ...backgroundJobs.map((job) => [`ci.yml/${job}`, 6] as const),
  ...['release.yml', 'deploy-prod.yml', 'devtools-artifact.yml'].map((file) => [`${file}/source-policy`, 3] as const),
])

const priorityErrors = (input: typeof workflows) => {
  const errors: string[] = []
  const seen = new Set<string>()
  for (const [filename, jobs] of Object.entries(input)) {
    for (const [id, job] of Object.entries(jobs)) {
      if (isRecord(job) === false || Array.isArray(job['runs-on']) === false) continue
      const labels: unknown[] = job['runs-on']
      if (labels.some((label) => typeof label === 'string' && label.startsWith('namespace-profile-')) === false)
        continue
      const key = `${filename}/${id}`
      seen.add(key)
      const expected = expectedPriorities.get(key)
      if (expected === undefined || labels[0] !== `namespace-profile-linux-x86-64;job.priority=${expected}`) {
        errors.push(`${key}: missing, incorrect or unclassified priority`)
      }
      if (labels.length !== 2 || labels[1] !== 'namespace-features:github.run-id=${{ github.run_id }}') {
        errors.push(`${key}: run affinity changed`)
      }
    }
  }
  for (const key of expectedPriorities.keys()) if (seen.has(key) === false) errors.push(`${key}: missing Namespace job`)
  return errors
}

describe('Namespace generated workflow priorities', () => {
  it('classifies all 13 delivery and three background jobs while preserving run affinity', () => {
    expect(priorityErrors(workflows)).toEqual([])
    expect([...expectedPriorities.values()].filter((priority) => priority === 3)).toHaveLength(13)
    expect([...expectedPriorities.values()].filter((priority) => priority === 6)).toHaveLength(3)
  })

  it('keeps every Namespace required check and its prerequisite at delivery priority', () => {
    const jobs = workflows['ci.yml']!
    const visited = new Set<string>()
    const visit = (id: string) => {
      if (visited.has(id) === true) return
      visited.add(id)
      const job = jobs[id]
      expect(isRecord(job), `missing required check or prerequisite: ${id}`).toBe(true)
      if (isRecord(job) === false) return
      const labels = job['runs-on']
      if (Array.isArray(labels) === true) expect(expectedPriorities.get(`ci.yml/${id}`)).toBe(3)
      const needs = typeof job.needs === 'string' ? [job.needs] : job.needs
      if (Array.isArray(needs) === true)
        for (const dependency of needs) if (typeof dependency === 'string') visit(dependency)
    }
    const settings: unknown = JSON.parse(fs.readFileSync(path.join(root, '.github/repo-settings.json'), 'utf8'))
    if (isRecord(settings) === false || Array.isArray(settings.rules) === false) throw new Error('Missing ruleset')
    const requiredChecks = settings.rules.flatMap((rule: unknown) => {
      if (isRecord(rule) === false || rule.type !== 'required_status_checks' || isRecord(rule.parameters) === false)
        return []
      const checks = rule.parameters.required_status_checks
      if (Array.isArray(checks) === false) throw new Error('Missing required checks')
      return checks.flatMap((check: unknown) =>
        isRecord(check) === true && typeof check.context === 'string' ? [check.context] : [],
      )
    })
    expect(requiredChecks.length).toBeGreaterThan(0)
    for (const check of requiredChecks) visit(check.replace(/ \(.*/, ''))
  })

  it.each([
    [
      'wrong priority',
      ['namespace-profile-linux-x86-64;job.priority=6', 'namespace-features:github.run-id=${{ github.run_id }}'],
    ],
    ['missing priority', ['namespace-profile-linux-x86-64', 'namespace-features:github.run-id=${{ github.run_id }}']],
    [
      'changed affinity',
      ['namespace-profile-linux-x86-64;job.priority=3', 'namespace-features:github.run-id=other-run'],
    ],
  ])('rejects %s in emitted delivery labels', (_, labels) => {
    const input = structuredClone(workflows)
    const sourcePolicy = input['ci.yml']!['source-policy']
    if (isRecord(sourcePolicy) === false) throw new Error('Missing source-policy job')
    sourcePolicy['runs-on'] = labels
    expect(priorityErrors(input).length).toBeGreaterThan(0)
  })
})
