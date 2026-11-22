import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

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
