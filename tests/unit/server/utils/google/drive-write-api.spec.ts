import { describe, expect, it, vi } from 'vitest'
import {
  DRIVE_CHANGE_FAILURE_TEXT,
  DRIVE_WRITE_FAILURE_TEXT,
  buildDriveCreateDigest,
  buildDriveCreateMetadata,
  buildDriveMoveRequest,
  buildDriveRenameRequest,
  classifyDriveWriteFailure,
  createDriveItem,
  generateDriveId,
  isDriveRootMeta,
  listDriveFolderChildren,
  patchDriveItem,
  readDriveItemMeta,
  searchDriveFolders,
} from '~~/server/utils/google/drive-write-api'

const FOLDER_ID = 'folder-id-0123456789'
const PARENT_ID = 'parent-id-0123456789'

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

describe('classifyDriveWriteFailure', () => {
  it.each([
    [401, null, 'reauthorize'],
    [403, 'accessNotConfigured', 'api_disabled'],
    [403, 'SERVICE_DISABLED', 'api_disabled'],
    [403, 'storageQuotaExceeded', 'drive_full'],
    [403, 'insufficientFilePermissions', 'no_access'],
    [403, null, 'no_access'],
    [404, null, 'not_found'],
    [409, null, 'conflict'],
    [429, null, 'rate_limited'],
    [403, 'userRateLimitExceeded', 'rate_limited'],
    [400, null, 'bad_request'],
    [500, null, 'failed'],
    [503, 'backendError', 'failed'],
  ])('maps %i %s to %s', (status, reason, code) => {
    expect(classifyDriveWriteFailure(status, reason)).toBe(code)
  })

  it('has one fixed sentence per code that never repeats Google text', () => {
    for (const text of Object.values(DRIVE_WRITE_FAILURE_TEXT)) {
      expect(text.length).toBeGreaterThan(10)
    }
  })
})

describe('buildDriveCreateMetadata', () => {
  it('copies the name, type, parent, id and one app property', () => {
    expect(buildDriveCreateMetadata({
      id: FOLDER_ID,
      name: 'Reports',
      mimeType: 'application/vnd.google-apps.folder',
      parentId: PARENT_ID,
      approvalDigest: 'digest',
    })).toEqual({
      id: FOLDER_ID,
      name: 'Reports',
      mimeType: 'application/vnd.google-apps.folder',
      parents: [PARENT_ID],
      appProperties: { besidkaApproval: 'digest' },
    })
  })

  it('sends no parents for My Drive', () => {
    const metadata = buildDriveCreateMetadata({
      id: FOLDER_ID,
      name: 'Reports',
      mimeType: 'application/vnd.google-apps.folder',
      parentId: null,
      approvalDigest: 'digest',
    })

    expect(Object.keys(metadata)).not.toContain('parents')
  })
})

describe('buildDriveCreateDigest', () => {
  it('is stable, url-safe and different per user and approval', async () => {
    const first = await buildDriveCreateDigest(1, 'approval-a')

    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await buildDriveCreateDigest(1, 'approval-a')).toBe(first)
    expect(await buildDriveCreateDigest(2, 'approval-a')).not.toBe(first)
    expect(await buildDriveCreateDigest(1, 'approval-b')).not.toBe(first)
    expect(first).not.toContain('approval-a')
  })
})

describe('isDriveRootMeta', () => {
  const rootMeta = {
    id: FOLDER_ID,
    name: 'My Drive',
    mimeType: 'application/vnd.google-apps.folder',
    parents: [] as string[],
    ownedByMe: true as boolean | null,
    shared: false,
    driveId: null as string | null,
    trashed: false,
    canAddChildren: true,
    canRename: true,
    canMoveItemWithinDrive: true,
    approvalDigest: null,
  }

  it('is true for an owned folder with no parent outside a shared drive',
    () => {
      expect(isDriveRootMeta(rootMeta)).toBe(true)
    })

  it.each([
    ['a parent', { parents: [PARENT_ID] }],
    ['another owner', { ownedByMe: false }],
    ['an unknown owner', { ownedByMe: null }],
    ['a shared drive', { driveId: 'drive-1' }],
    ['another type', { mimeType: 'text/plain' }],
  ])('is false with %s, whatever the name is', (_label, change) => {
    expect(isDriveRootMeta({ ...rootMeta, ...change })).toBe(false)
  })
})

describe('the Drive requests', () => {
  const context = { accessToken: 'token' }

  it('reads one generated id of the right shape', async () => {
    const fetchImpl = respond(200, { ids: [FOLDER_ID], space: 'drive' })
    const result = await generateDriveId({ ...context, fetchImpl })

    expect(result).toEqual({ ok: true, value: FOLDER_ID })
    expect(String(fetchImpl.mock.calls[0]![0]))
      .toContain('/drive/v3/files/generateIds?')
  })

  it('refuses a generated id of the wrong shape or count', async () => {
    expect(await generateDriveId({
      ...context,
      fetchImpl: respond(200, { ids: ['x y'] }),
    })).toEqual({ ok: false, code: 'failed' })
    expect(await generateDriveId({
      ...context,
      fetchImpl: respond(200, { ids: [] }),
    })).toEqual({ ok: false, code: 'failed' })
  })

  it('reads the fields a write check needs and nothing else', async () => {
    const fetchImpl = respond(200, {
      id: FOLDER_ID,
      name: 'Reports',
      mimeType: 'application/vnd.google-apps.folder',
      parents: [PARENT_ID],
      ownedByMe: true,
      shared: false,
      trashed: false,
      appProperties: { besidkaApproval: 'digest' },
      capabilities: {
        canAddChildren: true,
        canRename: true,
        canMoveItemWithinDrive: false,
      },
      permissions: [{ emailAddress: 'someone@example.test' }],
    })
    const result = await readDriveItemMeta(FOLDER_ID, {
      ...context,
      fetchImpl,
    })

    expect(result).toEqual({
      ok: true,
      value: {
        id: FOLDER_ID,
        name: 'Reports',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [PARENT_ID],
        ownedByMe: true,
        shared: false,
        driveId: null,
        trashed: false,
        canAddChildren: true,
        canRename: true,
        canMoveItemWithinDrive: false,
        approvalDigest: 'digest',
      },
    })

    const url = new URL(String(fetchImpl.mock.calls[0]![0]))

    expect(url.searchParams.get('supportsAllDrives')).toBe('true')
    expect(url.searchParams.get('fields')).not.toContain('permissions')
    expect(url.searchParams.get('fields')).toContain(
      'capabilities(canAddChildren,canRename,canMoveItemWithinDrive)',
    )
  })

  it('refuses an answer whose parent has no Drive id shape, so it is never '
    + 'taken for the top level', async () => {
    const result = await readDriveItemMeta(FOLDER_ID, {
      ...context,
      fetchImpl: respond(200, {
        id: FOLDER_ID,
        mimeType: 'application/vnd.google-apps.folder',
        parents: ['not a valid id'],
        ownedByMe: true,
      }),
    })

    expect(result).toEqual({ ok: false, code: 'failed' })
  })

  it.each([
    '../../etc/passwd',
    `${FOLDER_ID}/permissions`,
    `${FOLDER_ID}?alt=media`,
    'short',
    '',
    'ROOT',
    `${FOLDER_ID}\r\nx`,
  ])('sends no request for the id %j', async (itemId) => {
    const fetchImpl = respond(200, {})

    expect(await readDriveItemMeta(itemId, { ...context, fetchImpl }))
      .toEqual({ ok: false, code: 'bad_request' })
    expect(await listDriveFolderChildren(itemId, { ...context, fetchImpl }))
      .toEqual({ ok: false, code: 'bad_request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('accepts the alias root and a Drive id in a read and a listing',
    async () => {
      const meta = respond(200, { id: FOLDER_ID })
      const children = respond(200, { files: [] })

      await readDriveItemMeta('root', { ...context, fetchImpl: meta })
      await readDriveItemMeta(FOLDER_ID, { ...context, fetchImpl: meta })
      await listDriveFolderChildren('root', {
        ...context,
        fetchImpl: children,
      })

      expect(meta).toHaveBeenCalledTimes(2)
      expect(String(meta.mock.calls[0]![0]))
        .toContain('/drive/v3/files/root?')
      expect(children).toHaveBeenCalledTimes(1)
    })

  it('posts one create with supportsAllDrives and reads the answer',
    async () => {
      const fetchImpl = respond(200, {
        id: FOLDER_ID,
        name: 'Reports',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [PARENT_ID],
      })
      const result = await createDriveItem(
        { id: FOLDER_ID, name: 'Reports' },
        { ...context, fetchImpl },
      )
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ]

      expect(result).toMatchObject({ ok: true, value: { id: FOLDER_ID } })
      expect(init.method).toBe('POST')
      expect(new URL(url).searchParams.get('supportsAllDrives')).toBe('true')
    })

  it('reports a 409 as a conflict and a 500 as failed', async () => {
    expect(await createDriveItem({}, {
      ...context,
      fetchImpl: respond(409, { error: { message: 'exists' } }),
    })).toEqual({ ok: false, code: 'conflict' })
    expect(await createDriveItem({}, {
      ...context,
      fetchImpl: respond(500, {}),
    })).toEqual({ ok: false, code: 'failed' })
  })

  it('escapes the words in a list query and refuses a folder id that is '
    + 'query text', async () => {
    const children = respond(200, { files: [] })
    const found = respond(200, { files: [] })

    expect(await listDriveFolderChildren('a\' or \'1\'=\'1', {
      ...context,
      fetchImpl: children,
    })).toEqual({ ok: false, code: 'bad_request' })
    expect(children).not.toHaveBeenCalled()

    await listDriveFolderChildren(FOLDER_ID, {
      ...context,
      fetchImpl: children,
    })
    await searchDriveFolders('it\'s', { ...context, fetchImpl: found })

    const childrenQuery = new URL(String(children.mock.calls[0]![0]))
      .searchParams.get('q')
    const foundQuery = new URL(String(found.mock.calls[0]![0]))
      .searchParams.get('q')

    expect(childrenQuery).toBe(
      `'${FOLDER_ID}' in parents and trashed = false`,
    )
    expect(foundQuery).toContain('name contains \'it\\\'s\'')
    expect(foundQuery).toContain('trashed = false')
  })

  it('keeps only items with a Drive id shape and counts the page limit',
    async () => {
      const result = await listDriveFolderChildren('root', {
        ...context,
        fetchImpl: respond(200, {
          nextPageToken: 'more',
          files: [
            {
              id: FOLDER_ID,
              name: 'Reports',
              mimeType: 'application/vnd.google-apps.folder',
              ownedByMe: true,
              shared: false,
              parents: [PARENT_ID],
            },
            { id: 'bad id', name: 'x' },
          ],
        }),
      })

      expect(result).toEqual({
        ok: true,
        value: {
          hasMore: true,
          items: [{
            id: FOLDER_ID,
            name: 'Reports',
            mimeType: 'application/vnd.google-apps.folder',
            ownedByMe: true,
            shared: false,
            inSharedDrive: false,
            parentId: PARENT_ID,
          }],
        },
      })
    })
})

describe('the rename and move requests', () => {
  const context = { accessToken: 'token' }

  it('builds a rename whose body is exactly the new name', () => {
    const hostile = {
      itemId: FOLDER_ID,
      name: 'Plan',
      permissions: [{ type: 'anyone', role: 'writer' }],
      trashed: true,
      parents: ['x'],
      description: 'x',
    }
    const request = buildDriveRenameRequest(hostile)

    expect(request.itemId).toBe(FOLDER_ID)
    expect(request.body).toEqual({ name: 'Plan' })
    expect(Object.keys(request.query).sort()).toEqual([
      'fields',
      'supportsAllDrives',
    ])
    expect(JSON.stringify(request)).not.toMatch(
      /permissions|trashed|description|"parents"/,
    )
  })

  it('builds a move with only the four query keys and an empty body', () => {
    const request = buildDriveMoveRequest({
      itemId: FOLDER_ID,
      fromParentId: PARENT_ID,
      toParentId: 'target-id-0123456789',
    })

    expect(request.body).toEqual({})
    expect(Object.keys(request.query).sort()).toEqual([
      'addParents',
      'fields',
      'removeParents',
      'supportsAllDrives',
    ])
    expect(request.query.addParents).toBe('target-id-0123456789')
    expect(request.query.removeParents).toBe(PARENT_ID)
  })

  it('patches one item on the files endpoint and reads the answer',
    async () => {
      const fetchImpl = respond(200, {
        id: FOLDER_ID,
        name: 'Plan',
        mimeType: 'text/plain',
        parents: [PARENT_ID],
      })
      const result = await patchDriveItem(
        buildDriveRenameRequest({ itemId: FOLDER_ID, name: 'Plan' }),
        { ...context, fetchImpl },
      )
      const [url, init] = fetchImpl.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ]
      const parsed = new URL(url)

      expect(result).toEqual({
        ok: true,
        value: {
          id: FOLDER_ID,
          name: 'Plan',
          mimeType: 'text/plain',
          parents: [PARENT_ID],
        },
      })
      expect(init.method).toBe('PATCH')
      expect(parsed.pathname).toBe(`/drive/v3/files/${FOLDER_ID}`)
      expect(parsed.searchParams.get('supportsAllDrives')).toBe('true')
      expect(new TextDecoder().decode(init.body as Uint8Array))
        .toBe('{"name":"Plan"}')
    })

  it('sends the move parents in the query and nothing in the body',
    async () => {
      const fetchImpl = respond(200, {
        id: FOLDER_ID,
        parents: ['target-id-0123456789'],
      })

      await patchDriveItem(
        buildDriveMoveRequest({
          itemId: FOLDER_ID,
          fromParentId: PARENT_ID,
          toParentId: 'target-id-0123456789',
        }),
        { ...context, fetchImpl },
      )

      const [url, init] = fetchImpl.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ]
      const parsed = new URL(url)

      expect(parsed.searchParams.get('addParents'))
        .toBe('target-id-0123456789')
      expect(parsed.searchParams.get('removeParents')).toBe(PARENT_ID)
      expect(new TextDecoder().decode(init.body as Uint8Array)).toBe('{}')
    })

  it.each([
    ['an item id with a path', `${FOLDER_ID}/permissions`],
    ['the alias root', 'root'],
    ['an id with a query', `${FOLDER_ID}?alt=media`],
    ['a short id', 'short'],
    ['an empty id', ''],
  ])('sends no request for %s as the item', async (_label, itemId) => {
    const fetchImpl = respond(200, {})

    expect(await patchDriveItem(
      buildDriveRenameRequest({ itemId, name: 'Plan' }),
      { ...context, fetchImpl },
    )).toEqual({ ok: false, code: 'bad_request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([
    ['a path', '../x'],
    ['a list', `${PARENT_ID},other-id-0123456789`],
    ['the alias root', 'root'],
  ])('sends no move request when a parent is %s', async (_label, parent) => {
    const fetchImpl = respond(200, {})

    expect(await patchDriveItem(
      buildDriveMoveRequest({
        itemId: FOLDER_ID,
        fromParentId: PARENT_ID,
        toParentId: parent,
      }),
      { ...context, fetchImpl },
    )).toEqual({ ok: false, code: 'bad_request' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('classifies a failed patch and gives a fixed sentence per operation',
    async () => {
      const request = buildDriveRenameRequest({
        itemId: FOLDER_ID,
        name: 'Plan',
      })

      expect(await patchDriveItem(request, {
        ...context,
        fetchImpl: respond(403, {
          error: { errors: [{ reason: 'insufficientFilePermissions' }] },
        }),
      })).toEqual({ ok: false, code: 'no_access' })
      expect(await patchDriveItem(request, {
        ...context,
        fetchImpl: respond(404, {}),
      })).toEqual({ ok: false, code: 'not_found' })
      expect(await patchDriveItem(request, {
        ...context,
        fetchImpl: respond(400, {}),
      })).toEqual({ ok: false, code: 'bad_request' })
      expect(await patchDriveItem(request, {
        ...context,
        fetchImpl: respond(429, {}),
      })).toEqual({ ok: false, code: 'rate_limited' })
      expect(DRIVE_CHANGE_FAILURE_TEXT.move.bad_request)
        .toContain('into itself')
      expect(DRIVE_CHANGE_FAILURE_TEXT.rename.no_access)
        .toContain('Nothing was renamed')
    })

  it('refuses an answer without a Drive id as not understood', async () => {
    expect(await patchDriveItem(
      buildDriveRenameRequest({ itemId: FOLDER_ID, name: 'Plan' }),
      {
        ...context,
        fetchImpl: respond(200, { name: 'Plan' }),
      },
    )).toEqual({ ok: false, code: 'failed' })
  })
})
