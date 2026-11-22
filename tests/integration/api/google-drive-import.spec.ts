import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  GOOGLE_DRIVE_EXPORT_MAX_BYTES,
  GOOGLE_DRIVE_FILE_MAX_BYTES,
} from '#shared/utils/google-drive'
import { isGoogleWorkbookMapFile } from '#shared/utils/google-sheets'
import {
  SHEET_IDS,
  estimateGridAnswers,
  estimateMetadata,
  gridAnswer,
} from '../../fixtures/google/sheets-estimate'
import {
  createMemoryExtractionTestDb,
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
  DRIVE_FILE_SCOPE,
  GOOGLE_SUBJECT,
  useGoogleRuntimeConfig,
} from '../../setup/helpers/google-connections'

const ORIGIN = 'https://besidka.com'
const MEBIBYTE = 1024 * 1024
const DOC_ID = '1DocDocDocDocDocDocDocDocDocDoc01'
const SHEET_ID = '1SheetSheetSheetSheetSheetSheet02'
const SLIDES_ID = '1SlidesSlidesSlidesSlidesSlides03'
const PDF_ID = '1PdfPdfPdfPdfPdfPdfPdfPdfPdfPdf04'
const PNG_ID = '1PngPngPngPngPngPngPngPngPngPng05'
const FOLDER_ID = '1FolderFolderFolderFolderFolder06'
const FORM_ID = '1FormFormFormFormFormFormFormFo07'
const ZIP_ID = '1ZipZipZipZipZipZipZipZipZipZip08'
const LOCKED_ID = '1LockedLockedLockedLockedLocked09'
const BIG_ID = '1BigBigBigBigBigBigBigBigBigBig10'
const MISSING_ID = '1MissingMissingMissingMissing1'
const SECRET_NAME = 'Secret acquisition plan'

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(['google.drive']),
  logged: [] as unknown[],
  usedBytes: 0,
  maxStorageBytes: 100 * 1024 * 1024,
  itemTokenCalls: 0,
  itemTokensAllowed: Number.POSITIVE_INFINITY,
}))

vi.mock('~~/server/utils/google/tokens', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/google/tokens')
  >()

  return {
    ...actual,
    getGoogleAccessToken: vi.fn(async (
      ...args: Parameters<typeof actual.getGoogleAccessToken>
    ) => {
      mocks.itemTokenCalls++

      if (mocks.itemTokenCalls > mocks.itemTokensAllowed) {
        throw Object.assign(new Error('Google did not refresh'), {
          status: 502,
        })
      }

      return await actual.getGoogleAccessToken(...args)
    }),
  }
})

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

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/files/file-governance', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/files/file-governance')
  >()

  return {
    ...actual,
    getEffectiveUserFilePolicy: vi.fn(async () => ({
      tier: 'free',
      maxStorageBytes: mocks.maxStorageBytes,
      maxFilesPerMessage: 10,
      maxMessageFilesBytes: 1000 * 1024 * 1024,
      fileRetentionDays: 30,
      imageTransformLimitTotal: 0,
      imageTransformUsedTotal: 0,
    })),
    getUserStorageUsageBytes: vi.fn(async () => mocks.usedBytes),
  }
})

vi.mock('~~/server/utils/features/guards', () => ({
  requireFeature: async (_event: unknown, flag: string) => {
    if (!mocks.flags.has(flag)) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }

    return { active: true }
  },
}))

vi.mock('~~/server/utils/features/context', () => ({
  evaluateFeatureForEvent: async (_event: unknown, flag: string) => {
    const isOn = mocks.flags.has(flag)

    return { value: isOn, active: isOn }
  },
}))

vi.mock('~~/server/utils/request-public-origin', () => ({
  resolveRequestPublicOrigin: () => 'https://besidka.com',
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({
    set: (values: unknown) => {
      mocks.logged.push(values)
    },
  }),
}))

type Handler = (event: SkillsRouteEvent) => Promise<any>
type BodySource = string | Uint8Array | (() => ReadableStream<Uint8Array>)

type FakeSheets
  = | { structure: object, grids: Record<string, BodySource | object> }
    | { refuse: Response }

interface FakeDriveFile {
  metadata: Record<string, unknown>
  media?: BodySource
  mediaRedirect?: string
  exports?: Record<string, BodySource | { status: number, reason: string }>
  sheets?: FakeSheets
}

interface FakeDriveRequest {
  kind: 'metadata' | 'export' | 'media' | 'content' | 'sheets'
  url: string
  headers: Record<string, string>
}

function sheetsRefusal(
  status: number,
  googleStatus: string,
  reason?: string,
): FakeSheets {
  return {
    refuse: new Response(JSON.stringify({
      error: {
        code: status,
        status: googleStatus,
        message: 'Free text from Google',
        ...(reason ? { details: [{ reason }] } : {}),
      },
    }), { status }),
  }
}

function toBody(source: BodySource): BodyInit {
  if (typeof source === 'function') {
    return source()
  }

  return source as BodyInit
}

function endlessStream(chunkBytes: number) {
  return () => new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(chunkBytes))
    },
  })
}

function readHeaders(init: RequestInit | undefined) {
  return Object.fromEntries(Object.entries(
    (init?.headers ?? {}) as Record<string, string>,
  ).map(([name, value]) => [name.toLowerCase(), value]))
}

function createFakeDrive(files: Record<string, FakeDriveFile>) {
  const requests: FakeDriveRequest[] = []
  const contentByUrl = new Map<string, BodySource>()
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const headers = readHeaders(init)

    if (url.hostname.endsWith('.googleusercontent.com')) {
      requests.push({ kind: 'content', url: input, headers })

      const content = contentByUrl.get(input)

      return content
        ? new Response(toBody(content))
        : new Response('missing', { status: 404 })
    }

    if (url.hostname === 'sheets.googleapis.com') {
      requests.push({ kind: 'sheets', url: input, headers })

      const sheets = files[url.pathname.split('/').pop() ?? '']?.sheets

      if (!sheets) {
        return new Response(JSON.stringify({
          error: { code: 403, status: 'PERMISSION_DENIED' },
        }), { status: 403 })
      }

      if ('refuse' in sheets) {
        return sheets.refuse.clone()
      }

      const range = url.searchParams.get('ranges')

      if (!range) {
        return new Response(JSON.stringify(sheets.structure))
      }

      const grid = sheets.grids[range.split('!')[0] as string]

      return typeof grid === 'object' && !(grid instanceof Uint8Array)
        ? new Response(JSON.stringify(grid))
        : new Response(toBody(grid as BodySource))
    }

    const match = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)(\/export)?$/)
    const file = match ? files[match[1]!] : undefined
    const notFound = new Response(JSON.stringify({
      error: { errors: [{ reason: 'notFound' }] },
    }), { status: 404 })

    if (!match || !file) {
      requests.push({ kind: 'metadata', url: input, headers })

      return notFound
    }

    if (match[2]) {
      requests.push({ kind: 'export', url: input, headers })

      const exported = file.exports?.[url.searchParams.get('mimeType') ?? '']

      if (!exported) {
        return new Response(JSON.stringify({
          error: { errors: [{ reason: 'badRequest' }] },
        }), { status: 400 })
      }

      if (typeof exported === 'object' && 'reason' in exported) {
        return new Response(JSON.stringify({
          error: { errors: [{ reason: exported.reason }] },
        }), { status: exported.status })
      }

      return new Response(toBody(exported))
    }

    if (url.searchParams.get('alt') === 'media') {
      requests.push({ kind: 'media', url: input, headers })

      if (file.mediaRedirect) {
        return new Response(null, {
          status: 302,
          headers: { location: file.mediaRedirect },
        })
      }

      return file.media === undefined
        ? notFound
        : new Response(toBody(file.media))
    }

    requests.push({ kind: 'metadata', url: input, headers })

    return new Response(JSON.stringify(file.metadata))
  })

  return {
    fetch,
    requests,
    serveContent(url: string, content: BodySource) {
      contentByUrl.set(url, content)
    },
    ofKind: (kind: FakeDriveRequest['kind']) => {
      return requests.filter(request => request.kind === kind)
    },
  }
}

type FakeDrive = ReturnType<typeof createFakeDrive>

function metadata(
  id: string,
  mimeType: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    name: SECRET_NAME,
    mimeType,
    modifiedTime: '2026-11-20T10:00:00.000Z',
    version: '3',
    capabilities: { canDownload: true },
    ...extra,
  }
}

function standardFiles(): Record<string, FakeDriveFile> {
  return {
    [DOC_ID]: {
      metadata: metadata(DOC_ID, 'application/vnd.google-apps.document'),
      exports: { 'text/markdown': '# Plan\n\nBody' },
    },
    [SHEET_ID]: {
      metadata: metadata(
        SHEET_ID,
        'application/vnd.google-apps.spreadsheet',
        { name: 'Budget' },
      ),
      exports: { 'text/csv': 'a,b\n1,2\n' },
    },
    [SLIDES_ID]: {
      metadata: metadata(
        SLIDES_ID,
        'application/vnd.google-apps.presentation',
        { name: 'Deck' },
      ),
      exports: { 'text/plain': 'Slide one' },
    },
    [PDF_ID]: {
      metadata: metadata(PDF_ID, 'application/pdf', {
        name: 'Contract.pdf',
        size: '2048',
      }),
      media: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    },
    [PNG_ID]: {
      metadata: metadata(PNG_ID, 'image/png', {
        name: 'Photo.png',
        size: '4',
      }),
      media: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    },
    [FOLDER_ID]: {
      metadata: metadata(FOLDER_ID, 'application/vnd.google-apps.folder'),
    },
    [FORM_ID]: {
      metadata: metadata(FORM_ID, 'application/vnd.google-apps.form'),
    },
    [ZIP_ID]: {
      metadata: metadata(ZIP_ID, 'application/zip', {
        name: 'Archive.zip',
        size: '10',
      }),
      media: new Uint8Array([1, 2, 3]),
    },
    [LOCKED_ID]: {
      metadata: metadata(LOCKED_ID, 'application/pdf', {
        name: 'Locked.pdf',
        size: '10',
        capabilities: { canDownload: false },
      }),
      media: new Uint8Array([1]),
    },
  }
}

const FRESH_PICK_STEP_MS = 500

async function withFastTimers<Value>(
  run: () => Promise<Value>,
): Promise<Value> {
  vi.useFakeTimers({ toFake: ['setTimeout'] })

  try {
    let isSettled = false
    const pending = run()
    const markSettled = () => {
      isSettled = true
    }

    pending.then(markSettled, markSettled)

    while (!isSettled) {
      await vi.advanceTimersByTimeAsync(FRESH_PICK_STEP_MS)
    }

    return await pending
  } finally {
    vi.useRealTimers()
  }
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

describe('POST /api/v1/google/drive/files', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeConnectorKv
  let drive: FakeDrive
  let userId: number
  let sessionUserId: number
  let restoreGoogleConfig: () => void = () => {}
  let stored: Array<{
    key: string
    size: number
    contentType: string
    text?: string
  }>
  let missingKeys: Set<string>

  function useDrive(files: Record<string, FakeDriveFile> = standardFiles()) {
    drive = createFakeDrive(files)
    vi.stubGlobal('fetch', drive.fetch)

    return drive
  }

  async function seedConnection(input: {
    status?: 'active' | 'needs_reauth'
    scopes?: string[]
  } = {}) {
    const { saveGoogleConnection } = await import(
      '~~/server/utils/google/tokens'
    )

    await saveGoogleConnection(testDb.db, {
      userId,
      clientMode: 'besidka',
      subject: GOOGLE_SUBJECT,
      email: 'person@example.test',
      scopes: input.scopes ?? ['openid', DRIVE_FILE_SCOPE],
      accessToken: 'access-stored',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      refreshToken: 'refresh-stored',
    })

    if (input.status === 'needs_reauth') {
      await testDb.db.update(schema.googleConnections)
        .set({ status: 'needs_reauth' })
        .where(eq(schema.googleConnections.userId, userId))
    }
  }

  async function importFiles(
    items: Array<{ id: string, resourceKey?: string }>,
    partial: Partial<SkillsRouteEvent> = {},
  ) {
    const module = await import(
      '~~/server/api/v1/google/drive/files/index.post'
    )
    const event = createSkillsRouteEvent({
      body: { items },
      ...partial,
      headers: {
        'origin': ORIGIN,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        ...partial.headers,
      },
    })
    const result = await withFastTimers(() => {
      return (module.default as Handler)(event)
    })

    return { result, event }
  }

  async function importOne(id: string, resourceKey?: string) {
    const { result } = await importFiles([{ id, resourceKey }])

    return result.results[0]
  }

  async function importLink(
    link: string,
    partial: Partial<SkillsRouteEvent> = {},
  ) {
    const module = await import(
      '~~/server/api/v1/google/drive/files/link.post'
    )
    const event = createSkillsRouteEvent({
      body: { link },
      ...partial,
      headers: {
        'origin': ORIGIN,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        ...partial.headers,
      },
    })

    return await withFastTimers(() => {
      return (module.default as Handler)(event)
    })
  }

  async function fileRows() {
    return await testDb.db.select().from(schema.files)
      .where(eq(schema.files.userId, userId))
  }

  beforeEach(async () => {
    mocks.flags = new Set(['google.drive'])
    mocks.logged = []
    mocks.usedBytes = 0
    mocks.itemTokenCalls = 0
    mocks.itemTokensAllowed = Number.POSITIVE_INFINITY
    mocks.maxStorageBytes = 100 * MEBIBYTE
    stored = []
    missingKeys = new Set()
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
    userId = await seedUser(testDb.db)
    sessionUserId = userId
    useDrive()
    restoreGoogleConfig = await useGoogleRuntimeConfig()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useFileStorage', () => ({
      put: vi.fn(async (
        key: string,
        data: Uint8Array,
        options: { httpMetadata: { contentType: string } },
      ) => {
        stored.push({
          key,
          size: data.byteLength,
          contentType: options.httpMetadata.contentType,
          text: new TextDecoder().decode(data),
        })

        return { key }
      }),
      head: vi.fn(async (key: string) => {
        return missingKeys.has(key)
          ? null
          : stored.some(entry => entry.key === key) ? { key } : null
      }),
      delete: vi.fn(async () => undefined),
    }))
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
    await seedConnection()
  })

  afterEach(() => {
    restoreGoogleConfig()
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('gates', () => {
    it('refuses a signed-out request', async () => {
      sessionUserId = 0

      expect((await failureOf(importFiles([{ id: DOC_ID }]))).status)
        .toBe(401)
    })

    it('answers 404 while google.drive is not active', async () => {
      mocks.flags = new Set()

      expect((await failureOf(importFiles([{ id: DOC_ID }]))).status)
        .toBe(404)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('refuses a cross-origin request', async () => {
      const failure = await failureOf(importFiles([{ id: DOC_ID }], {
        headers: {
          'origin': 'https://evil.example',
          'sec-fetch-site': 'cross-site',
        },
      }))

      expect(failure.status).toBe(403)
    })

    it('answers 429 after ten imports a minute', async () => {
      for (let index = 0; index < 10; index++) {
        await importFiles([{ id: FOLDER_ID }])
      }

      expect((await failureOf(importFiles([{ id: FOLDER_ID }]))).status)
        .toBe(429)
    })

    it.each([
      ['no items', []],
      ['six items', Array.from({ length: 6 }, (_, index) => {
        return { id: `1Pick${String(index).padStart(2, '0')}Pick${index}`
          .padEnd(20, 'x') }
      })],
      ['a duplicate', [{ id: DOC_ID }, { id: DOC_ID }]],
      ['a path in the id', [{ id: '../../etc/passwd' }]],
      ['a short id', [{ id: 'abc' }]],
      ['a bad resource key', [{ id: DOC_ID, resourceKey: 'a b/c' }]],
    ])('answers 400 for %s', async (_name, items) => {
      expect((await failureOf(importFiles(items))).status).toBe(400)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('answers 400 for an unknown body field', async () => {
      const failure = await failureOf(importFiles([{ id: DOC_ID }], {
        body: { items: [{ id: DOC_ID }], extra: true },
      }))

      expect(failure.status).toBe(400)
    })

    it('answers 404 before any read when Google is not connected', async () => {
      await testDb.db.delete(schema.googleConnections)

      expect((await failureOf(importFiles([{ id: DOC_ID }]))).status)
        .toBe(404)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('answers 409 when the connection needs re-authorization', async () => {
      await testDb.db.update(schema.googleConnections)
        .set({ status: 'needs_reauth' })

      expect((await failureOf(importFiles([{ id: DOC_ID }]))).status)
        .toBe(409)
      expect(drive.fetch).not.toHaveBeenCalled()
    })
  })

  describe('Google-native files', () => {
    it('exports a Doc to Markdown and stores it as a Google copy',
      async () => {
        const item = await importOne(DOC_ID)
        const [row] = await fileRows()

        expect(item).toMatchObject({
          id: DOC_ID,
          status: 'imported',
          file: {
            name: `${SECRET_NAME}.md`,
            type: 'text/markdown',
            externalSource: 'google',
            externalId: DOC_ID,
          },
        })
        expect(row).toMatchObject({
          source: 'upload',
          externalSource: 'google',
          externalId: DOC_ID,
          type: 'text/markdown',
          name: `${SECRET_NAME}.md`,
        })
        expect(row!.externalModifiedAt?.toISOString())
          .toBe('2026-11-20T10:00:00.000Z')
        expect(stored).toEqual([{
          key: row!.storageKey,
          size: '# Plan\n\nBody'.length,
          contentType: 'text/markdown',
          text: '# Plan\n\nBody',
        }])
        expect(row!.textVersion).toBeNull()
        expect(drive.ofKind('export')[0]!.url)
          .toContain('mimeType=text%2Fmarkdown')
      })

    it('falls back to plain text when Markdown is not accepted', async () => {
      useDrive({
        [DOC_ID]: {
          metadata: metadata(DOC_ID, 'application/vnd.google-apps.document'),
          exports: { 'text/plain': 'Plain body' },
        },
      })

      const item = await importOne(DOC_ID)

      expect(item).toMatchObject({
        status: 'imported',
        file: { name: `${SECRET_NAME}.txt`, type: 'text/plain' },
      })
      expect(drive.ofKind('export')).toHaveLength(2)
    })

    it('falls back to the first tab as CSV when the Sheets API refuses, and '
      + 'says so', async () => {
      const item = await importOne(SHEET_ID)

      expect(item).toMatchObject({
        status: 'imported',
        file: { name: 'Budget (first tab).csv', type: 'text/csv' },
        note: 'Only the first tab of this spreadsheet could be read.',
        sheets: {
          code: 'sheets_no_access',
          status: 403,
          reason: null,
          isTabCountUnknown: true,
        },
      })
      expect(drive.ofKind('export')).toHaveLength(1)
    })

    it('exports Slides to plain text', async () => {
      expect(await importOne(SLIDES_ID)).toMatchObject({
        status: 'imported',
        file: { name: 'Deck.txt', type: 'text/plain' },
      })
    })

    it('fails an over-cap export with its own reason', async () => {
      useDrive({
        [DOC_ID]: {
          metadata: metadata(DOC_ID, 'application/vnd.google-apps.document'),
          exports: {
            'text/markdown': {
              status: 403,
              reason: 'exportSizeLimitExceeded',
            },
          },
        },
      })

      expect(await importOne(DOC_ID)).toMatchObject({
        status: 'failed',
        code: 'export_too_large',
      })
      expect(await fileRows()).toHaveLength(0)
    })

    it('stops an export that streams past 10 MB', async () => {
      useDrive({
        [DOC_ID]: {
          metadata: metadata(DOC_ID, 'application/vnd.google-apps.document'),
          exports: { 'text/markdown': endlessStream(MEBIBYTE) },
        },
      })

      expect(await importOne(DOC_ID)).toMatchObject({
        status: 'failed',
        code: 'export_too_large',
      })
      expect(GOOGLE_DRIVE_EXPORT_MAX_BYTES).toBe(10 * MEBIBYTE)
      expect(stored).toHaveLength(0)
    })

    it('refuses a native type with no text export', async () => {
      expect(await importOne(FORM_ID)).toMatchObject({
        status: 'failed',
        code: 'unsupported_type',
      })
      expect(drive.ofKind('export')).toHaveLength(0)
    })
  })

  describe('other files', () => {
    it('downloads a PDF with shared drives enabled', async () => {
      const item = await importOne(PDF_ID)
      const [media] = drive.ofKind('media')

      expect(item).toMatchObject({
        status: 'imported',
        file: {
          name: 'Contract.pdf',
          type: 'application/pdf',
          externalSource: 'google',
        },
      })
      expect(media!.url).toContain('supportsAllDrives=true')
      expect(drive.ofKind('metadata')[0]!.url)
        .toContain('supportsAllDrives=true')
      expect(media!.headers.authorization).toBe('Bearer access-stored')
    })

    it('stores an image as it is', async () => {
      expect(await importOne(PNG_ID)).toMatchObject({
        status: 'imported',
        file: { type: 'image/png', size: 4 },
      })
    })

    it('sends the resource key with the lookup and the download',
      async () => {
        await importOne(PDF_ID, 'key-123')

        const header = 'x-goog-drive-resource-keys'

        expect(drive.ofKind('metadata')[0]!.headers[header])
          .toBe(`${PDF_ID}/key-123`)
        expect(drive.ofKind('media')[0]!.headers[header])
          .toBe(`${PDF_ID}/key-123`)
      })

    it('follows a download redirect to googleusercontent without the token',
      async () => {
        const contentUrl = 'https://doc-0g-docs.googleusercontent.com/p/x'

        useDrive({
          ...standardFiles(),
          [PDF_ID]: {
            ...standardFiles()[PDF_ID]!,
            media: undefined,
            mediaRedirect: contentUrl,
          },
        })
        drive.serveContent(contentUrl, new Uint8Array([0x25, 0x50]))

        const item = await importOne(PDF_ID, 'key-123')
        const [content] = drive.ofKind('content')

        expect(item).toMatchObject({ status: 'imported' })
        expect(content!.url).toBe(contentUrl)
        expect(content!.headers.authorization).toBeUndefined()
        expect(content!.headers['x-goog-drive-resource-keys']).toBeUndefined()
        expect(drive.ofKind('media')[0]!.headers['x-goog-drive-resource-keys'])
          .toBe(`${PDF_ID}/key-123`)
      })

    it('caps a long name and strips control characters and separators',
      async () => {
        const longName = `a/b\\c\u0000\n${'x'.repeat(400)}.pdf`

        useDrive({
          ...standardFiles(),
          [PDF_ID]: {
            ...standardFiles()[PDF_ID]!,
            metadata: metadata(PDF_ID, 'application/pdf', {
              name: longName,
              size: '4',
            }),
          },
        })

        const item = await importOne(PDF_ID)

        expect(item).toMatchObject({ status: 'imported' })
        expect(item.file.name.length).toBeLessThanOrEqual(255)
        expect(item.file.name.endsWith('.pdf')).toBe(true)
        expect(Array.from(item.file.name).some((character) => {
          return character.charCodeAt(0) < 32
            || character === '/'
            || character === '\\'
        })).toBe(false)
        expect(item.file.name.startsWith('a b c')).toBe(true)
      })

    it('says what Drive refused: no access, slow down, empty file',
      async () => {
        const answer = (status: number, reason: string) => {
          drive.fetch.mockImplementation(async () => {
            return new Response(JSON.stringify({
              error: { errors: [{ reason }] },
            }), { status })
          })
        }

        answer(403, 'forbidden')
        expect(await importOne(PDF_ID)).toMatchObject({
          status: 'failed',
          code: 'no_access',
        })
        answer(403, 'userRateLimitExceeded')
        expect(await importOne(PDF_ID)).toMatchObject({
          status: 'failed',
          code: 'rate_limited',
        })
        answer(429, 'rateLimitExceeded')
        expect(await importOne(PDF_ID)).toMatchObject({
          status: 'failed',
          code: 'rate_limited',
        })

        useDrive({
          ...standardFiles(),
          [PDF_ID]: {
            ...standardFiles()[PDF_ID]!,
            media: new Uint8Array(0),
          },
        })
        expect(await importOne(PDF_ID)).toMatchObject({
          status: 'failed',
          code: 'empty',
        })
        expect(await fileRows()).toHaveLength(0)
      })

    it('refuses a download redirect to a host that is not Google\'s',
      async () => {
        useDrive({
          ...standardFiles(),
          [PDF_ID]: {
            ...standardFiles()[PDF_ID]!,
            media: undefined,
            mediaRedirect: 'https://evil.example/steal',
          },
        })

        expect(await importOne(PDF_ID)).toMatchObject({
          status: 'failed',
          code: 'failed',
        })
        expect(drive.requests.some((request) => {
          return request.url.includes('evil.example')
        })).toBe(false)
        expect(await fileRows()).toHaveLength(0)
      })

    it('refuses a folder and a file type that cannot be attached',
      async () => {
        expect(await importOne(FOLDER_ID)).toMatchObject({
          status: 'failed',
          code: 'folder',
        })
        expect(await importOne(ZIP_ID)).toMatchObject({
          status: 'failed',
          code: 'unsupported_type',
        })
        expect(drive.ofKind('media')).toHaveLength(0)
      })

    it('does not download a file its owner locked', async () => {
      expect(await importOne(LOCKED_ID)).toMatchObject({
        status: 'failed',
        code: 'not_downloadable',
      })
      expect(drive.ofKind('media')).toHaveLength(0)
    })

    it('answers not found for a file Drive does not return', async () => {
      expect(await importOne(MISSING_ID)).toMatchObject({
        status: 'failed',
        code: 'not_found',
      })
    })

    it('asks the user to reconnect when Drive answers 401', async () => {
      drive.fetch.mockImplementation(async () => {
        return new Response('{}', { status: 401 })
      })

      expect(await importOne(PDF_ID)).toMatchObject({
        status: 'failed',
        code: 'reauthorize',
      })
    })

    it('answers not found for a trashed file', async () => {
      useDrive({
        [PDF_ID]: {
          metadata: metadata(PDF_ID, 'application/pdf', {
            size: '4',
            trashed: true,
          }),
          media: new Uint8Array([1]),
        },
      })

      expect(await importOne(PDF_ID)).toMatchObject({
        status: 'failed',
        code: 'not_found',
      })
      expect(drive.ofKind('media')).toHaveLength(0)
    })
  })

  describe('Google detail and the retry for a fresh pick', () => {
    function hideDocForMetadataCalls(hiddenCalls: number) {
      const original = drive.fetch.getMockImplementation()!
      const counter = { metadataCalls: 0 }

      drive.fetch.mockImplementation(async (input, init) => {
        const url = new URL(input)
        const isMetadata = url.pathname.endsWith(`/files/${DOC_ID}`)
          && url.searchParams.get('alt') !== 'media'

        if (isMetadata) {
          counter.metadataCalls++

          if (counter.metadataCalls <= hiddenCalls) {
            return new Response(JSON.stringify({
              error: { errors: [{ reason: 'notFound' }] },
            }), { status: 404 })
          }
        }

        return await original(input, init)
      })

      return counter
    }

    async function importDirectly(
      options: { retryFreshPick?: boolean },
      id = DOC_ID,
    ) {
      const { importDriveFiles } = await import(
        '~~/server/utils/google/drive-import'
      )
      const wait = vi.fn(async () => undefined)
      const results = await importDriveFiles({
        event: { context: {} } as never,
        db: testDb.db,
        kv,
        userId,
        items: [{ id }],
        logger: { set: () => undefined },
        wait,
        ...options,
      })

      return { results, wait }
    }

    it('asks again after a 404 on a fresh pick and imports once Google '
      + 'sees the grant', async () => {
      const counter = hideDocForMetadataCalls(2)

      expect(await importOne(DOC_ID)).toMatchObject({ status: 'imported' })
      expect(counter.metadataCalls).toBe(3)
    })

    it('waits 0.5, 1 and 2 seconds, one request at a time, then gives up',
      async () => {
        const counter = hideDocForMetadataCalls(10)

        const { results, wait } = await importDirectly({
          retryFreshPick: true,
        })

        expect(wait.mock.calls.map(call => (call as unknown[])[0]))
          .toEqual([500, 1000, 2000])
        expect(counter.metadataCalls).toBe(4)
        expect(results[0]).toMatchObject({
          status: 'failed',
          code: 'not_found',
          google: { stage: 'metadata', status: 404, reason: 'notFound' },
        })
      })

    it('shares one budget of six seconds between all files of a request',
      async () => {
        const { importDriveFiles } = await import(
          '~~/server/utils/google/drive-import'
        )
        const wait = vi.fn(async () => undefined)
        const ids = Array.from({ length: 5 }, (_unused, index) => {
          return `1Missing${index}Missing${index}Missing${index}Xx`
        })
        const results = await importDriveFiles({
          event: { context: {} } as never,
          db: testDb.db,
          kv,
          userId,
          items: ids.map(id => ({ id })),
          logger: { set: () => undefined },
          retryFreshPick: true,
          wait,
        })
        const waits = wait.mock.calls.map((call) => {
          return (call as unknown[])[0] as number
        })

        expect(waits.reduce((total, delay) => total + delay, 0))
          .toBeLessThanOrEqual(6000)
        expect(waits.length).toBeLessThan(15)
        expect(results.every(result => result.status === 'failed')).toBe(true)
      })

    it('never retries a file that was not just picked', async () => {
      const counter = hideDocForMetadataCalls(10)

      const { results, wait } = await importDirectly({})

      expect(wait).not.toHaveBeenCalled()
      expect(counter.metadataCalls).toBe(1)
      expect(results[0]).toMatchObject({ status: 'failed' })
    })

    it('retries only a 404, not another refusal', async () => {
      drive.fetch.mockImplementation(async () => {
        return new Response(JSON.stringify({
          error: { errors: [{ reason: 'appNotAuthorizedToFile' }] },
        }), { status: 403 })
      })

      const { results, wait } = await importDirectly({ retryFreshPick: true })

      expect(wait).not.toHaveBeenCalled()
      expect(drive.fetch).toHaveBeenCalledTimes(1)
      expect(results[0]).toMatchObject({
        code: 'no_access',
        google: {
          stage: 'metadata',
          status: 403,
          reason: 'appNotAuthorizedToFile',
        },
      })
    })

    it('says which request Google refused: the export of a Sheet', async () => {
      useDrive({
        [SHEET_ID]: {
          ...standardFiles()[SHEET_ID]!,
          exports: { 'text/csv': { status: 404, reason: 'notFound' } },
        },
      })

      const item = await importOne(SHEET_ID)

      expect(item).toMatchObject({
        status: 'failed',
        code: 'not_found',
        google: { stage: 'export', status: 404, reason: 'notFound' },
      })
      expect(drive.ofKind('metadata')).toHaveLength(1)
      expect(drive.ofKind('sheets')).toHaveLength(1)
    })

    it('names the download as the stage for a binary file', async () => {
      useDrive({
        [PDF_ID]: {
          metadata: metadata(PDF_ID, 'application/pdf', { size: '4' }),
        },
      })

      expect(await importOne(PDF_ID)).toMatchObject({
        status: 'failed',
        google: { stage: 'download', status: 404 },
      })
    })

    it('gives a different sentence for each reason that asks for a '
      + 'different action', async () => {
      const sentenceFor = async (status: number, reason: string) => {
        drive.fetch.mockImplementation(async () => {
          return new Response(JSON.stringify({
            error: { errors: [{ reason }] },
          }), { status })
        })

        return (await importOne(PDF_ID)).reason as string
      }
      const notFound = await sentenceFor(404, 'notFound')
      const notAuthorized = await sentenceFor(403, 'appNotAuthorizedToFile')
      const noPermission = await sentenceFor(403, 'insufficientFilePermissions')
      const other = await sentenceFor(403, 'forbidden')

      expect(new Set([notFound, notAuthorized, noPermission, other]).size)
        .toBe(4)
      expect(notAuthorized).toContain('Pick it again')
      expect(noPermission).toContain('Ask its owner')
    })

    it('never returns or logs a reason that is not a short machine string',
      async () => {
        drive.fetch.mockImplementation(async () => {
          return new Response(JSON.stringify({
            error: { errors: [{ reason: SECRET_NAME }] },
          }), { status: 403 })
        })

        const { result } = await importFiles([{ id: PDF_ID }])
        const item = result.results[0]

        expect(item.google).toEqual({
          stage: 'metadata',
          status: 403,
          reason: null,
        })
        expect(JSON.stringify(item)).not.toContain(SECRET_NAME)
        expect(JSON.stringify(mocks.logged)).not.toContain(SECRET_NAME)
      })

    it('puts the status, stage and reason into the wide event', async () => {
      useDrive({
        [SHEET_ID]: {
          ...standardFiles()[SHEET_ID]!,
          exports: { 'text/csv': { status: 404, reason: 'notFound' } },
        },
      })

      await importFiles([{ id: SHEET_ID }])

      expect(JSON.stringify(mocks.logged))
        .toContain('"failureDetails":["export:404:notFound"]')
    })
  })

  describe('POST /api/v1/google/drive/files/link', () => {
    const DOC_LINK = `https://docs.google.com/document/d/${DOC_ID}/edit?usp=sharing`

    it('copies the file a link names when Besidka can already read it',
      async () => {
        const answer = await importLink(DOC_LINK)

        expect(answer.item).toEqual({ id: DOC_ID })
        expect(answer.kind).toBe('document')
        expect(answer.results[0]).toMatchObject({
          id: DOC_ID,
          status: 'imported',
        })
        expect(await fileRows()).toHaveLength(1)
      })

    it('sends only the id and the resource key to Google, never the link',
      async () => {
        await importLink(
          `${DOC_LINK}&resourcekey=0-abc_DEF`,
        )

        const requests = drive.requests.map(request => request.url)

        expect(requests.length).toBeGreaterThan(0)
        expect(requests.every(url => !url.includes('usp=sharing'))).toBe(true)
        expect(drive.ofKind('metadata')[0]!.headers['x-goog-drive-resource-keys'])
          .toBe(`${DOC_ID}/0-abc_DEF`)
      })

    it('reuses a copy of an unchanged file', async () => {
      await importLink(DOC_LINK)

      const second = await importLink(DOC_LINK)

      expect(second.results[0]).toMatchObject({ status: 'reused' })
      expect(await fileRows()).toHaveLength(1)
    })

    it('answers a failed result and stores nothing when Besidka has no '
      + 'access, and asks Google once', async () => {
      const answer = await importLink(
        `https://docs.google.com/document/d/${MISSING_ID}/edit`,
      )

      expect(answer.results[0]).toMatchObject({
        status: 'failed',
        code: 'not_found',
      })
      expect(drive.fetch).toHaveBeenCalledTimes(1)
      expect(await fileRows()).toHaveLength(0)
    })

    it('refuses a link that is not a file, with no request to Google',
      async () => {
        for (const link of [
          `https://drive.google.com/drive/folders/${DOC_ID}`,
          `https://example.com/document/d/${DOC_ID}`,
          'not a link',
        ]) {
          expect(await failureOf(importLink(link))).toMatchObject({
            status: 400,
          })
        }

        expect(drive.fetch).not.toHaveBeenCalled()
      })

    it('answers 404 before any read when Google is not connected',
      async () => {
        await testDb.db.delete(schema.googleConnections)

        expect(await failureOf(importLink(DOC_LINK))).toMatchObject({
          status: 404,
        })
        expect(drive.fetch).not.toHaveBeenCalled()
      })

    it('refuses a signed-out request and a cross-origin one', async () => {
      sessionUserId = 0

      expect(await failureOf(importLink(DOC_LINK))).toMatchObject({
        status: 401,
      })

      sessionUserId = userId

      expect(await failureOf(importLink(DOC_LINK, {
        headers: { 'sec-fetch-site': 'cross-site' },
      }))).toMatchObject({ status: 403 })
    })

    it('has its own rate bucket: ten unreadable links leave the Picker '
      + 'imports their ten a minute', async () => {
      for (let index = 0; index < 10; index++) {
        await importLink(
          `https://docs.google.com/document/d/${MISSING_ID}/edit`,
        )
      }

      await importFiles([{ id: FOLDER_ID }])

      const imports = [] as number[]

      for (let index = 0; index < 9; index++) {
        imports.push((await importFiles([{ id: FOLDER_ID }])).result.results
          .length)
      }

      expect(imports).toHaveLength(9)
      expect((await failureOf(importFiles([{ id: FOLDER_ID }]))).status)
        .toBe(429)
    })

    it('answers 429 after twenty links a minute', async () => {
      for (let index = 0; index < 20; index++) {
        await importLink(
          `https://docs.google.com/document/d/${MISSING_ID}/edit`,
        )
      }

      expect((await failureOf(importLink(DOC_LINK))).status).toBe(429)
    })

    it('answers 404 while google.drive is not active', async () => {
      mocks.flags.delete('google.drive')

      expect(await failureOf(importLink(DOC_LINK))).toMatchObject({
        status: 404,
      })
    })
  })

  describe('limits', () => {
    function bigFile(size: string | undefined) {
      return {
        [BIG_ID]: {
          metadata: metadata(BIG_ID, 'application/pdf', {
            name: 'Big.pdf',
            ...(size ? { size } : {}),
          }),
          media: endlessStream(MEBIBYTE),
        },
      }
    }

    it('refuses a file over the size cap before downloading', async () => {
      useDrive(bigFile(String(GOOGLE_DRIVE_FILE_MAX_BYTES + 1)))

      expect(await importOne(BIG_ID)).toMatchObject({
        status: 'failed',
        code: 'too_large',
        reason: expect.stringContaining('20 MB'),
      })
      expect(drive.ofKind('media')).toHaveLength(0)
    })

    it('enforces the cap while streaming when Drive gave no size', async () => {
      useDrive(bigFile(undefined))

      expect(await importOne(BIG_ID)).toMatchObject({
        status: 'failed',
        code: 'too_large',
      })
      expect(GOOGLE_DRIVE_FILE_MAX_BYTES).toBe(20 * MEBIBYTE)
      expect(stored).toHaveLength(0)
    })

    it('answers storage full before downloading when no space is left',
      async () => {
        mocks.usedBytes = mocks.maxStorageBytes

        expect(await importOne(PDF_ID)).toMatchObject({
          status: 'failed',
          code: 'storage_full',
        })
        expect(drive.ofKind('media')).toHaveLength(0)
        expect(drive.ofKind('export')).toHaveLength(0)
      })

    it('answers storage full before downloading a file that cannot fit',
      async () => {
        mocks.usedBytes = mocks.maxStorageBytes - 1000

        expect(await importOne(PDF_ID)).toMatchObject({
          status: 'failed',
          code: 'storage_full',
        })
        expect(drive.ofKind('media')).toHaveLength(0)
      })

    it('stops a stream that outgrows the space left', async () => {
      mocks.usedBytes = mocks.maxStorageBytes - 3 * MEBIBYTE
      useDrive(bigFile(undefined))

      expect(await importOne(BIG_ID)).toMatchObject({
        status: 'failed',
        code: 'storage_full',
      })
      expect(stored).toHaveLength(0)
    })
  })

  describe('reuse and partial success', () => {
    it('reuses an unchanged copy without downloading again', async () => {
      const first = await importOne(PDF_ID)
      const second = await importOne(PDF_ID)

      expect(first).toMatchObject({ status: 'imported' })
      expect(second).toMatchObject({
        status: 'reused',
        file: { id: first.file.id, storageKey: first.file.storageKey },
      })
      expect(drive.ofKind('media')).toHaveLength(1)
      expect(await fileRows()).toHaveLength(1)
      expect(stored).toHaveLength(1)
      expect(drive.ofKind('metadata')).toHaveLength(2)
    })

    it('copies again when the file changed in Drive', async () => {
      await importOne(PDF_ID)

      const files = standardFiles()

      files[PDF_ID]!.metadata = {
        ...files[PDF_ID]!.metadata,
        modifiedTime: '2026-11-21T09:00:00.000Z',
      }
      useDrive(files)

      expect(await importOne(PDF_ID)).toMatchObject({ status: 'imported' })
      expect(await fileRows()).toHaveLength(2)
    })

    it('never reuses another user\'s copy', async () => {
      const otherUserId = await seedUser(testDb.db)

      await testDb.db.insert(schema.files).values({
        userId: otherUserId,
        storageKey: 'other.pdf',
        name: 'Contract.pdf',
        size: 4,
        type: 'application/pdf',
        externalSource: 'google',
        externalId: PDF_ID,
        externalModifiedAt: new Date('2026-11-20T10:00:00.000Z'),
      })

      expect(await importOne(PDF_ID)).toMatchObject({ status: 'imported' })
    })

    it('does not reuse an expired copy', async () => {
      await testDb.db.insert(schema.files).values({
        userId,
        storageKey: 'expired.pdf',
        name: 'Contract.pdf',
        size: 4,
        type: 'application/pdf',
        externalSource: 'google',
        externalId: PDF_ID,
        externalModifiedAt: new Date('2026-11-20T10:00:00.000Z'),
        expiresAt: new Date(Date.now() - 1000),
      })

      expect(await importOne(PDF_ID)).toMatchObject({ status: 'imported' })
    })

    describe('with a seeded copy', () => {
      const MODIFIED = '2026-11-20T10:00:00.900Z'

      async function seedCopy(extra: {
        createdAt: Date
        expiresAt?: Date
        storageKey?: string
      }) {
        const storageKey = extra.storageKey ?? 'seeded.pdf'

        stored.push({ key: storageKey, size: 4, contentType: 'application/pdf' })

        await testDb.db.insert(schema.files).values({
          userId,
          storageKey,
          name: 'Contract.pdf',
          size: 4,
          type: 'application/pdf',
          externalSource: 'google',
          externalId: PDF_ID,
          externalModifiedAt: new Date(MODIFIED),
          createdAt: extra.createdAt,
          expiresAt: extra.expiresAt ?? null,
        })
      }

      function modifiedAt(value: string) {
        useDrive({
          ...standardFiles(),
          [PDF_ID]: {
            ...standardFiles()[PDF_ID]!,
            metadata: metadata(PDF_ID, 'application/pdf', {
              name: 'Contract.pdf',
              size: '4',
              modifiedTime: value,
            }),
          },
        })
      }

      it('reuses a copy made after the second of the edit', async () => {
        await seedCopy({ createdAt: new Date('2026-11-20T10:00:01.000Z') })
        modifiedAt(MODIFIED)

        expect(await importOne(PDF_ID)).toMatchObject({ status: 'reused' })
        expect(drive.ofKind('media')).toHaveLength(0)
      })

      it('copies again when the copy came in the second of the edit',
        async () => {
          await seedCopy({ createdAt: new Date('2026-11-20T10:00:00.000Z') })
          modifiedAt(MODIFIED)

          expect(await importOne(PDF_ID)).toMatchObject({ status: 'imported' })
        })

      it('copies again when the stored object is gone from R2', async () => {
        await seedCopy({ createdAt: new Date('2026-11-20T10:00:05.000Z') })
        missingKeys.add('seeded.pdf')
        modifiedAt(MODIFIED)

        expect(await importOne(PDF_ID)).toMatchObject({ status: 'imported' })
      })

      it('copies again when the copy expires within the hour', async () => {
        await seedCopy({
          createdAt: new Date('2026-11-20T10:00:05.000Z'),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        })
        modifiedAt(MODIFIED)

        expect(await importOne(PDF_ID)).toMatchObject({ status: 'imported' })
      })

      it('falls through to an older copy whose object still exists',
        async () => {
          await seedCopy({
            createdAt: new Date('2026-11-20T10:00:05.000Z'),
            storageKey: 'older.pdf',
          })
          await seedCopy({
            createdAt: new Date('2026-11-20T10:00:09.000Z'),
            storageKey: 'newer.pdf',
          })
          missingKeys.add('newer.pdf')
          modifiedAt(MODIFIED)

          expect(await importOne(PDF_ID)).toMatchObject({
            status: 'reused',
            file: { storageKey: 'older.pdf' },
          })
        })
    })

    it('returns one result per file when some fail', async () => {
      const { result } = await importFiles([
        { id: DOC_ID },
        { id: FOLDER_ID },
        { id: PDF_ID },
        { id: MISSING_ID },
      ])

      expect(result.results.map((item: any) => item.status)).toEqual([
        'imported',
        'failed',
        'imported',
        'failed',
      ])
      expect(result.results.map((item: any) => item.id)).toEqual([
        DOC_ID,
        FOLDER_ID,
        PDF_ID,
        MISSING_ID,
      ])
      expect(await fileRows()).toHaveLength(2)
    })

    it('fails only the item whose token cannot be refreshed and reports '
      + 'the copies already stored', async () => {
      mocks.itemTokensAllowed = 1

      const { result } = await importFiles([{ id: DOC_ID }, { id: PDF_ID }])

      expect(result.results.map((item: any) => item.status))
        .toEqual(['imported', 'failed'])
      expect(result.results[1]).toMatchObject({ code: 'failed' })
      expect(await fileRows()).toHaveLength(1)
    })

    it('imports the files one at a time', async () => {
      let inFlight = 0
      let maxInFlight = 0
      const original = drive.fetch.getMockImplementation()!

      drive.fetch.mockImplementation(async (input, init) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(resolve => setTimeout(resolve, 1))

        try {
          return await original(input, init)
        } finally {
          inFlight--
        }
      })

      await importFiles([{ id: DOC_ID }, { id: PDF_ID }, { id: SHEET_ID }])

      expect(maxInFlight).toBe(1)
    })
  })

  describe('a Google Sheet as a workbook map', () => {
    const TAB_TITLES = [
      'Lists',
      'Parameters',
      'Lines',
      '\'Extra\'\'s tab\'',
      'Summary',
    ]

    function sheetsFile(
      overrides: Partial<FakeDriveFile> = {},
      sheets: FakeSheets = estimateSheets(),
    ): Record<string, FakeDriveFile> {
      return {
        ...standardFiles(),
        [SHEET_ID]: {
          ...standardFiles()[SHEET_ID]!,
          sheets,
          ...overrides,
        },
      }
    }

    function estimateSheets(): FakeSheets {
      const answers = estimateGridAnswers()
      const ids = Object.values(SHEET_IDS)

      return {
        structure: estimateMetadata(),
        grids: Object.fromEntries(TAB_TITLES.map((title, index) => {
          return [title, answers[ids[index] as number] as object]
        })),
      }
    }

    function sheetsDetails(): string[] {
      const logged = mocks.logged as Array<{
        attributes?: { googleDrive?: { sheetsDetails?: string[] } }
      }>

      return logged.flatMap((entry) => {
        return entry.attributes?.googleDrive?.sheetsDetails ?? []
      })
    }

    it('stores the map of every tab as Markdown that the row itself calls a '
      + 'map', async () => {
      useDrive(sheetsFile())

      const item = await importOne(SHEET_ID)

      expect(item).toMatchObject({
        status: 'imported',
        file: {
          name: 'Budget (workbook map).md',
          type: 'text/markdown',
          textStatus: 'ready',
          textVersion: 2,
          externalSource: 'google',
          workbookSummary: { sheets: 5, sheetsTotal: 5 },
        },
      })
      expect(item.note).toBeUndefined()
      expect(item.sheets).toBeUndefined()
      expect(drive.ofKind('sheets')).toHaveLength(6)
      expect(drive.ofKind('export')).toHaveLength(0)

      const [row] = await fileRows()
      const text = stored.find(entry => entry.key === row?.storageKey)?.text

      expect(row).toMatchObject({
        type: 'text/markdown',
        textStatus: 'ready',
        textVersion: 2,
        textBytes: row?.size,
        externalSource: 'google',
        externalId: SHEET_ID,
      })
      expect(text?.startsWith('# Workbook map')).toBe(true)
      expect(text).toContain('## Sheet: Lines')
      expect(text).toContain('Lists!$B$6:$B$45')
      expect(text).not.toContain('Secret acquisition plan')
      expect(isGoogleWorkbookMapFile(row as never)).toBe(true)
    })

    it('reuses an unchanged map with no request to the Sheets API',
      async () => {
        useDrive(sheetsFile())
        await importOne(SHEET_ID)

        const requestsBefore = drive.ofKind('sheets').length
        const again = await importOne(SHEET_ID)

        expect(again).toMatchObject({ status: 'reused' })
        expect(drive.ofKind('sheets')).toHaveLength(requestsBefore)
        expect(await fileRows()).toHaveLength(1)
      })

    it('does not reuse an old first-tab CSV of an unchanged Sheet once the '
      + 'map can be read', async () => {
      const first = await importOne(SHEET_ID)

      expect(first).toMatchObject({
        status: 'imported',
        file: { type: 'text/csv' },
      })

      useDrive(sheetsFile())

      const second = await importOne(SHEET_ID)

      expect(second).toMatchObject({
        status: 'imported',
        file: { type: 'text/markdown', textVersion: 2 },
      })
      expect(await fileRows()).toHaveLength(2)
    })

    it('reuses the CSV copy, with the notice, while the map cannot be read',
      async () => {
        await importOne(SHEET_ID)

        const again = await importOne(SHEET_ID)

        expect(again).toMatchObject({
          status: 'reused',
          file: { type: 'text/csv' },
          note: 'Only the first tab of this spreadsheet could be read.',
          sheets: { code: 'sheets_no_access' },
        })
        expect(drive.ofKind('export')).toHaveLength(1)
      })

    it.each([
      [
        'the API is not turned on',
        sheetsRefusal(403, 'PERMISSION_DENIED', 'SERVICE_DISABLED'),
        { code: 'sheets_api_off', status: 403, reason: 'SERVICE_DISABLED' },
        'structure:403:PERMISSION_DENIED:SERVICE_DISABLED',
      ],
      [
        'the file is refused',
        sheetsRefusal(403, 'PERMISSION_DENIED'),
        { code: 'sheets_no_access', status: 403, reason: null },
        'structure:403:PERMISSION_DENIED:none',
      ],
      [
        'the file is not found',
        sheetsRefusal(404, 'NOT_FOUND'),
        { code: 'sheets_no_access', status: 404, reason: null },
        'structure:404:NOT_FOUND:none',
      ],
      [
        'Google answers 429',
        sheetsRefusal(429, 'RESOURCE_EXHAUSTED', 'RATE_LIMIT_EXCEEDED'),
        {
          code: 'sheets_quota',
          status: 429,
          reason: 'RATE_LIMIT_EXCEEDED',
        },
        'structure:429:RESOURCE_EXHAUSTED:RATE_LIMIT_EXCEEDED',
      ],
    ] as const)('falls back to the CSV with its own code when %s',
      async (_name, refusal, detail, logged) => {
        useDrive(sheetsFile({}, refusal))

        const item = await importOne(SHEET_ID)

        expect(item).toMatchObject({
          status: 'imported',
          file: { type: 'text/csv' },
          note: 'Only the first tab of this spreadsheet could be read.',
          sheets: { ...detail, isTabCountUnknown: true },
        })
        expect(drive.ofKind('sheets')).toHaveLength(1)
        expect(sheetsDetails().join(' ')).toContain(logged)
        expect(sheetsDetails().join(' ')).toContain(
          `fallback:${detail.code}`,
        )
        expect(JSON.stringify(mocks.logged)).not.toContain('Free text')
      })

    it('falls back as too large when the structure answer is over the cap',
      async () => {
        useDrive(sheetsFile({
          sheets: {
            structure: { padding: 'x'.repeat(13 * MEBIBYTE) },
            grids: {},
          },
        }))

        const item = await importOne(SHEET_ID)

        expect(item).toMatchObject({
          status: 'imported',
          file: { type: 'text/csv' },
          sheets: { code: 'sheets_too_large' },
        })
      })

    it('says nothing about tabs when a one-tab spreadsheet falls back',
      async () => {
        useDrive(sheetsFile({}, {
          structure: {
            sheets: [{ properties: { sheetId: 1, title: 'Only' } }],
          },
          grids: { Only: 'x'.repeat(13 * MEBIBYTE) },
        }))

        const item = await importOne(SHEET_ID)

        expect(item).toMatchObject({
          status: 'imported',
          file: { type: 'text/csv' },
          sheets: { code: 'sheets_too_large' },
        })
        expect(item.note).toBeUndefined()
      })

    it('keeps the tabs it read and says how many of how many', async () => {
      const sheets = estimateSheets()

      if ('grids' in sheets) {
        sheets.grids.Lines = `x${'y'.repeat(13 * MEBIBYTE)}`
      }

      useDrive(sheetsFile({}, sheets))

      const item = await importOne(SHEET_ID)

      expect(item).toMatchObject({
        status: 'imported',
        file: { type: 'text/markdown' },
        note: 'Only 4 of 5 tabs of this spreadsheet were imported.',
      })
      expect(item.sheets).toBeUndefined()
    })

    it('never reuses a partial map: it reads again, and a complete map from '
      + 'a later try is stored and reused', async () => {
      const partial = estimateSheets()

      if ('grids' in partial) {
        partial.grids.Lines = 'not json'
      }

      useDrive(sheetsFile({}, partial))

      const first = await importOne(SHEET_ID)

      expect(first).toMatchObject({
        status: 'imported',
        file: { type: 'text/markdown', externalModifiedAt: null },
        note: 'Only 4 of 5 tabs of this spreadsheet were imported.',
      })
      expect((await fileRows())[0]?.externalModifiedAt).toBeNull()

      const requestsAfterFirst = drive.ofKind('sheets').length
      const second = await importOne(SHEET_ID)

      expect(second).toMatchObject({
        status: 'imported',
        note: 'Only 4 of 5 tabs of this spreadsheet were imported.',
      })
      expect(drive.ofKind('sheets').length).toBeGreaterThan(requestsAfterFirst)

      useDrive(sheetsFile())

      const third = await importOne(SHEET_ID)

      expect(third).toMatchObject({
        status: 'imported',
        file: { type: 'text/markdown', textVersion: 2 },
      })
      expect(third.note).toBeUndefined()
      expect((await fileRows()).at(-1)?.externalModifiedAt).not.toBeNull()

      const requestsAfterThird = drive.ofKind('sheets').length
      const fourth = await importOne(SHEET_ID)

      expect(fourth).toMatchObject({
        status: 'reused',
        file: { id: (third as { file: { id: string } }).file.id },
      })
      expect(drive.ofKind('sheets')).toHaveLength(requestsAfterThird)
      expect(await fileRows()).toHaveLength(3)
    })

    it('does not reuse a map that is partial because a tab is too large, '
      + 'and says so again', async () => {
      const sheets = estimateSheets()

      if ('grids' in sheets) {
        sheets.grids.Lines = `x${'y'.repeat(13 * MEBIBYTE)}`
      }

      useDrive(sheetsFile({}, sheets))
      await importOne(SHEET_ID)

      const again = await importOne(SHEET_ID)

      expect(again).toMatchObject({
        status: 'imported',
        note: 'Only 4 of 5 tabs of this spreadsheet were imported.',
      })
      expect(await fileRows()).toHaveLength(2)
    })

    it('does not reuse a map that the 20-tab limit cut', async () => {
      const titles = Array.from({ length: 22 }, (_item, index) => {
        return `Data${index + 1}`
      })

      useDrive(sheetsFile({}, {
        structure: {
          sheets: titles.map((title, index) => ({
            properties: { sheetId: index + 1, title },
          })),
        },
        grids: Object.fromEntries(titles.map((title, index) => {
          return [title, gridAnswer(index + 1, title, {
            A1: { text: title },
          })]
        })),
      }))
      await importOne(SHEET_ID)

      const requestsAfterFirst = drive.ofKind('sheets').length
      const again = await importOne(SHEET_ID)

      expect(again.status).toBe('imported')
      expect(drive.ofKind('sheets').length).toBeGreaterThan(requestsAfterFirst)
      expect(await fileRows()).toHaveLength(2)
    })

    it('says the tab count when the structure is known but no tab\'s cells '
      + 'arrive', async () => {
      const sheets = estimateSheets()

      if ('grids' in sheets) {
        for (const title of Object.keys(sheets.grids)) {
          sheets.grids[title] = `x${'y'.repeat(13 * MEBIBYTE)}`
        }
      }

      useDrive(sheetsFile({}, sheets))

      const item = await importOne(SHEET_ID)

      expect(item).toMatchObject({
        status: 'imported',
        file: { type: 'text/csv' },
        note: 'Only the first tab of this spreadsheet was imported.',
      })
      expect(item.sheets).not.toHaveProperty('isTabCountUnknown')
    })

    it('says the first 20 tabs when only the limit cut the map', async () => {
      const titles = Array.from({ length: 22 }, (_item, index) => {
        return `Data${index + 1}`
      })

      useDrive(sheetsFile({}, {
        structure: {
          sheets: titles.map((title, index) => ({
            properties: { sheetId: index + 1, title },
          })),
        },
        grids: Object.fromEntries(titles.map((title, index) => {
          return [title, gridAnswer(index + 1, title, {
            A1: { text: title },
          })]
        })),
      }))

      const item = await importOne(SHEET_ID)

      expect(item).toMatchObject({
        status: 'imported',
        note: 'Only the first 20 tabs of this spreadsheet were imported.',
        file: { workbookSummary: { sheets: 20, sheetsTotal: 22 } },
      })
    })

    it('falls back with a Besidka reason when the user\'s own bucket is '
      + 'empty, without asking Google', async () => {
      useDrive(sheetsFile())

      const minute = Math.floor(Date.now() / 60_000)

      await kv.put(
        `google-sheets-rate-limit:user:${userId}:${minute}`,
        '30',
      )

      const item = await importOne(SHEET_ID)

      expect(item).toMatchObject({
        status: 'imported',
        file: { type: 'text/csv' },
        sheets: {
          code: 'sheets_quota',
          status: 0,
          reason: 'besidka_user_limit',
        },
      })
      expect(drive.ofKind('sheets')).toHaveLength(0)
    })

    it('answers storage_full before reading when the allowance is used up',
      async () => {
        useDrive(sheetsFile())
        mocks.usedBytes = mocks.maxStorageBytes

        expect(await importOne(SHEET_ID)).toMatchObject({
          status: 'failed',
          code: 'storage_full',
        })
        expect(drive.ofKind('sheets')).toHaveLength(0)
      })

    it('lets a pasted link read for 10 seconds at most', async () => {
      useDrive(sheetsFile())

      const result = await importLink(
        `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
      )

      expect(result.results[0]).toMatchObject({
        status: 'imported',
        file: { type: 'text/markdown' },
      })
    })
  })

  describe('logging', () => {
    it('logs counts and ids, never a file name or a token', async () => {
      await importFiles([{ id: DOC_ID }, { id: FOLDER_ID }])

      const logged = JSON.stringify(mocks.logged)

      expect(logged).toContain('"imported":1')
      expect(logged).not.toContain(SECRET_NAME)
      expect(logged).not.toContain('access-stored')
      expect(logged).not.toContain('refresh-stored')
    })

    it('sends no cache headers a browser could reuse', async () => {
      const { event } = await importFiles([{ id: FOLDER_ID }])

      expect(event.res.headers.get('cache-control')).toBe('no-store')
    })
  })
})
