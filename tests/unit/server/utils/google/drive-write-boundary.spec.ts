import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  buildDriveCreateMetadata,
  buildDriveMoveRequest,
  buildDriveRenameRequest,
  createDriveFileWithContent,
  findDriveItemsByApprovalDigest,
  patchDriveItem,
} from '~~/server/utils/google/drive-write-api'

const ITEM_ID = 'item-id-0123456789'
const PARENT_ID = 'parent-id-0123456789'
const TARGET_ID = 'target-id-0123456789'
const ROOT = process.cwd()
const API_PATH = 'server/utils/google/drive-write-api.ts'
const TOOLS_PATH = 'server/utils/google/drive-write-tools.ts'
const DOWNLOAD_PATH = 'server/utils/google/created-file-download.ts'

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
  it('has a Drive write module that reads, creates with two POSTs (a '
    + 'folder, and a file with content) and changes with one PATCH, and '
    + 'never deletes or replaces', () => {
    const source = read(API_PATH)

    expect(source).not.toMatch(/method: 'DELETE'|method: 'PUT'/)
    expect(source.match(/method: 'POST'/g)).toHaveLength(2)
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

  it('finds no PATCH to a Google host, raw fetch included, outside the '
    + 'Drive write module and the client type', () => {
    const files = [
      ...sourceFilesUnder('server'),
      ...sourceFilesUnder('app'),
      ...sourceFilesUnder('shared'),
    ]
    const patchersToGoogle = files
      .filter((path) => {
        const source = read(path)

        return /['"]PATCH['"]|method:\s*`?PATCH/.test(source)
          && /googleapis\.com|GOOGLE_FETCH_HOSTS|googleFetchJson/.test(source)
      })
      .sort()

    expect(patchersToGoogle).toEqual([
      'server/utils/google/drive-write-api.ts',
      'server/utils/google/http.ts',
    ])

    for (const path of files) {
      const source = read(path)

      if (path === API_PATH || !/\bfetch\(/.test(source)) {
        continue
      }

      expect(source, path).not.toMatch(
        /fetch\([^)]*googleapis\.com[\s\S]{0,400}PATCH/,
      )
    }
  })

  it.each([
    ['a trashed flag in a rename body', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: { name: 'Plan', trashed: true },
    }],
    ['permissions in a rename body', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: { name: 'Plan', permissions: [{ type: 'anyone' }] },
    }],
    ['writersCanShare in a body', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: { writersCanShare: true },
    }],
    ['a body with a non-string name', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: { name: 4 },
    }],
    ['an extra query key on a rename', {
      itemId: ITEM_ID,
      query: {
        fields: 'id,name,mimeType,parents',
        supportsAllDrives: 'true',
        alt: 'media',
      },
      body: { name: 'Plan' },
    }],
    ['a transferOwnership query on a rename', {
      itemId: ITEM_ID,
      query: {
        fields: 'id,name,mimeType,parents',
        supportsAllDrives: 'true',
        transferOwnership: 'true',
      },
      body: { name: 'Plan' },
    }],
    ['an empty body with the rename query', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: {},
    }],
    ['a name in a move body', {
      itemId: ITEM_ID,
      query: {
        addParents: TARGET_ID,
        removeParents: PARENT_ID,
        fields: 'id,name,mimeType,parents',
        supportsAllDrives: 'true',
      },
      body: { name: 'Plan' },
    }],
    ['parents in a move body', {
      itemId: ITEM_ID,
      query: {
        addParents: TARGET_ID,
        removeParents: PARENT_ID,
        fields: 'id,name,mimeType,parents',
        supportsAllDrives: 'true',
      },
      body: { parents: [TARGET_ID] },
    }],
    ['a move without removeParents', {
      itemId: ITEM_ID,
      query: {
        addParents: TARGET_ID,
        fields: 'id,name,mimeType,parents',
        supportsAllDrives: 'true',
      },
      body: {},
    }],
    ['an extra query key on a move', {
      itemId: ITEM_ID,
      query: {
        addParents: TARGET_ID,
        removeParents: PARENT_ID,
        fields: 'id,name,mimeType,parents',
        supportsAllDrives: 'true',
        sendNotificationEmail: 'true',
      },
      body: {},
    }],
    ['supportsAllDrives off', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'false' },
      body: { name: 'Plan' },
    }],
    ['another field mask', {
      itemId: ITEM_ID,
      query: { fields: '*', supportsAllDrives: 'true' },
      body: { name: 'Plan' },
    }],
    ['an upper-case AddParents key', {
      itemId: ITEM_ID,
      query: {
        AddParents: TARGET_ID,
        removeParents: PARENT_ID,
        fields: 'id,name,mimeType,parents',
        supportsAllDrives: 'true',
      },
      body: {},
    }],
    ['an own __proto__ key in the body', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: JSON.parse('{"name":"Plan","__proto__":{"trashed":true}}'),
    }],
    ['a body that is only an own __proto__ key', {
      itemId: ITEM_ID,
      query: {
        addParents: TARGET_ID,
        removeParents: PARENT_ID,
        fields: 'id,name,mimeType,parents',
        supportsAllDrives: 'true',
      },
      body: JSON.parse('{"__proto__":{"name":"x"}}'),
    }],
    ['an own __proto__ key in the query', {
      itemId: ITEM_ID,
      query: JSON.parse(
        '{"fields":"id,name,mimeType,parents","supportsAllDrives":"true",'
        + '"__proto__":{"alt":"media"}}',
      ),
      body: { name: 'Plan' },
    }],
    ['an object as the name', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: { name: { toString: () => 'Plan' } },
    }],
    ['an array as the name', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: { name: ['Plan'] },
    }],
    ['an empty name', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: { name: '' },
    }],
    ['a name of 201 characters', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: { name: 'a'.repeat(201) },
    }],
    ['a name with a slash', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: { name: '../../x' },
    }],
    ['a name with a control character', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: { name: 'a\u0000b' },
    }],
    ['a name with a right-to-left override', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: { name: 'abc‮def' },
    }],
    ['the same folder to add and to remove', {
      itemId: ITEM_ID,
      query: {
        addParents: PARENT_ID,
        removeParents: PARENT_ID,
        fields: 'id,name,mimeType,parents',
        supportsAllDrives: 'true',
      },
      body: {},
    }],
    ['a null body', {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: null,
    }],
    ['an array as the query', {
      itemId: ITEM_ID,
      query: [],
      body: { name: 'Plan' },
    }],
  ] as never[][])('refuses a hand-built request with %s before any request', async (
    _label,
    request,
  ) => {
    const fetchImpl = vi.fn(async () => {
      return new Response('{}', { status: 200 })
    })

    expect(await patchDriveItem(request, {
      accessToken: 'token',
      fetchImpl,
    })).toEqual({ ok: false, code: 'bad_request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('sends the values it validated when an object answers differently the '
    + 'second time it is read', async () => {
    const sent: Array<{ url: string, body: string }> = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      sent.push({
        url,
        body: new TextDecoder().decode(init.body as Uint8Array),
      })

      return new Response(JSON.stringify({ id: ITEM_ID }), { status: 200 })
    })
    const answers = (first: string, later: string) => {
      let reads = 0

      return () => {
        reads += 1

        return reads === 1 ? first : later
      }
    }
    const renameRequest = {
      itemId: ITEM_ID,
      query: { fields: 'id,name,mimeType,parents', supportsAllDrives: 'true' },
      body: Object.defineProperty({}, 'name', {
        enumerable: true,
        get: answers('Plan', '../../x'),
      }),
    }
    const moveRequest = {
      itemId: ITEM_ID,
      query: Object.defineProperties({
        removeParents: PARENT_ID,
        fields: 'id,name,mimeType,parents',
        supportsAllDrives: 'true',
      }, {
        addParents: {
          enumerable: true,
          get: answers(TARGET_ID, 'other-id-0123456789'),
        },
      }),
      body: {},
    }

    await patchDriveItem(renameRequest, {
      accessToken: 'token',
      fetchImpl,
    })
    await patchDriveItem(moveRequest, { accessToken: 'token', fetchImpl })

    expect(sent[0]!.body).toBe('{"name":"Plan"}')
    expect(new URL(sent[1]!.url).searchParams.get('addParents'))
      .toBe(TARGET_ID)
  })

  it('calls patchDriveItem from the tools only with the output of a '
    + 'request builder', () => {
    const source = read(TOOLS_PATH)

    expect(source.match(/patchDriveItem\(/g)).toHaveLength(2)
    expect(source.match(
      /patchDriveItem\(\s*build(?:DriveRenameRequest|DriveMoveRequest)\(/g,
    )).toHaveLength(2)
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

    const apiSource = read(API_PATH)
    const patchSource = apiSource.slice(
      apiSource.indexOf('async function patchDriveItem'),
      apiSource.indexOf('export interface ListedDriveItem'),
    )

    expect(patchSource).toContain('driveItemUrl(snapshot.itemId')
    expect(patchSource).not.toMatch(/DRIVE_UPLOAD_URL|\/upload\/|uploadType/)
  })

  it('names the upload endpoint once and reaches it only from the '
    + 'multipart create, a POST of uploadType=multipart', async () => {
    const source = read(API_PATH)

    expect(source.match(/googleapis\.com\/upload\//g)).toHaveLength(1)
    expect(source.match(/DRIVE_UPLOAD_URL/g)).toHaveLength(2)
    expect(source.match(/uploadType: 'multipart'/g)).toHaveLength(1)
    expect(source).not.toMatch(
      /uploadType: 'resumable'|uploadType: 'media'|uploadType=media|uploadType=resumable/,
    )

    const calls: Array<{ url: string, method: string | undefined }> = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method })

      return new Response(JSON.stringify({ id: ITEM_ID }), { status: 200 })
    })

    await createDriveFileWithContent(
      {
        id: ITEM_ID,
        name: 'Plan',
        kind: 'text',
        content: 'plain',
        parentId: null,
        approvalDigest: 'D'.repeat(43),
      },
      { accessToken: 'token', fetchImpl },
    )

    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('POST')

    const url = new URL(calls[0]!.url)

    expect(url.pathname).toBe('/upload/drive/v3/files')
    expect(url.searchParams.get('uploadType')).toBe('multipart')
    expect(url.searchParams.get('supportsAllDrives')).toBe('true')
    expect(url.searchParams.has('addParents')).toBe(false)
    expect(url.searchParams.has('removeParents')).toBe(false)
  })

  it('has no other file in the server, app or shared code that posts to '
    + 'the Drive upload endpoint except the older Besidka save and this '
    + 'module', () => {
    const files = [
      ...sourceFilesUnder('server'),
      ...sourceFilesUnder('app'),
      ...sourceFilesUnder('shared'),
    ]
    const uploaders = files
      .filter(path => /\/upload\/drive/.test(read(path)))
      .sort()

    expect(uploaders).toEqual([
      'server/utils/google/drive-upload.ts',
      'server/utils/google/drive-write-api.ts',
    ])
  })

  it('looks a retry marker up with one GET on the files endpoint, never a '
    + 'POST, and the tools call that lookup once', async () => {
    const source = read(API_PATH)
    const lookupSource = source.slice(
      source.indexOf('async function findDriveItemsByApprovalDigest'),
      source.indexOf('export interface CreatedDriveItem'),
    )

    expect(source.match(/appProperties has/g)).toHaveLength(1)
    expect(lookupSource).toContain('DRIVE_FILES_URL')
    expect(lookupSource).toContain('method: \'GET\'')
    expect(lookupSource).not.toMatch(
      /method: 'POST'|method: 'PATCH'|DRIVE_UPLOAD_URL|\/upload\//,
    )
    expect(read(TOOLS_PATH).match(/findDriveItemsByApprovalDigest\(/g))
      .toHaveLength(1)

    const calls: Array<{ url: string, method: string | undefined }> = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method })

      return new Response(JSON.stringify({ files: [] }), { status: 200 })
    })

    await findDriveItemsByApprovalDigest('D'.repeat(43), {
      accessToken: 'token',
      fetchImpl,
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]!.method).toBe('GET')
    expect(new URL(calls[0]!.url).pathname).toBe('/drive/v3/files')
  })

  it('sends no id in a converted create and refuses one, and sends an id '
    + 'only for a plain text file', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ id: ITEM_ID }), { status: 200 })
    })
    const base = {
      name: 'Plan',
      content: 'a,b\n',
      parentId: null,
      approvalDigest: 'D'.repeat(43),
    }

    expect(await createDriveFileWithContent(
      { ...base, id: ITEM_ID, kind: 'spreadsheet' },
      { accessToken: 'token', fetchImpl },
    )).toEqual({ ok: false, code: 'bad_request' })
    expect(await createDriveFileWithContent(
      { ...base, id: null, kind: 'text' },
      { accessToken: 'token', fetchImpl },
    )).toEqual({ ok: false, code: 'bad_request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('calls the multipart create from the two create-file paths (a '
    + 'generated id, a converted kind) only, and passes no media type', () => {
    const source = read(TOOLS_PATH)

    expect(source.match(/createDriveFileWithContent\(/g)).toHaveLength(2)
    expect(source).not.toMatch(/uploadMimeType|targetMimeType: |mimeType: '/)
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
    expect(source.match(/googleapis\.com\/upload\/drive/g)).toHaveLength(1)
    expect(source).toContain('\'https://www.googleapis.com/drive/v3/files\'')
    expect(source).toContain(
      '\'https://www.googleapis.com/upload/drive/v3/files\'',
    )
  })

  it('sends supportsAllDrives on every file request it builds', () => {
    const source = read(API_PATH)

    expect(source.match(/supportsAllDrives: 'true'/g)).toHaveLength(7)
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

    expect(importersOf(/google\/drive-write-api'/)).toEqual([
      DOWNLOAD_PATH,
      TOOLS_PATH,
    ])
    expect(importersOf(/google\/drive-write-tools'/)).toEqual([
      'server/utils/tool-approval/google-send-candidates.ts',
    ])
  })

  it('lets the created file download use the metadata read of the Drive '
    + 'write module and nothing else of it', () => {
    const source = read(DOWNLOAD_PATH)

    expect(source).toContain(
      'import { readDriveItemMeta } from '
      + '\'~~/server/utils/google/drive-write-api\'',
    )
    expect(source.match(/drive-write-api'/g)).toHaveLength(1)
    expect(source).not.toMatch(
      /createDriveItem|createDriveFileWithContent|patchDriveItem|method: '(POST|PATCH)'/,
    )
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
      /drive_create_file|drive_create_folder|drive_list_folder|drive_rename|drive_move/,
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
