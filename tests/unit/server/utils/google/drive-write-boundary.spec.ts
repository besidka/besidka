import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDriveCreateMetadata } from '~~/server/utils/google/drive-write-api'

const ROOT = process.cwd()
const API_PATH = 'server/utils/google/drive-write-api.ts'
const TOOLS_PATH = 'server/utils/google/drive-write-tools.ts'

function sourceFilesUnder(directory: string): string[] {
  return readdirSync(join(ROOT, directory)).flatMap((name) => {
    const path = join(directory, name)

    return statSync(join(ROOT, path)).isDirectory()
      ? sourceFilesUnder(path)
      : /\.(ts|vue)$/.test(name) ? [path] : []
  })
}

function read(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8')
}

describe('the Drive write boundary', () => {
  it('has a Drive write module that only reads, and creates with a POST',
    () => {
      const source = read(API_PATH)

      expect(source).not.toMatch(
        /method: 'DELETE'|method: 'PUT'|method: 'PATCH'/,
      )
      expect(source.match(/method: 'POST'/g)).toHaveLength(1)
      expect(source.match(/method: 'GET'/g)?.length).toBeGreaterThan(0)
    })

  it('names no endpoint that deletes, shares, copies or watches', () => {
    const source = read(API_PATH)

    expect(source).not.toMatch(
      /\/permissions|\/copy|\/trash|emptyTrash|\/watch|\/revisions|\/comments|transferOwnership|\/export|alt=media/,
    )
    expect(source).not.toMatch(/\/upload\/drive/)
    expect(source).toContain('https://www.googleapis.com/drive/v3/files')
  })

  it('sends supportsAllDrives on every file request it builds', () => {
    const source = read(API_PATH)

    expect(source.match(/supportsAllDrives: 'true'/g)).toHaveLength(3)
  })

  it('copies only the five allowed keys, even from an object that carries '
    + 'more', () => {
    const hostile = {
      id: 'folder-id-0123456789',
      name: 'Reports',
      mimeType: 'application/vnd.google-apps.folder',
      parentId: 'parent-id-0123456789',
      approvalDigest: 'digest',
      permissions: [{ type: 'anyone', role: 'writer' }],
      trashed: true,
      writersCanShare: true,
      shortcutDetails: { targetId: 'x' },
      contentHints: { indexableText: 'x' },
      description: 'x',
      properties: { a: 'b' },
      parents: ['another-parent-0123456789'],
    }
    const metadata = buildDriveCreateMetadata(hostile)

    expect(Object.keys(metadata).sort()).toEqual([
      'appProperties',
      'id',
      'mimeType',
      'name',
      'parents',
    ])
    expect(metadata.parents).toEqual(['parent-id-0123456789'])
    expect(Object.keys(metadata.appProperties as object))
      .toEqual(['besidkaApproval'])
    expect(JSON.stringify(metadata)).not.toMatch(
      /permissions|trashed|writersCanShare|shortcutDetails|contentHints|description|properties"/,
    )
  })

  it('has no tool that sends the words of a hostile body to Google', () => {
    const source = read(TOOLS_PATH)

    expect(source).not.toMatch(
      /permissions|writersCanShare|transferOwnership|emptyTrash/,
    )
  })

  it('reaches the Drive write module only from the Drive write tools, and '
    + 'those only from the candidate builder', () => {
    const files = [
      ...sourceFilesUnder('server'),
      ...sourceFilesUnder('app'),
      ...sourceFilesUnder('shared'),
    ]
    const importersOf = (pattern: RegExp) => {
      return files
        .filter(path => pattern.test(read(path)))
        .map(path => relative(ROOT, path))
        .sort()
    }

    expect(importersOf(/google\/drive-write-api'/)).toEqual([TOOLS_PATH])
    expect(importersOf(/google\/drive-write-tools'/)).toEqual([
      'server/utils/tool-approval/google-send-candidates.ts',
    ])
  })

  it('keeps the Drive write tools out of the MCP server', () => {
    const mcpFiles = [
      ...sourceFilesUnder('server/mcp'),
      ...sourceFilesUnder('server/utils/mcp'),
    ]

    for (const path of mcpFiles) {
      const source = read(path)

      expect(source, path).not.toMatch(/drive-write-api|drive-write-tools/)
      expect(source, path).not.toMatch(/google__drive_(create|list_folder)/)
    }

    const surface = read('config/mcp-surface.json')

    expect(surface).not.toMatch(/drive_create_folder|drive_list_folder/)
  })

  it('has no delete, trash or share code path in the Google utilities', () => {
    for (const path of sourceFilesUnder('server/utils/google')) {
      const source = read(path)

      expect(source, path).not.toMatch(/method: 'DELETE'/)
      expect(source, path).not.toMatch(/\/permissions|emptyTrash/)
    }
  })
})
