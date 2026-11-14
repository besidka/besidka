import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../../../..')
const SERVER_ROOT = join(REPOSITORY_ROOT, 'server')

const FILE_OBJECT_DELETE_SITES = [
  'server/utils/files/delete-files.ts',
  'server/utils/files/cleanup-expired-files.ts',
  'server/utils/files/chat-deletion-cleanup.ts',
  'server/utils/account/purge-user-data.ts',
]

const OTHER_OBJECT_DELETE_SITES = [
  'server/utils/files/persist-file.ts',
  'server/utils/files/office-text.ts',
  'server/utils/documents/cleanup.ts',
  'server/utils/documents/store.ts',
  'server/utils/artifacts/store.ts',
  'server/utils/knowledge/purge.ts',
  'server/utils/knowledge/sweep.ts',
  'server/utils/knowledge/text-store.ts',
  'server/utils/knowledge/pack.ts',
  'server/utils/platform/cloudflare/blob-store.ts',
  'server/utils/skills/import/stage.ts',
  'server/utils/skills/storage.ts',
  'server/utils/skills/sweep.ts',
]

const STORAGE_DELETE_PATTERN
  = /(?:useFileStorage\(\)|\bstorage|\bbucket|\bDATA_BUCKET)\.delete\(/

function listSources(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)

    if (statSync(path).isDirectory()) {
      return listSources(path)
    }

    return path.endsWith('.ts') ? [path] : []
  })
}

function readSource(path: string): string {
  return readFileSync(join(REPOSITORY_ROOT, path), 'utf8')
}

describe('R2 deletes of file objects', () => {
  for (const site of FILE_OBJECT_DELETE_SITES) {
    it(`${site} deletes the file and its extracted text together`, () => {
      const source = readSource(site)

      expect(source).toContain('withDerivedKeys')
      expect(source).toMatch(STORAGE_DELETE_PATTERN)
    })
  }

  it('lists every server file that deletes from the file bucket', () => {
    const deletingFiles = listSources(SERVER_ROOT)
      .filter((path) => {
        return STORAGE_DELETE_PATTERN.test(readFileSync(path, 'utf8'))
      })
      .map((path) => {
        return relative(REPOSITORY_ROOT, path)
      })
      .sort()

    expect(deletingFiles).toEqual(
      [...FILE_OBJECT_DELETE_SITES, ...OTHER_OBJECT_DELETE_SITES].sort(),
    )
  })

  it('does not let the document spec cleanup touch file objects', () => {
    const source = readSource('server/utils/documents/cleanup.ts')

    expect(source).not.toContain('storageKey')
  })
})
