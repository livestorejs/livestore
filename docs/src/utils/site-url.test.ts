import { expect, it } from 'vitest'

import { resolveDocsSiteUrl } from './site-url.ts'

it('uses the explicit deployment origin for corpus links even when Netlify supplies a build URL', () => {
  expect(
    resolveDocsSiteUrl(
      { LIVESTORE_DOCS_SITE_URL: 'https://docs.livestore.dev', DEPLOY_PRIME_URL: 'https://docs' },
      5252,
    ),
  ).toBe('https://docs.livestore.dev')
})

it('keeps the Netlify preview origin when no canonical deployment target is supplied', () => {
  expect(resolveDocsSiteUrl({ DEPLOY_PRIME_URL: 'https://deploy-preview-12--livestore-docs.netlify.app' }, 5252)).toBe(
    'https://deploy-preview-12--livestore-docs.netlify.app',
  )
})

it('preserves configured ports and fails a malformed explicit deployment URL', () => {
  expect(resolveDocsSiteUrl({ LIVESTORE_DOCS_SITE_URL: 'http://localhost:5252/path' }, 5252)).toBe(
    'http://localhost:5252',
  )
  expect(() => resolveDocsSiteUrl({ LIVESTORE_DOCS_SITE_URL: 'docs.livestore.dev' }, 5252)).toThrow()
})

it('keeps development and production defaults when deployment URLs are absent', () => {
  expect(resolveDocsSiteUrl({}, 5252)).toBe('https://localhost:5252')
  expect(resolveDocsSiteUrl({ NODE_ENV: 'production' }, 5252)).toBe('https://dev.docs.livestore.dev')
})
