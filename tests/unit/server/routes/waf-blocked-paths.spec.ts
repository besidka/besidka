import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = join(import.meta.dirname, '..', '..', '..', '..')

const WAF_BLOCKED_SUBSTRINGS = [
  'debug',
  'login',
  '.key',
  'uploads',
  'php',
  'aws',
]

const WELL_KNOWN_EXACT_PATHS = new Set([
  '/.well-known/api-catalog',
  '/.well-known/ai-catalog.json',
  '/.well-known/poppy.json',
  '/.well-known/mcp-registry-auth',
  '/.well-known/openai-apps-challenge',
  '/.well-known/oauth-authorization-server',
  '/.well-known/openid-configuration',
  '/.well-known/oauth-protected-resource',
])

const WELL_KNOWN_PREFIXES = [
  '/.well-known/mcp/',
  '/.well-known/agent-skills/',
  '/.well-known/skills/',
  '/.well-known/oauth-protected-resource/',
]

const METHOD_SUFFIX = /\.(get|post|put|patch|delete|head|options)$/

function listFiles(directory: string): string[] {
  const entries = readdirSync(directory)

  return entries.flatMap((entry) => {
    const fullPath = join(directory, entry)

    return statSync(fullPath).isDirectory() ? listFiles(fullPath) : [fullPath]
  })
}

function toUrlPath(routesRoot: string, urlPrefix: string, file: string) {
  const relativePath = relative(routesRoot, file).split(sep).join('/')
  const withoutExtension = relativePath.replace(/\.(ts|js|mjs)$/, '')
  const withoutMethod = withoutExtension.replace(METHOD_SUFFIX, '')
  const segments = withoutMethod
    .split('/')
    .map((segment) => {
      return /^\[.*\]$/.test(segment) ? ':param' : segment
    })
  const lastSegment = segments.at(-1)

  if (lastSegment === 'index') {
    segments.pop()
  }

  return `${urlPrefix}${segments.join('/')}`.replace(/\/$/, '') || '/'
}

function collectRoutePaths(): string[] {
  const roots = [
    { directory: join(REPOSITORY_ROOT, 'server', 'api'), prefix: '/api/' },
    { directory: join(REPOSITORY_ROOT, 'server', 'routes'), prefix: '/' },
  ]

  return roots.flatMap(({ directory, prefix }) => {
    return listFiles(directory)
      .filter(file => /\.(ts|js|mjs)$/.test(file))
      .map(file => toUrlPath(directory, prefix, file))
  })
}

function isAllowedWellKnown(path: string): boolean {
  return WELL_KNOWN_EXACT_PATHS.has(path)
    || WELL_KNOWN_PREFIXES.some(prefix => path.startsWith(prefix))
}

function findViolation(path: string): string | null {
  const lowerCasePath = path.toLowerCase()

  if (lowerCasePath.includes('.well-known') && !isAllowedWellKnown(path)) {
    return '.well-known outside the allowlist'
  }

  const blocked = WAF_BLOCKED_SUBSTRINGS.find((substring) => {
    return lowerCasePath.includes(substring)
  })

  return blocked ? `contains "${blocked}"` : null
}

describe('server route paths against the zone WAF rule', () => {
  const routePaths = collectRoutePaths()

  it('finds the routes', () => {
    expect(routePaths.length).toBeGreaterThan(100)
    expect(routePaths).toContain('/api/v1/chats/:param/context')
    expect(routePaths).toContain('/.well-known/ai-catalog.json')
  })

  it('names no route with a path the "URL attackers" rule blocks', () => {
    const violations = routePaths
      .map((path) => {
        return { path, reason: findViolation(path) }
      })
      .filter(({ reason }) => {
        return reason
      })

    expect(
      violations,
      'A route path matches a clause of the Cloudflare zone rule "URL '
      + 'attackers" and answers 403 in production before reaching the app. '
      + 'Rename the route (docs/agent-readiness.md, owner runbook step 1).',
    ).toEqual([])
  })

  it('catches the paths the rule blocks', () => {
    expect(findViolation('/api/v1/chats/:param/debug-info')).toBe(
      'contains "debug"',
    )
    expect(findViolation('/api/v1/Login/x')).toBe('contains "login"')
    expect(findViolation('/x/.well-known/ai-catalog.json')).toBe(
      '.well-known outside the allowlist',
    )
    expect(findViolation('/.well-known/zzz')).toBe(
      '.well-known outside the allowlist',
    )
    expect(findViolation('/.well-known/ai-catalog.json')).toBeNull()
    expect(findViolation('/api/v1/chats/:param/support-info')).toBeNull()
  })
})
