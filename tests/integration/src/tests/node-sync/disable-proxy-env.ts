import { afterAll } from 'vitest'

const PROXY_ENV_VARS = ['HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy'] as const

type ProxyEnvVar = (typeof PROXY_ENV_VARS)[number]

const removedProxyEnv: Partial<Record<ProxyEnvVar, string>> = {}

for (const key of PROXY_ENV_VARS) {
  const value = process.env[key]
  if (value !== undefined) {
    removedProxyEnv[key] = value
    delete process.env[key]
  }
}

afterAll(() => {
  for (const key of PROXY_ENV_VARS) {
    const value = removedProxyEnv[key]
    if (value !== undefined) {
      process.env[key] = value
    }
  }
})
