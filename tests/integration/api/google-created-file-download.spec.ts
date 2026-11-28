import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { GOOGLE_DRIVE_FILE_KIND_SPECS } from '#shared/utils/google-drive-write'
import { GOOGLE_SCOPES } from '#shared/utils/google-scopes'
import {
  GOOGLE_FILE_DOWNLOADS_PER_HOUR,
} from '#shared/utils/google-file-download'
import {
  createMemoryExtractionTestDb,
  seedChat,
  seedMessage,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { createSkillsRouteEvent } from '../../setup/helpers/skills-route'
import type { SkillsRouteEvent } from '../../setup/helpers/skills-route'
import {
  createFakeConnectorKv,
  fakeDecrypt,
  fakeEncrypt,
} from '../../setup/helpers/connectors-oauth'
import type { FakeConnectorKv } from '../../setup/helpers/connectors-oauth'
import {
  GOOGLE_SUBJECT,
  seedGoogleByoAccess,
  useGoogleRuntimeConfig,
} from '../../setup/helpers/google-connections'

const ACCESS_TOKEN = 'byo-access-token-secret'
const DOC_ID = 'document-id-0123456789'
const SHEET_ID = 'spreadsheet-id-0123456789'
const TEXT_ID = 'text-file-id-0123456789'
const FORGED_ID = 'forged-file-id-0123456789'
const OTHER_CHAT_ID = 'other-chat-file-id-01234'
const DOC_TITLE = 'Quarterly plan'
const DOCX_MIME
  = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_MIME
  = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const TEN_MIB = 10 * 1024 * 1024
const DOC_TYPE = GOOGLE_DRIVE_FILE_KIND_SPECS.document.targetMimeType
const SHEET_TYPE = GOOGLE_DRIVE_FILE_KIND_SPECS.spreadsheet.targetMimeType
const TEXT_TYPE = GOOGLE_DRIVE_FILE_KIND_SPECS.text.targetMimeType

const mocks = vi.hoisted(() => ({
  logged: [] as unknown[],
}))

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

vi.mock('nuxt/server', async () => {
  const { connectorsNuxtServerMockFactory } = await import(
    '../../setup/helpers/connectors-oauth'
  )

  return await connectorsNuxtServerMockFactory()
})

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({
    set: (values: unknown) => {
      mocks.logged.push(values)
    },
  }),
}))

type Handler = (event: SkillsRouteEvent) => Promise<Response>

interface FakeDriveItem {
  mimeType: string
  trashed?: boolean
  driveId?: string
}

interface RecordedRequest {
  url: string
  authorization: string | undefined
}

interface FakeDrive {
  fetch: ReturnType<typeof vi.fn>
  requests: RecordedRequest[]
  items: Record<string, FakeDriveItem>
  redirectTo: string | null
  bodySize: number | null
  declaredLength: number | null
  exportStatus: number
  exportReason: string
}

function createFakeDrive(): FakeDrive {
  const requests: RecordedRequest[] = []
  const drive: FakeDrive = {
    fetch: vi.fn(),
    requests,
    items: {
      [DOC_ID]: { mimeType: DOC_TYPE },
      [SHEET_ID]: { mimeType: SHEET_TYPE },
      [TEXT_ID]: { mimeType: TEXT_TYPE },
    },
    redirectTo: null,
    bodySize: null,
    declaredLength: null,
    exportStatus: 200,
    exportReason: '',
  }

  drive.fetch.mockImplementation(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const headers = (init?.headers ?? {}) as Record<string, string>

    requests.push({ url: input, authorization: headers.authorization })

    if (url.hostname === 'lh3.googleusercontent.com') {
      return new Response('REDIRECTED-BYTES')
    }

    const isExport = url.pathname.endsWith('/export')
    const isMedia = url.searchParams.get('alt') === 'media'

    if (!isExport && !isMedia) {
      const id = decodeURIComponent(url.pathname.split('/').at(-1) ?? '')
      const item = drive.items[id]

      return item
        ? new Response(JSON.stringify({
          id,
          name: 'Drive name',
          mimeType: item.mimeType,
          parents: ['parent-id-0123456789'],
          ownedByMe: true,
          shared: false,
          trashed: item.trashed ?? false,
          ...(item.driveId ? { driveId: item.driveId } : {}),
        }))
        : new Response('{}', { status: 404 })
    }

    if (drive.exportStatus !== 200) {
      return new Response(JSON.stringify({
        error: { errors: [{ reason: drive.exportReason }] },
      }), { status: drive.exportStatus })
    }

    if (drive.redirectTo) {
      return new Response(null, {
        status: 302,
        headers: { location: drive.redirectTo },
      })
    }

    const body = drive.bodySize === null
      ? `BYTES:${url.searchParams.get('mimeType') ?? 'media'}`
      : new Uint8Array(drive.bodySize)

    return new Response(body, {
      status: 200,
      headers: drive.declaredLength === null
        ? {}
        : { 'content-length': String(drive.declaredLength) },
    })
  })

  return drive
}

function createdFilePart(input: {
  id: string
  kind: 'document' | 'spreadsheet' | 'text'
  title: string
  toolCallId: string
}) {
  return {
    type: 'tool-google__drive_create_file',
    toolCallId: input.toolCallId,
    state: 'output-available',
    input: { name: input.title, kind: input.kind, content: 'body' },
    output: {
      references: [{
        id: input.id,
        kind: 'file',
        title: input.title,
        link: `https://drive.google.com/open?id=${input.id}`,
      }],
      bodyRemoved: true,
    },
  }
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, message?: string }
  }

  throw new Error('Expected a rejection')
}

describe('GET /api/v1/google/drive/created-files/download', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeConnectorKv
  let drive: FakeDrive
  let userId: number
  let otherUserId: number
  let sessionUserId: number
  let chatSlug: string
  let otherChatSlug: string
  let strangerChatSlug: string
  let restoreGoogleConfig: () => void = () => {}

  async function seedConnection(input: {
    scopes?: string[]
    status?: 'needs_reauth'
  } = {}) {
    const { saveGoogleConnection } = await import(
      '~~/server/utils/google/tokens'
    )

    await saveGoogleConnection(testDb.db, {
      userId,
      clientMode: 'byo',
      subject: GOOGLE_SUBJECT,
      email: 'owner@example.test',
      scopes: input.scopes ?? [
        'openid',
        GOOGLE_SCOPES.drive,
        GOOGLE_SCOPES.driveReadonly,
      ],
      accessToken: ACCESS_TOKEN,
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      refreshToken: 'refresh-stored',
    })

    if (input.status) {
      await testDb.db.update(schema.googleConnections)
        .set({ status: input.status })
        .where(eq(schema.googleConnections.userId, userId))
    }
  }

  async function download(
    query: Record<string, string>,
    partial: Partial<SkillsRouteEvent> = {},
  ) {
    const module = await import(
      '~~/server/api/v1/google/drive/created-files/download.get'
    )
    const event = createSkillsRouteEvent({
      query,
      ...partial,
      headers: {
        'sec-fetch-site': 'same-origin',
        ...partial.headers,
      },
    })
    const response = await (module.default as Handler)(event)

    return { response, event }
  }

  function query(fileId: string, format: string, slug = chatSlug) {
    return { chatSlug: slug, fileId, format }
  }

  function driveRequestsFor(fileId: string) {
    return drive.requests.filter(request => request.url.includes(fileId))
  }

  beforeEach(async () => {
    mocks.logged = []
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
    userId = await seedUser(testDb.db)
    otherUserId = await seedUser(testDb.db)
    sessionUserId = userId
    drive = createFakeDrive()
    restoreGoogleConfig = await useGoogleRuntimeConfig()
    vi.stubGlobal('fetch', drive.fetch)
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useEvent', () => ({ context: {} }))
    vi.stubGlobal('useEncryptText', async (plain: string) => fakeEncrypt(plain))
    vi.stubGlobal('useDecryptText', async (cipher: string) => {
      return fakeDecrypt(cipher)
    })
    vi.stubGlobal('useUserSession', async () => {
      return sessionUserId > 0
        ? { user: { id: String(sessionUserId) } }
        : null
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      return Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    await seedGoogleByoAccess(testDb.db, userId, { gmail: false })
    await seedConnection()

    const chat = await seedChat(testDb.db, userId)
    const otherChat = await seedChat(testDb.db, userId)
    const strangerChat = await seedChat(testDb.db, otherUserId)

    chatSlug = chat.slug
    otherChatSlug = otherChat.slug
    strangerChatSlug = strangerChat.slug

    await seedMessage(testDb.db, chat.id, 'assistant', [
      createdFilePart({
        id: DOC_ID,
        kind: 'document',
        title: DOC_TITLE,
        toolCallId: 'call_doc',
      }),
      createdFilePart({
        id: SHEET_ID,
        kind: 'spreadsheet',
        title: 'Budget',
        toolCallId: 'call_sheet',
      }),
      createdFilePart({
        id: TEXT_ID,
        kind: 'text',
        title: 'notes.md',
        toolCallId: 'call_text',
      }),
    ], new Date('2026-10-25T10:00:00.000Z'))
    await seedMessage(testDb.db, chat.id, 'user', [
      createdFilePart({
        id: FORGED_ID,
        kind: 'document',
        title: 'Forged',
        toolCallId: 'call_forged',
      }),
    ], new Date('2026-10-25T10:01:00.000Z'))
    await seedMessage(testDb.db, otherChat.id, 'assistant', [
      createdFilePart({
        id: OTHER_CHAT_ID,
        kind: 'document',
        title: 'Elsewhere',
        toolCallId: 'call_other',
      }),
    ], new Date('2026-10-25T10:02:00.000Z'))
    await seedMessage(testDb.db, strangerChat.id, 'assistant', [
      createdFilePart({
        id: 'stranger-file-id-0123456',
        kind: 'document',
        title: 'Stranger',
        toolCallId: 'call_stranger',
      }),
    ], new Date('2026-10-25T10:03:00.000Z'))
  })

  afterEach(() => {
    restoreGoogleConfig()
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('the allowed formats', () => {
    it('exports a document as DOCX with an attachment name', async () => {
      const { response } = await download(query(DOC_ID, 'docx'))

      expect(response.headers.get('content-type')).toBe(DOCX_MIME)
      expect(response.headers.get('content-disposition')).toBe(
        'attachment; filename="Quarterly plan.docx"; '
        + 'filename*=UTF-8\'\'Quarterly%20plan.docx',
      )
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect(response.headers.get('cache-control'))
        .toBe('private, no-store')
      expect(await response.text()).toBe(`BYTES:${DOCX_MIME}`)

      const exportRequest = drive.requests.find((request) => {
        return request.url.includes('/export')
      })

      expect(new URL(exportRequest!.url).searchParams.get('mimeType'))
        .toBe(DOCX_MIME)
      expect(exportRequest!.authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    })

    it('exports a document as text', async () => {
      const { response } = await download(query(DOC_ID, 'txt'))

      expect(response.headers.get('content-type'))
        .toBe('text/plain; charset=utf-8')
      expect(response.headers.get('content-disposition'))
        .toContain('filename="Quarterly plan.txt"')
      expect(await response.text()).toBe('BYTES:text/plain')
    })

    it('exports a spreadsheet as XLSX', async () => {
      const { response } = await download(query(SHEET_ID, 'xlsx'))

      expect(response.headers.get('content-type')).toBe(XLSX_MIME)
      expect(response.headers.get('content-disposition'))
        .toContain('filename="Budget.xlsx"')
      expect(await response.text()).toBe(`BYTES:${XLSX_MIME}`)
    })

    it('exports the first sheet as CSV', async () => {
      const { response } = await download(query(SHEET_ID, 'csv'))

      expect(response.headers.get('content-type'))
        .toBe('text/csv; charset=utf-8')
      expect(response.headers.get('content-disposition'))
        .toContain('filename="Budget.csv"')
      expect(await response.text()).toBe('BYTES:text/csv')
    })

    it('reads a text file raw, without an export, keeping its extension',
      async () => {
        const { response } = await download(query(TEXT_ID, 'txt'))

        expect(response.headers.get('content-type'))
          .toBe('text/plain; charset=utf-8')
        expect(response.headers.get('content-disposition'))
          .toContain('filename="notes.md"')
        expect(await response.text()).toBe('BYTES:media')
        expect(drive.requests.some((request) => {
          return request.url.includes('/export')
        })).toBe(false)
        expect(driveRequestsFor(TEXT_ID).some((request) => {
          return request.url.includes('alt=media')
        })).toBe(true)
      })

    it('sets the byte count as the length and stores nothing', async () => {
      const { response } = await download(query(DOC_ID, 'docx'))
      const bytes = await response.arrayBuffer()

      expect(response.headers.get('content-length'))
        .toBe(String(bytes.byteLength))

      const files = await testDb.db.select({ id: schema.files.id })
        .from(schema.files)

      expect(files).toEqual([])
    })
  })

  describe('what may be downloaded', () => {
    it.each([
      ['a spreadsheet format for a document', DOC_ID, 'xlsx'],
      ['a document format for a spreadsheet', SHEET_ID, 'docx'],
      ['CSV for a document', DOC_ID, 'csv'],
      ['DOCX for a text file', TEXT_ID, 'docx'],
    ])('answers 400 for %s before any Drive call', async (
      _name,
      fileId,
      format,
    ) => {
      expect((await failureOf(download(query(fileId, format)))).status)
        .toBe(400)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it.each([
      ['an id no tool created', 'unknown-file-id-0123456789'],
      ['an id created in another chat', OTHER_CHAT_ID],
      ['an id that only a user message names', FORGED_ID],
    ])('answers 404 for %s', async (_name, fileId) => {
      expect((await failureOf(download(query(fileId, 'docx')))).status)
        .toBe(404)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('answers 404 for another user\'s chat, even for a real id', async () => {
      const failure = await failureOf(
        download(query(DOC_ID, 'docx', strangerChatSlug)),
      )

      expect(failure.status).toBe(404)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('finds a file only in the chat that created it', async () => {
      const failure = await failureOf(
        download(query(DOC_ID, 'docx', otherChatSlug)),
      )

      expect(failure.status).toBe(404)
    })

    it.each([
      ['a name', { name: 'Evil' }],
      ['a kind', { kind: 'text' }],
      ['a mime type', { mimeType: 'text/html' }],
    ])('refuses %s in the query', async (_name, extra) => {
      const failure = await failureOf(
        download({ ...query(DOC_ID, 'docx'), ...extra }),
      )

      expect(failure.status).toBe(400)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it.each([
      ['a chat slug that is not a ULID', { chatSlug: 'abc' }],
      ['a file id of the wrong shape', { fileId: 'short' }],
      ['a path in the file id', { fileId: '../../etc/passwd-0123' }],
      ['an unknown format', { format: 'pdf' }],
    ])('answers 400 for %s', async (_name, override) => {
      const failure = await failureOf(
        download({ ...query(DOC_ID, 'docx'), ...override }),
      )

      expect(failure.status).toBe(400)
      expect(drive.fetch).not.toHaveBeenCalled()
    })
  })

  describe('the live file in Google Drive', () => {
    it('refuses a file in the trash', async () => {
      drive.items[DOC_ID] = { mimeType: DOC_TYPE, trashed: true }

      expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
        .toBe(404)
      expect(drive.requests.some((request) => {
        return request.url.includes('/export')
      })).toBe(false)
    })

    it('refuses a file that moved to a shared drive', async () => {
      drive.items[DOC_ID] = { mimeType: DOC_TYPE, driveId: 'shared-drive-1' }

      expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
        .toBe(409)
    })

    it('refuses a file that is no longer the kind that was created',
      async () => {
        drive.items[DOC_ID] = { mimeType: SHEET_TYPE }

        expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
          .toBe(409)
        expect(drive.requests.some((request) => {
          return request.url.includes('/export')
        })).toBe(false)
      })

    it('answers 404 for a file Drive cannot find', async () => {
      Reflect.deleteProperty(drive.items, DOC_ID)

      expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
        .toBe(404)
    })

    it('answers 413 when Drive says the export is too large', async () => {
      drive.exportStatus = 403
      drive.exportReason = 'exportSizeLimitExceeded'

      expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
        .toBe(413)
    })

    it('answers 413 when the declared length is over 10 MB', async () => {
      drive.declaredLength = TEN_MIB + 1

      expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
        .toBe(413)
    })

    it('stops a body over 10 MB that declares no length', async () => {
      drive.bodySize = TEN_MIB + 1

      expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
        .toBe(413)
    })

    it('allows a body of exactly 10 MB', async () => {
      drive.bodySize = TEN_MIB

      const { response } = await download(query(DOC_ID, 'docx'))

      expect((await response.arrayBuffer()).byteLength).toBe(TEN_MIB)
    })

    it('refuses a redirect to a host that is not allowed', async () => {
      drive.redirectTo = 'https://evil.example/file'

      expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
        .toBe(502)
      expect(drive.requests.some((request) => {
        return request.url.startsWith('https://evil.example')
      })).toBe(false)
    })

    it('follows one hop to a googleusercontent host without the token',
      async () => {
        drive.redirectTo = 'https://lh3.googleusercontent.com/file'

        const { response } = await download(query(DOC_ID, 'docx'))
        const hop = drive.requests.at(-1)!

        expect(await response.text()).toBe('REDIRECTED-BYTES')
        expect(hop.url).toBe('https://lh3.googleusercontent.com/file')
        expect(hop.authorization).toBeUndefined()
      })

    it.each([
      [401, '', 409],
      [403, 'forbidden', 403],
      [429, 'rateLimitExceeded', 429],
      [500, '', 502],
    ])('maps a Drive answer of %s (%s) to %s', async (
      status,
      reason,
      expected,
    ) => {
      drive.exportStatus = status
      drive.exportReason = reason

      expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
        .toBe(expected)
    })
  })

  describe('gates', () => {
    it('refuses a signed-out request', async () => {
      sessionUserId = 0

      expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
        .toBe(401)
    })

    it('refuses a cross-site request', async () => {
      const failure = await failureOf(download(query(DOC_ID, 'docx'), {
        headers: { 'sec-fetch-site': 'cross-site' },
      }))

      expect(failure.status).toBe(403)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('answers 404 for an admin whose own client flag is off', async () => {
      await testDb.db.delete(schema.featureOptIns)

      expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
        .toBe(404)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('answers 404 for a user who is not an admin', async () => {
      await testDb.db.delete(schema.userRoles)

      expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
        .toBe(404)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('answers 404 without an own client connection', async () => {
      await testDb.db.delete(schema.googleConnections)

      expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
        .toBe(404)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('answers 409 when the connection needs to be reconnected',
      async () => {
        await testDb.db.update(schema.googleConnections)
          .set({ status: 'needs_reauth' })

        expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
          .toBe(409)
        expect(drive.fetch).not.toHaveBeenCalled()
      })

    it('answers 409 when Drive read access is missing', async () => {
      await testDb.db.delete(schema.googleConnections)
      await seedConnection({ scopes: ['openid', GOOGLE_SCOPES.drive] })

      expect((await failureOf(download(query(DOC_ID, 'docx')))).status)
        .toBe(409)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('answers 429 after 30 downloads an hour', async () => {
      for (let count = 0; count < GOOGLE_FILE_DOWNLOADS_PER_HOUR; count++) {
        await download(query(TEXT_ID, 'txt'))
      }

      const failure = await failureOf(download(query(TEXT_ID, 'txt')))

      expect(failure.status).toBe(429)
    })

    it('counts a refused request but not another user\'s budget',
      async () => {
        expect(GOOGLE_FILE_DOWNLOADS_PER_HOUR).toBe(30)

        await failureOf(download(query('unknown-file-id-0123456789', 'txt')))

        const keys = [...kv.values.keys()].filter((key) => {
          return key.startsWith('google-file-download-rate-limit:')
        })

        expect(keys).toEqual([
          `google-file-download-rate-limit:${userId}`,
        ])
      })
  })

  describe('what is logged', () => {
    it('records kind, format, bytes and outcome, and nothing else', async () => {
      await download(query(DOC_ID, 'docx'))

      const logged = JSON.stringify(mocks.logged)

      expect(logged).toContain('googleCreatedFileDownload')
      expect(logged).toContain('"kind":"document"')
      expect(logged).toContain('"format":"docx"')
      expect(logged).toContain('"outcome":"ok"')
      expect(logged).toContain(`"bytes":${`BYTES:${DOCX_MIME}`.length}`)
      expect(logged).not.toContain(DOC_TITLE)
      expect(logged).not.toContain(ACCESS_TOKEN)
      expect(logged).not.toContain(DOC_ID)
    })

    it('records the status of a refusal without a name or a message', async () => {
      drive.items[DOC_ID] = { mimeType: DOC_TYPE, trashed: true }

      await failureOf(download(query(DOC_ID, 'docx')))

      const logged = JSON.stringify(mocks.logged)

      expect(logged).toContain('"outcome":"refused"')
      expect(logged).toContain('"status":404')
      expect(logged).not.toContain(DOC_TITLE)
      expect(logged).not.toContain(ACCESS_TOKEN)
    })
  })
})
