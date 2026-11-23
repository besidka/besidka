import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  buildDriveCreateMetadata,
  buildDriveMoveRequest,
  buildDriveRenameRequest,
  patchDriveItem,
} from '~~/server/utils/google/drive-write-api'

const ITEM_ID = 'item-id-0123456789'
const PARENT_ID = 'parent-id-0123456789'
const TARGET_ID = 'target-id-0123456789'
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
  it('has a Drive write module that reads, creates with one POST and '
    + 'changes with one PATCH, and never deletes or replaces', () => {
    const source = read(API_PATH)

    expect(source).not.toMatch(/method: 'DELETE'|method: 'PUT'/)
    expect(source.match(/method: 'POST'/g)).toHaveLength(1)
    expect(source.match(/method: 'PATCH'/g)).toHaveLength(1)
    expect(source.match(/method: 'GET'/g)?.length).toBeGreaterThan(0)
  })

  it('pins the HTTP methods the Google client can send to GET, POST and '
    + 'PATCH, so adding another method must update this spec on purpose',
  () => {
    const source = read('server/utils/google/http.ts')
    const declarations = source.match(/^\s*method: '.+$/gm) ?? []

    expect(declarations.map(line => line.trim())).toEqual([
      'method: \'GET\' | \'POST\' | \'PATCH\'',
    ])
    expect(source).not.toMatch(/'DELETE'|'PUT'/)
  })

  it('sends PATCH from the Drive write module only, and no DELETE or PUT '
    + 'from anywhere in the server', () => {
    const serverFiles = sourceFilesUnder('server')
    const patchers = serverFiles
      .filter((path) => {
        const source = read(path)

        return /\bPATCH\b/.test(source)
          && /googleFetchJson|google\/http|GoogleFetchRequest/.test(source)
      })
      .sort()

    expect(patchers).toEqual([
      'server/utils/google/drive-write-api.ts',
      'server/utils/google/http.ts',
    ])

    for (const path of sourceFilesUnder('server/utils/google')) {
      expect(read(path), path).not.toMatch(
        /method: 'DELETE'|method: 'PUT'|method: "DELETE"|method: "PUT"/,
      )
    }

    for (const path of sourceFilesUnder('server/api/v1/google')) {
      expect(read(path), path).not.toMatch(
        /method: 'DELETE'|method: 'PUT'|method: 'PATCH'/,
      )
    }
  })

  it('patches only /drive/v3/files/<id>, never the upload endpoint that '
    + 'would edit content', async () => {
    const calls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      calls.push(url)

      return new Response(JSON.stringify({ id: ITEM_ID }), { status: 200 })
    })

    await patchDriveItem(
      buildDriveRenameRequest({ itemId: ITEM_ID, name: 'Plan' }),
      { accessToken: 'token', fetchImpl },
    )
    await patchDriveItem(
      buildDriveMoveRequest({
        itemId: ITEM_ID,
        fromParentId: PARENT_ID,
        toParentId: TARGET_ID,
      }),
      { accessToken: 'token', fetchImpl },
    )

    expect(calls).toHaveLength(2)

    for (const call of calls) {
      const url = new URL(call)

      expect(url.origin).toBe('https://www.googleapis.com')
      expect(url.pathname).toBe(`/drive/v3/files/${ITEM_ID}`)
      expect(call).not.toContain('/upload/')
      expect(call).not.toContain('uploadType')
    }

    expect(read(API_PATH)).not.toMatch(/\/upload\/drive/)
  })

  it('sends a rename body of exactly the name and a move with only the '
    + 'four query keys and an empty body', async () => {
    const sent: Array<{ url: URL, body: string }> = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      sent.push({
        url: new URL(url),
        body: new TextDecoder().decode(init.body as Uint8Array),
      })

      return new Response(JSON.stringify({ id: ITEM_ID }), { status: 200 })
    })

    await patchDriveItem(
      buildDriveRenameRequest({
        itemId: ITEM_ID,
        name: 'Plan',
        permissions: [{ type: 'anyone' }],
        trashed: true,
      } as Parameters<typeof buildDriveRenameRequest>[0]),
      { accessToken: 'token', fetchImpl },
    )
    await patchDriveItem(
      buildDriveMoveRequest({
        itemId: ITEM_ID,
        fromParentId: PARENT_ID,
        toParentId: TARGET_ID,
        writersCanShare: true,
      } as Parameters<typeof buildDriveMoveRequest>[0]),
      { accessToken: 'token', fetchImpl },
    )

    expect(sent[0]!.body).toBe('{"name":"Plan"}')
    expect([...sent[0]!.url.searchParams.keys()].sort()).toEqual([
      'fields',
      'supportsAllDrives',
    ])
    expect(sent[1]!.body).toBe('{}')
    expect([...sent[1]!.url.searchParams.keys()].sort()).toEqual([
      'addParents',
      'fields',
      'removeParents',
      'supportsAllDrives',
    ])

    for (const request of sent) {
      expect(`${request.url.search}${request.body}`).not.toMatch(
        /permissions|trashed|writersCanShare|shortcutDetails|description/,
      )
    }
  })

  it('checks the id shape in the one function that puts an id in a URL '
    + 'path, with the same rule the tools use', () => {
    const source = read(API_PATH)

    expect(source).toMatch(
      /isDriveRootAlias\(value\) \|\| isDriveWriteId\(value\)/,
    )
    expect(source.match(/isBoundaryItemId\(/g)?.length).toBeGreaterThanOrEqual(3)
    expect(source.match(/\$\{DRIVE_FILES_URL\}\/\$\{/g)).toHaveLength(1)
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

    expect(source.match(/supportsAllDrives: 'true'/g)).toHaveLength(4)
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
      expect(source, path).not.toMatch(
        /google__drive_(create|list_folder|rename|move)/,
      )
    }

    const surface = read('config/mcp-surface.json')

    expect(surface).not.toMatch(
      /drive_create_folder|drive_list_folder|drive_rename|drive_move/,
    )
  })

  it('has no delete, trash or share code path in the Google utilities', () => {
    for (const path of sourceFilesUnder('server/utils/google')) {
      const source = read(path)

      expect(source, path).not.toMatch(/method: 'DELETE'/)
      expect(source, path).not.toMatch(/\/permissions|emptyTrash/)
    }
  })
})
