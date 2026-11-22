import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CODE_EXECUTION_PROVIDERS } from '#shared/utils/code-execution'
import { GOOGLE_BYO_KEY_PROVIDER } from '#shared/utils/google-byo'
import { providerMeta } from '#shared/utils/provider-meta'

const ROOT = process.cwd()
const TOKENS_FILE = 'server/utils/google/tokens.ts'
const BYO_CLIENT_FILE = 'server/utils/google/byo-client.ts'
const SCHEMA_FILES = new Set([
  'server/db/schemas/google-connections.ts',
  'server/db/schema.ts',
  'server/db/relations.ts',
])
const TABLE_ALIAS_PATTERN
  = /const\s+(\w+)\s*=\s*(?:alias\(\s*)?schema\.googleConnections\b/g

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)

    if (statSync(path).isDirectory()) {
      return listTypeScriptFiles(path)
    }

    return path.endsWith('.ts') ? [path] : []
  })
}

function serverSources(): Array<{ path: string, source: string }> {
  return listTypeScriptFiles(join(ROOT, 'server')).map((path) => {
    return {
      path: relative(ROOT, path),
      source: readFileSync(path, 'utf8'),
    }
  })
}

function tableNames(source: string): string[] {
  const names = ['schema.googleConnections']

  for (const match of source.matchAll(TABLE_ALIAS_PATTERN)) {
    names.push(match[1]!)
  }

  return names
}

function escapeForPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The places outside `tokens.ts` that touch the table but may not read a
 * token: a token column may only appear inside `isNotNull(...)`; a bare
 * `.select()` or `.returning()`, or a relational query, would read every
 * column and is refused in any file that names the table.
 */
function tokenReadsOutsideBoundary(): string[] {
  const findings: string[] = []

  for (const { path, source } of serverSources()) {
    if (path === TOKENS_FILE || SCHEMA_FILES.has(path)) {
      continue
    }

    if (!source.includes('googleConnections')) {
      continue
    }

    if (/\.select\(\s*\)/.test(source) || /\.returning\(\s*\)/.test(source)) {
      findings.push(`${path}: bare select or returning`)
    }

    if (/query\.googleConnections\b/.test(source)) {
      findings.push(`${path}: relational query`)
    }

    for (const name of tableNames(source)) {
      const column = new RegExp(
        `${escapeForPattern(name)}\\.(?:accessToken|refreshToken)\\b`,
        'g',
      )

      for (const match of source.matchAll(column)) {
        const before = source.slice(Math.max(0, match.index - 10), match.index)

        if (!before.endsWith('isNotNull(')) {
          findings.push(`${path}: reads ${match[0]}`)
        }
      }
    }
  }

  return findings
}

/**
 * Every place outside `byo-client.ts` that reads a `keys` value must name
 * its provider with a string literal, or with one of these reviewed
 * expressions whose values can never be `google-oauth-client`: research
 * takes `ResearchProviderId` (`openai` or `google`), gateways resolve
 * through `providerMeta`, Jev is `typesafe`, and code execution takes
 * `CodeExecutionProvider`. A new generic reader fails here until it is
 * reviewed and added.
 */
const REVIEWED_PROVIDER_EXPRESSIONS: ReadonlyMap<string, readonly string[]>
  = new Map([
    ['server/utils/research/keys.ts', ['provider']],
    ['server/utils/gateways/openrouter.ts', [
      'keyProviderIdForGateway(\'openrouter\')',
    ]],
    ['server/utils/gateways/vercel.ts', [
      'keyProviderIdForGateway(\'vercel\')',
    ]],
    ['server/utils/gateways/cloudflare.ts', [
      'keyProviderIdForGateway(\'cloudflare\')',
    ]],
    ['server/utils/jev/client.ts', ['JEV_KEY_PROVIDER']],
    ['server/utils/code-execution/send.ts', ['input.provider']],
  ])

const KEYS_QUERY_PATTERN = /query\.keys\.find(?:First|Many)\(/g
const KEYS_QUERY_WINDOW = 400

function keyQueryProviders(source: string): string[] {
  const providers: string[] = []

  for (const match of source.matchAll(KEYS_QUERY_PATTERN)) {
    const window = source.slice(match.index, match.index + KEYS_QUERY_WINDOW)

    if (!/apiKey:\s*true/.test(window)) {
      continue
    }

    const explicit = window.match(/provider:\s*([^,}\n]+)/)

    if (explicit) {
      providers.push(explicit[1]!.trim())

      continue
    }

    providers.push(/\bprovider\s*[,}\n]/.test(window) ? 'provider' : '')
  }

  return providers
}

function keyValueReadsWithUnreviewedProvider(): string[] {
  const findings: string[] = []

  for (const { path, source } of serverSources()) {
    if (path === BYO_CLIENT_FILE) {
      continue
    }

    const reviewed = REVIEWED_PROVIDER_EXPRESSIONS.get(path) ?? []

    for (const provider of keyQueryProviders(source)) {
      const literal = provider.match(/^'([a-z-]+)'$/)

      if (literal && literal[1] !== GOOGLE_BYO_KEY_PROVIDER) {
        continue
      }

      if (!literal && reviewed.includes(provider)) {
        continue
      }

      findings.push(`${path}: provider ${provider || '(none)'}`)
    }

    if (/\.select\(\{[^}]*apiKey:\s*schema\.keys\.apiKey/.test(source)) {
      findings.push(`${path}: selects keys.apiKey outside a keys query`)
    }
  }

  return findings
}

describe('Google token boundary', () => {
  it('reads the token columns only in tokens.ts', () => {
    expect(tokenReadsOutsideBoundary()).toEqual([])
  })

  it('decrypts only in tokens.ts, the own client and the state store', () => {
    const googleFiles = serverSources()
      .filter(({ source }) => source.includes('useDecryptText('))
      .map(({ path }) => path)
      .filter(path => path.includes('/google/'))
      .sort()

    expect(googleFiles).toEqual([
      BYO_CLIENT_FILE,
      'server/utils/google/oauth-state.ts',
      TOKENS_FILE,
    ])
  })

  it('reads the own client\'s stored value only in byo-client.ts', () => {
    const readers = serverSources()
      .filter(({ path, source }) => {
        return path !== BYO_CLIENT_FILE
          && (source.includes('google-oauth-client')
            || source.includes('GOOGLE_BYO_KEY_PROVIDER'))
          && /schema\.keys\.apiKey|apiKey:\s*true|useDecryptText\(/.test(source)
      })
      .map(({ path }) => path)

    expect(readers).toEqual([])
  })

  it('names a fixed, reviewed provider in every other keys value read',
    () => {
      const scannedReads = serverSources().flatMap(({ source }) => {
        return keyQueryProviders(source)
      })

      expect(scannedReads.length).toBeGreaterThan(20)
      expect(keyValueReadsWithUnreviewedProvider()).toEqual([])
    })

  it('keeps the own client out of the reviewed provider expressions', () => {
    const keyProviderIds = Object.values(providerMeta).map((meta) => {
      return meta.keyProviderId
    })

    expect(keyProviderIds).not.toContain(GOOGLE_BYO_KEY_PROVIDER)
    expect(CODE_EXECUTION_PROVIDERS).not.toContain(GOOGLE_BYO_KEY_PROVIDER)
    expect(REVIEWED_PROVIDER_EXPRESSIONS.get('server/utils/research/keys.ts'))
      .toEqual(['provider'])
  })

  it('flags a generic keys reader handed any provider', () => {
    const source = [
      'const row = await db.query.keys.findFirst({',
      '  where: { userId, provider: kind },',
      '  columns: { apiKey: true },',
      '})',
    ].join('\n')

    expect(keyQueryProviders(source)).toEqual(['kind'])
  })

  it('catches a bare select and an aliased token read', () => {
    const source = [
      'const rows = await db.select().from(schema.googleConnections)',
      'const connections = schema.googleConnections',
      'const value = connections.refreshToken',
    ].join('\n')

    expect(/\.select\(\s*\)/.test(source)).toBe(true)
    expect(tableNames(source)).toContain('connections')
  })
})
