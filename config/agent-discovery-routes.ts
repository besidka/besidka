import type { AgentRoute } from 'nuxt-agent-discovery'

export const agentDiscoveryRoutes: (string | AgentRoute)[] = [
  '/',
  { path: '/byok', raw: '/raw/guides/byok.md' },
  { path: '/memory', raw: '/raw/guides/memory.md' },
  { path: '/privacy-policy', raw: '/raw/legal/privacy-policy.md' },
  { path: '/terms-of-use', raw: '/raw/legal/terms-of-use.md' },
  { path: '/cookie-policy', raw: '/raw/legal/cookie-policy.md' },
  '/guides/**',
]

export const contentPathRedirects = {
  '/guides/byok': { redirect: { to: '/byok', statusCode: 301 } },
  '/guides/memory': { redirect: { to: '/memory', statusCode: 301 } },
  '/legal/privacy-policy': {
    redirect: { to: '/privacy-policy', statusCode: 301 },
  },
  '/legal/terms-of-use': {
    redirect: { to: '/terms-of-use', statusCode: 301 },
  },
  '/legal/cookie-policy': {
    redirect: { to: '/cookie-policy', statusCode: 301 },
  },
} as const
