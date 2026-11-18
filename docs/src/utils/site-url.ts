/** The deploy command supplies the canonical origin before Netlify adds its build URL. */
export const resolveDocsSiteUrl = (env: Record<string, string | undefined>, port: number): string => {
  const configured = env.LIVESTORE_DOCS_SITE_URL ?? env.DEPLOY_PRIME_URL
  if (configured !== undefined) return new URL(configured).origin
  return env.NODE_ENV === 'production' ? 'https://dev.docs.livestore.dev' : `https://localhost:${port}`
}
