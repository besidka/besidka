import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const TOKEN_COLUMN_PATTERN = /googleConnections\.(?:refreshToken|accessToken)\b/

function listTypeScriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)

    if (statSync(path).isDirectory()) {
      return listTypeScriptFiles(path)
    }

    return path.endsWith('.ts') ? [path] : []
  })
}

function serverFilesMatching(predicate: (source: string) => boolean) {
  return listTypeScriptFiles(join(ROOT, 'server'))
    .filter(path => predicate(readFileSync(path, 'utf8')))
    .map(path => relative(ROOT, path))
    .sort()
}

describe('Google token boundary', () => {
  it('reads the token columns only in tokens.ts', () => {
    expect(serverFilesMatching((source) => {
      return TOKEN_COLUMN_PATTERN.test(source)
    })).toEqual(['server/utils/google/tokens.ts'])
  })

  it('decrypts only in tokens.ts and the OAuth state store', () => {
    const googleFiles = serverFilesMatching((source) => {
      return source.includes('useDecryptText(')
    }).filter((path) => {
      return path.includes('/google/')
    })

    expect(googleFiles).toEqual([
      'server/utils/google/oauth-state.ts',
      'server/utils/google/tokens.ts',
    ])
  })
})
