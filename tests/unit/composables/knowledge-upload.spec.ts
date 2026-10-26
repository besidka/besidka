import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { effectScope, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  KnowledgeItem,
  ProjectKnowledgeSummary,
} from '../../../shared/types/project-knowledge.d'
import {
  KNOWLEDGE_LIMITS,
} from '../../../shared/utils/project-knowledge-policy'
import {
  knowledgeCommitSchema,
  knowledgeItemsBatchCreateSchema,
} from '../../../shared/utils/project-knowledge-schemas'
import type {
  KnowledgeExtractionResult,
} from '../../../app/types/knowledge-extract.d'
import type {
  KnowledgeAcceptedEntry,
} from '../../../app/utils/knowledge-upload-plan'
import { useKnowledgeUpload } from '../../../app/composables/knowledge-upload'

interface RecordedCall {
  url: string
  method: string
  body: Record<string, any> | undefined
}

interface ItemsResponse {
  items: KnowledgeItem[]
  skipped: Array<{ index: number, reason: 'duplicate' }>
  version: number
  packVersion: number | null
}

interface UploadFileOptions {
  signal?: AbortSignal
}

const mocks = vi.hoisted(() => ({
  useLazyFetch: vi.fn(),
  fetchMock: vi.fn(),
  planKnowledgeUpload: vi.fn(),
  useKnowledgeExtraction: vi.fn(),
  extractFile: vi.fn(),
  disposeExtraction: vi.fn(),
  uploadWithProgress: vi.fn(),
}))

mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)
mockNuxtImport('useLegalConsent', () => () => ({
  ensureSendConsent: async () => true,
  handleConsentError: async () => false,
}))
mockNuxtImport('$fetch', () => mocks.fetchMock)
mockNuxtImport('planKnowledgeUpload', () => mocks.planKnowledgeUpload)
mockNuxtImport('useKnowledgeExtraction', () => mocks.useKnowledgeExtraction)

vi.mock('~/utils/upload-with-progress', () => ({
  uploadWithProgress: (...args: unknown[]) => {
    return mocks.uploadWithProgress(...args)
  },
}))

const summaryData = shallowRef<ProjectKnowledgeSummary | undefined>(undefined)
const refreshSummary = vi.fn()

const scopes: Array<ReturnType<typeof effectScope>> = []
const recordedCalls: RecordedCall[] = []
const extractionOverrides = new Map<
  string,
  Partial<KnowledgeExtractionResult> | Error
>()
const hashesByName = new Map<string, string>()
const failingFileDeletes = new Set<string>()

let itemsResponder: (
  body: Record<string, any>,
  callIndex: number,
) => Promise<ItemsResponse> | ItemsResponse
let commitExtras: { skipped?: string[] } = {}
let failingCommitCount = 0
let itemsCallCount = 0
let createdItemCount = 0
let versionCounter = 0
let nextProjectNumber = 0

function flushAsync(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function hashFor(name: string): string {
  const existing = hashesByName.get(name)

  if (existing) {
    return existing
  }

  const hash = (hashesByName.size + 1).toString(16).padStart(64, '0')

  hashesByName.set(name, hash)

  return hash
}

function createKnowledgeItem(
  payload: Record<string, any>,
): KnowledgeItem {
  createdItemCount += 1

  return {
    id: `item-${createdItemCount}`,
    projectId: 'project',
    kind: 'file',
    fileId: payload.fileId ?? null,
    title: payload.title ?? 'untitled',
    description: null,
    relativePath: payload.relativePath ?? null,
    folderId: payload.folderId ?? null,
    contentHash: payload.contentHash ?? null,
    mediaType: payload.mediaType ?? null,
    sizeBytes: null,
    pageCount: payload.pageCount ?? null,
    textBytes: new TextEncoder().encode(payload.text ?? '').length,
    latinChars: 0,
    cyrillicChars: 0,
    otherChars: 0,
    extractStatus: payload.extractStatus,
    extractError: payload.extractError ?? null,
    extractor: payload.extractor,
    sendAsNativePdf: false,
    pinned: false,
    createdAt: '2026-10-25T10:00:00.000Z',
    updatedAt: '2026-10-25T10:00:00.000Z',
  }
}

function defaultItemsResponder(body: Record<string, any>): ItemsResponse {
  versionCounter += 1

  return {
    items: body.items.map(createKnowledgeItem),
    skipped: [],
    version: versionCounter,
    packVersion: body.commit ? versionCounter : null,
  }
}

function createFetchError(
  status: number,
  message: string,
  why?: string,
  fix?: string,
): Record<string, unknown> {
  return {
    message: 'fetch failed',
    data: {
      message,
      status,
      data: {
        ...(why ? { why } : {}),
        ...(fix ? { fix } : {}),
      },
    },
  }
}

function createStatusError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status })
}

function mediaTypeFor(name: string): string {
  if (name.endsWith('.pdf')) {
    return 'application/pdf'
  }

  if (name.endsWith('.png')) {
    return 'image/png'
  }

  return 'text/markdown'
}

function categoryFor(name: string): KnowledgeAcceptedEntry['category'] {
  if (name.endsWith('.pdf')) {
    return 'document'
  }

  return name.endsWith('.png') ? 'image' : 'text'
}

function defaultExtraction(file: File): KnowledgeExtractionResult {
  const isBinary = file.name.endsWith('.pdf') || file.name.endsWith('.png')

  return {
    extractor: file.name.endsWith('.pdf') ? 'client-unpdf' : 'text',
    extractStatus: 'ready',
    extractError: null,
    text: `text of ${file.name}`,
    pageCount: file.name.endsWith('.pdf') ? 2 : null,
    contentHash: hashFor(file.name),
    mediaType: mediaTypeFor(file.name),
    sizeBytes: file.size,
    needsOriginalUpload: isBinary,
  }
}

function createSource(name: string, relativePath: string | null = null) {
  const file = new File(['content'], name, { type: mediaTypeFor(name) })

  return { file, relativePath }
}

function createAccepted(
  source: { file: File, relativePath: string | null },
  contentHash = hashFor(`plan:${source.file.name}`),
): KnowledgeAcceptedEntry {
  return {
    file: source.file,
    relativePath: source.relativePath,
    name: source.file.name,
    category: categoryFor(source.file.name),
    contentHash,
  }
}

function planSources(
  sources: Array<{ file: File, relativePath: string | null }>,
  contentHashes: Record<string, string> = {},
): void {
  mocks.planKnowledgeUpload.mockResolvedValue({
    accepted: sources.map((source) => {
      return createAccepted(source, contentHashes[source.file.name])
    }),
    skipped: [],
    totalBytes: sources.reduce((sum, source) => sum + source.file.size, 0),
  })
}

function createTextSources(count: number) {
  return Array.from({ length: count }, (_, index) => {
    return createSource(`file-${index + 1}.md`)
  })
}

function itemCalls(): RecordedCall[] {
  return recordedCalls.filter((call) => {
    return call.method === 'POST' && call.url.endsWith('/items')
  })
}

function commitCalls(): RecordedCall[] {
  return recordedCalls.filter((call) => {
    return call.url.endsWith('/commit')
  })
}

function fileDeleteCalls(): string[] {
  return recordedCalls
    .filter(call => call.method === 'DELETE' && call.url.includes('/files/'))
    .map(call => call.url)
}

function walkedPathsOf(
  sources: Array<{ file: File, relativePath: string | null }>,
): string[] {
  return sources.flatMap((source) => {
    return source.relativePath === null ? [] : [source.relativePath]
  })
}

function batchSizes(): number[] {
  return itemCalls().map(call => call.body?.items.length)
}

function createUpload(projectId: string | null = nextProject()) {
  const projectIdRef = shallowRef<string | undefined>(projectId ?? undefined)
  const scope = effectScope()
  const upload = scope.run(() => useKnowledgeUpload(projectIdRef))

  scopes.push(scope)

  if (!upload) {
    throw new Error('Failed to create the upload composable')
  }

  return { upload, projectIdRef }
}

function nextProject(): string {
  nextProjectNumber += 1

  return `project-upload-${nextProjectNumber}`
}

async function prepareAndStart(
  upload: ReturnType<typeof createUpload>['upload'],
  sources: Array<{ file: File, relativePath: string | null }>,
  options: Parameters<typeof upload.prepare>[1] = {},
): Promise<void> {
  planSources(sources)
  await upload.prepare(sources, options)
  await upload.start()
}

describe('useKnowledgeUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recordedCalls.length = 0
    extractionOverrides.clear()
    hashesByName.clear()
    failingFileDeletes.clear()
    commitExtras = {}
    failingCommitCount = 0
    itemsCallCount = 0
    createdItemCount = 0
    versionCounter = 0
    itemsResponder = defaultItemsResponder
    summaryData.value = undefined
    refreshSummary.mockReset()
    refreshSummary.mockResolvedValue(undefined)
    mocks.useLazyFetch.mockImplementation(() => {
      return {
        data: summaryData,
        pending: shallowRef(false),
        error: shallowRef(undefined),
        refresh: refreshSummary,
      }
    })
    mocks.fetchMock.mockReset()
    mocks.fetchMock.mockImplementation(async (
      url: string,
      options: { method?: string, body?: Record<string, any> } = {},
    ) => {
      recordedCalls.push({
        url,
        method: options.method ?? 'GET',
        body: options.body,
      })

      if (url.endsWith('/items') && options.method === 'POST') {
        itemsCallCount += 1

        return itemsResponder(options.body ?? {}, itemsCallCount - 1)
      }

      if (url.startsWith('/api/v1/files/') && options.method === 'DELETE') {
        if (failingFileDeletes.has(url)) {
          throw createFetchError(500, 'Could not delete the file')
        }

        return undefined
      }

      if (url.endsWith('/commit')) {
        if (failingCommitCount > 0) {
          failingCommitCount -= 1

          throw createFetchError(500, 'Commit failed')
        }

        versionCounter += 1

        const requested: string[] = options.body?.remove ?? []
        const skipped = commitExtras.skipped ?? []

        return {
          version: versionCounter,
          packVersion: versionCounter,
          removed: requested.length - skipped.length,
          skipped,
        }
      }

      throw new Error(`Unhandled request ${url}`)
    })
    mocks.planKnowledgeUpload.mockReset()
    mocks.extractFile.mockReset()
    mocks.extractFile.mockImplementation(async (file: File) => {
      const override = extractionOverrides.get(file.name)

      if (override instanceof Error) {
        throw override
      }

      return { ...defaultExtraction(file), ...override }
    })
    mocks.useKnowledgeExtraction.mockReset()
    mocks.useKnowledgeExtraction.mockImplementation(() => {
      return {
        extractFile: mocks.extractFile,
        isBusy: shallowRef(false),
        dispose: mocks.disposeExtraction,
      }
    })
    mocks.uploadWithProgress.mockReset()
    mocks.uploadWithProgress.mockImplementation(async (
      options: { file: File },
    ) => {
      return {
        data: { id: `file-${options.file.name}` },
        status: 200,
        statusText: 'OK',
      }
    })
  })

  afterEach(() => {
    scopes.splice(0).forEach(scope => scope.stop())
  })

  describe('prepare', () => {
    it('plans the entries and moves through planning to preview', async () => {
      const { upload } = createUpload()
      const sources = [createSource('a.md'), createSource('b.md')]
      const phases: string[] = []

      mocks.planKnowledgeUpload.mockImplementation(async () => {
        phases.push(upload.phase.value)

        return {
          accepted: sources.map(source => createAccepted(source)),
          skipped: [
            { name: 'x.bin', relativePath: null, reason: 'binary' },
          ],
          totalBytes: 14,
        }
      })

      expect(upload.phase.value).toBe('idle')

      await upload.prepare(sources, { gitignoreText: 'dist/' })

      expect(phases).toEqual(['planning'])
      expect(upload.phase.value).toBe('preview')
      expect(upload.plan.value).toMatchObject({ added: 2, skipped: 1 })
      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'queued',
        'queued',
      ])
      expect(mocks.planKnowledgeUpload).toHaveBeenCalledWith({
        entries: sources,
        gitignoreText: 'dist/',
        existingHashes: new Set<string>(),
      })
      expect(mocks.fetchMock).not.toHaveBeenCalled()
      expect(mocks.useKnowledgeExtraction).not.toHaveBeenCalled()
    })

    it('reports a readable error when planning throws', async () => {
      const { upload } = createUpload()

      mocks.planKnowledgeUpload.mockRejectedValue(new Error('Disk read failed'))

      await upload.prepare([createSource('a.md')])

      expect(upload.phase.value).toBe('error')
      expect(upload.error.value?.message).toBe('Disk read failed')
    })

    it('fails without a project', async () => {
      const { upload } = createUpload(null)

      await upload.prepare([createSource('a.md')])

      expect(upload.phase.value).toBe('error')
      expect(upload.error.value?.message).toBe('Select a project first.')
      expect(mocks.planKnowledgeUpload).not.toHaveBeenCalled()
    })

    it('generates a folder id only for folder uploads', async () => {
      const { upload } = createUpload()
      const folderSources = [createSource('a.md', 'docs/a.md')]

      await prepareAndStart(upload, folderSources)

      const folderId = itemCalls()[0]?.body?.items[0].folderId

      expect(folderId).toMatch(/^[a-f0-9]{32}$/)

      const { upload: singleUpload } = createUpload()

      recordedCalls.length = 0

      await prepareAndStart(singleUpload, [createSource('b.md')])

      expect(itemCalls()[0]?.body?.items[0].folderId).toBeNull()
    })

    it('uses the folder id passed by the caller', async () => {
      const { upload } = createUpload()

      await prepareAndStart(upload, [createSource('a.md', 'a.md')], {
        folderId: 'folder-1',
      })

      expect(itemCalls()[0]?.body?.items[0].folderId).toBe('folder-1')
    })

    it('resets when the project changes', async () => {
      const { upload, projectIdRef } = createUpload()

      planSources([createSource('a.md')])
      await upload.prepare([createSource('a.md')])

      expect(upload.entries.value).toHaveLength(1)

      projectIdRef.value = nextProject()
      await flushAsync()

      expect(upload.phase.value).toBe('idle')
      expect(upload.entries.value).toEqual([])
      expect(upload.plan.value).toBeNull()
    })
  })

  describe('running', () => {
    it('ignores start before a preview exists', async () => {
      const { upload } = createUpload()

      await upload.start()

      expect(upload.phase.value).toBe('idle')
      expect(mocks.extractFile).not.toHaveBeenCalled()
    })

    it('extracts one file at a time and reports progress', async () => {
      const { upload } = createUpload()
      const sources = createTextSources(5)
      const observedPhases: string[] = []
      const currentNames: Array<string | null> = []
      let activeExtractions = 0
      let maxActiveExtractions = 0

      mocks.extractFile.mockImplementation(async (file: File) => {
        activeExtractions += 1
        maxActiveExtractions = Math.max(
          maxActiveExtractions,
          activeExtractions,
        )
        observedPhases.push(upload.phase.value)
        currentNames.push(upload.progress.value.currentName)
        await flushAsync()
        activeExtractions -= 1

        return defaultExtraction(file)
      })

      await prepareAndStart(upload, sources)

      expect(maxActiveExtractions).toBe(1)
      expect(new Set(observedPhases)).toEqual(new Set(['running']))
      expect(currentNames).toEqual(sources.map(source => source.file.name))
      expect(upload.phase.value).toBe('done')
      expect(upload.progress.value).toMatchObject({
        done: 5,
        total: 5,
        currentName: null,
        bytesDone: 5 * 7,
        bytesTotal: 5 * 7,
      })
      expect(upload.entries.value.every(entry => entry.status === 'ready'))
        .toBe(true)
      expect(refreshSummary).toHaveBeenCalled()
    })

    it('builds a payload accepted by the batch schema', async () => {
      const { upload } = createUpload()
      const sources = [
        createSource('a.md', 'docs/a.md'),
        createSource('b.pdf'),
        createSource('c.png'),
      ]

      await prepareAndStart(upload, sources, { folderId: 'folder-1' })

      const [call] = itemCalls()

      expect(knowledgeItemsBatchCreateSchema.safeParse(call?.body).success)
        .toBe(true)
      expect(call?.body?.items[0]).toEqual({
        title: 'a.md',
        mediaType: 'text/markdown',
        relativePath: 'docs/a.md',
        folderId: 'folder-1',
        contentHash: hashFor('a.md'),
        extractor: 'text',
        extractStatus: 'ready',
        extractError: null,
        pageCount: null,
        text: 'text of a.md',
      })
    })

    it('uploads originals first, and only for PDFs and images', async () => {
      const { upload } = createUpload()
      const order: string[] = []

      mocks.uploadWithProgress.mockImplementation(async (
        options: { file: File },
      ) => {
        order.push(`upload:${options.file.name}`)

        return { data: { id: `file-${options.file.name}` } }
      })
      mocks.fetchMock.mockImplementation(async (
        url: string,
        options: { method?: string, body?: Record<string, any> } = {},
      ) => {
        recordedCalls.push({
          url,
          method: options.method ?? 'GET',
          body: options.body,
        })
        order.push(`post:${options.method}:${url.split('/').pop()}`)

        if (url.endsWith('/commit')) {
          return { version: 1, packVersion: 1, removed: 0, skipped: [] }
        }

        return defaultItemsResponder(options.body ?? {})
      })

      await prepareAndStart(upload, [
        createSource('a.md'),
        createSource('b.pdf'),
        createSource('c.png'),
      ])

      expect(order).toEqual(['upload:b.pdf', 'upload:c.png', 'post:POST:items'])
      expect(mocks.uploadWithProgress).toHaveBeenCalledTimes(2)

      const items = itemCalls()[0]?.body?.items

      expect(items[0].fileId).toBeUndefined()
      expect(items[0].mediaType).toBe('text/markdown')
      expect(items[1].fileId).toBe('file-b.pdf')
      expect(items[1].mediaType).toBeUndefined()
      expect(items[1].pageCount).toBe(2)
      expect(items[2].fileId).toBe('file-c.png')
    })

    it('sends the upload request in the existing endpoint format', async () => {
      const { upload } = createUpload()
      const source = createSource('Report Q3.pdf')

      await prepareAndStart(upload, [source])

      const options = mocks.uploadWithProgress.mock.calls[0]?.[0]

      expect(options.url).toBe('/api/v1/files/upload')
      expect(options.file).toBe(source.file)
      expect(options.headers).toEqual({
        'Content-Type': 'application/pdf',
        'X-Filename': encodeURIComponent('Report Q3.pdf'),
        'X-Filesize': source.file.size.toString(),
      })
      expect(options.signal).toBeInstanceOf(AbortSignal)
    })

    it('links library originals by file id without uploading', async () => {
      const { upload } = createUpload()
      const source = { ...createSource('lib.pdf'), fileId: 'library-file' }

      planSources([source])
      await upload.prepare([source])
      await upload.start()

      expect(mocks.uploadWithProgress).not.toHaveBeenCalled()
      expect(itemCalls()[0]?.body?.items[0].fileId).toBe('library-file')
    })

    it('stores scans and images without text as no-text items', async () => {
      const { upload } = createUpload()

      extractionOverrides.set('scan.pdf', {
        extractStatus: 'no-text',
        extractError: 'no-text-layer',
        text: '',
      })
      extractionOverrides.set('blank.md', { text: '   \n ' })

      await prepareAndStart(upload, [
        createSource('scan.pdf'),
        createSource('blank.md'),
      ])

      const items = itemCalls()[0]?.body?.items

      expect(items[0]).toMatchObject({
        fileId: 'file-scan.pdf',
        extractStatus: 'no-text',
        extractError: 'no-text-layer',
        text: '',
      })
      expect(items[1]).toMatchObject({ extractStatus: 'no-text', text: '' })
      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'no-text',
        'no-text',
      ])
      expect(knowledgeItemsBatchCreateSchema.safeParse(itemCalls()[0]?.body)
        .success).toBe(true)
    })

    it('normalises fields that the schema would reject', async () => {
      const { upload } = createUpload()
      const longName = `${'n'.repeat(250)}.md`

      extractionOverrides.set(longName, {
        pageCount: 9999,
        contentHash: 'not-a-hash',
        extractError: 'e'.repeat(100),
        extractStatus: 'no-text',
        text: '',
      })

      await prepareAndStart(upload, [
        createSource(`${longName}`, '/leading/slash.md'),
        createSource('b.md', 'a/../b.md'),
      ])

      const [first, second] = itemCalls()[0]?.body?.items ?? []

      expect(first.title).toHaveLength(KNOWLEDGE_LIMITS.maxTitleChars)
      expect(first.relativePath).toBeNull()
      expect(first.pageCount).toBeNull()
      expect(first.contentHash).toBe(hashFor(`plan:${longName}`))
      expect(first.extractError).toHaveLength(64)
      expect(second.relativePath).toBeNull()
      expect(knowledgeItemsBatchCreateSchema.safeParse(itemCalls()[0]?.body)
        .success).toBe(true)
    })

    it('normalises titles and sends only valid paths and folder ids', async () => {
      const { upload } = createUpload()

      await prepareAndStart(
        upload,
        [
          createSource('cafe\u0301\t  notes.md', 'docs/cafe\u0301.md'),
          createSource('plain.md', null),
        ],
        { folderId: 'not a valid id!' },
      )

      const [first, second] = itemCalls()[0]?.body?.items ?? []

      expect(first.title).toBe('caf\u00E9 notes.md')
      expect(first.relativePath).toBe('docs/caf\u00E9.md')
      expect(first.folderId).toBeNull()
      expect(second.folderId).toBeNull()
      expect(second.relativePath).toBeNull()
      expect(knowledgeItemsBatchCreateSchema.safeParse(itemCalls()[0]?.body)
        .success).toBe(true)
    })

    it('never sends a folder id or path for plain uploads', async () => {
      const { upload } = createUpload()

      await prepareAndStart(upload, [createSource('plain.md', null)])

      const [item] = itemCalls()[0]?.body?.items ?? []

      expect(item.folderId).toBeNull()
      expect(item.relativePath).toBeNull()
    })

    it('fails a file whose extraction fails and keeps going', async () => {
      const { upload } = createUpload()

      extractionOverrides.set('bad.pdf', {
        extractStatus: 'failed',
        extractError: 'timeout',
        text: '',
      })
      extractionOverrides.set('crash.md', new Error('Worker crashed'))

      await prepareAndStart(upload, [
        createSource('bad.pdf'),
        createSource('crash.md'),
        createSource('ok.md'),
      ])

      expect(upload.phase.value).toBe('done')
      expect(upload.error.value).toBeNull()
      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'failed',
        'failed',
        'ready',
      ])
      expect(upload.entries.value[0]?.error).toContain('timeout')
      expect(upload.entries.value[1]?.error).toBe('Worker crashed')
      expect(mocks.uploadWithProgress).not.toHaveBeenCalled()
      expect(itemCalls()[0]?.body?.items).toHaveLength(1)
      expect(upload.failedCount.value).toBe(2)
    })

    it('rejects extracted text that cannot fit in a batch', async () => {
      const { upload } = createUpload()

      extractionOverrides.set('huge.pdf', {
        text: 'a'.repeat(KNOWLEDGE_LIMITS.maxBatchTextBytes + 1),
      })

      await prepareAndStart(upload, [
        createSource('huge.pdf'),
        createSource('ok.md'),
      ])

      expect(upload.entries.value[0]).toMatchObject({ status: 'failed' })
      expect(upload.entries.value[0]?.error).toContain('1 MB')
      expect(mocks.uploadWithProgress).not.toHaveBeenCalled()
      expect(itemCalls()[0]?.body?.items).toHaveLength(1)
    })

    it('marks server-skipped duplicates', async () => {
      const { upload } = createUpload()

      itemsResponder = (body) => {
        return {
          items: [createKnowledgeItem(body.items[0])],
          skipped: [{ index: 1, reason: 'duplicate' }],
          version: 1,
          packVersion: 1,
        }
      }

      await prepareAndStart(upload, [
        createSource('a.md'),
        createSource('b.md'),
      ])

      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'ready',
        'skipped-duplicate',
      ])
      expect(upload.phase.value).toBe('done')
    })
  })

  describe('batching', () => {
    it('sends at most 25 items per batch and commits the last one', async () => {
      const { upload } = createUpload()

      await prepareAndStart(upload, createTextSources(60))

      expect(batchSizes()).toEqual([25, 25, 10])
      expect(itemCalls().map(call => call.body?.commit)).toEqual([
        undefined,
        undefined,
        true,
      ])
      expect(commitCalls()).toHaveLength(0)
      expect(upload.entries.value.every(entry => entry.status === 'ready'))
        .toBe(true)
    })

    it('splits batches by UTF-8 text bytes', async () => {
      const { upload } = createUpload()
      const sources = [
        createSource('a.md'),
        createSource('b.md'),
        createSource('c.md'),
        createSource('d.md'),
      ]
      const sizes = [400, 400, 400, 100]

      sizes.forEach((kilobytes, index) => {
        extractionOverrides.set(sources[index]!.file.name, {
          text: 'a'.repeat(kilobytes * 1024),
        })
      })

      await prepareAndStart(upload, sources)

      expect(batchSizes()).toEqual([2, 2])
      expect(itemCalls().map(call => call.body?.commit)).toEqual([
        undefined,
        true,
      ])

      for (const call of itemCalls()) {
        expect(knowledgeItemsBatchCreateSchema.safeParse(call.body).success)
          .toBe(true)
      }
    })

    it('fills a batch exactly up to the byte limit', async () => {
      const { upload } = createUpload()
      const half = KNOWLEDGE_LIMITS.maxBatchTextBytes / 2

      extractionOverrides.set('a.md', { text: 'a'.repeat(half) })
      extractionOverrides.set('b.md', { text: 'b'.repeat(half) })
      extractionOverrides.set('c.md', { text: 'c' })

      await prepareAndStart(upload, [
        createSource('a.md'),
        createSource('b.md'),
        createSource('c.md'),
      ])

      expect(batchSizes()).toEqual([2, 1])
    })

    it('counts bytes, not characters', async () => {
      const { upload } = createUpload()

      extractionOverrides.set('a.md', { text: 'я'.repeat(300_000) })
      extractionOverrides.set('b.md', { text: 'я'.repeat(300_000) })

      await prepareAndStart(upload, [
        createSource('a.md'),
        createSource('b.md'),
      ])

      expect(batchSizes()).toEqual([1, 1])
    })

    it('commits the final batch even when the last file fails', async () => {
      const { upload } = createUpload()

      extractionOverrides.set('last.md', new Error('Worker crashed'))

      await prepareAndStart(upload, createTextSources(25).concat([
        createSource('last.md'),
      ]))

      expect(batchSizes()).toEqual([25])
      expect(itemCalls()[0]?.body?.commit).toBe(true)
      expect(commitCalls()).toHaveLength(0)
    })

    it('sends a bare commit after a full batch and a failed tail', async () => {
      const { upload } = createUpload()
      const sources = createTextSources(26)

      itemsResponder = (body, callIndex) => {
        if (callIndex === 1) {
          throw createFetchError(422, 'Too many items')
        }

        return defaultItemsResponder(body)
      }

      await prepareAndStart(upload, sources)

      expect(batchSizes()).toEqual([25, 1])
      expect(commitCalls().map(call => call.body)).toEqual([{}])
      expect(knowledgeCommitSchema.safeParse({}).success).toBe(true)
    })
  })

  describe('errors', () => {
    it('stops on a quota error, keeps progress and explains why', async () => {
      const { upload } = createUpload()

      itemsResponder = (body, callIndex) => {
        if (callIndex === 1) {
          throw createFetchError(
            413,
            'Not enough storage space',
            'The project quota is full',
          )
        }

        return defaultItemsResponder(body)
      }

      await prepareAndStart(upload, createTextSources(26))

      const statuses = upload.entries.value.map(entry => entry.status)

      expect(upload.phase.value).toBe('error')
      expect(upload.error.value).toEqual({
        message: 'Not enough storage space',
        why: 'The project quota is full',
        status: 413,
      })
      expect(statuses.slice(0, 25).every(status => status === 'ready'))
        .toBe(true)
      expect(statuses[25]).toBe('failed')
      expect(upload.entries.value[25]?.error).toBe('Not enough storage space')
      expect(upload.failedCount.value).toBe(1)
    })

    it('stops before the next file when a batch is rejected', async () => {
      const { upload } = createUpload()

      itemsResponder = () => {
        throw createFetchError(413, 'Not enough storage space')
      }

      await prepareAndStart(upload, createTextSources(30))

      const statuses = upload.entries.value.map(entry => entry.status)

      expect(upload.phase.value).toBe('error')
      expect(statuses.slice(0, 25).every(status => status === 'failed'))
        .toBe(true)
      expect(statuses[25]).toBe('queued')
      expect(statuses.slice(26).every(status => status === 'queued')).toBe(true)
      expect(mocks.extractFile).toHaveBeenCalledTimes(26)
    })

    it.each([
      [413, 'Not enough storage space'],
      [422, 'This project reached its knowledge limit'],
    ])('maps a %s from the items endpoint', async (status, message) => {
      const { upload } = createUpload()

      itemsResponder = () => {
        throw createFetchError(status, message)
      }

      await prepareAndStart(upload, [createSource('a.md')])

      expect(upload.phase.value).toBe('error')
      expect(upload.error.value?.status).toBe(status)
      expect(upload.error.value?.message).toBe(message)
    })

    describe('the per-account item limit', () => {
      const limitWhy = 'An account holds at most 500 knowledge items'
        + ' across all projects and it has 499'
      const limitFix = 'Remove items from other projects before adding more'

      function rejectWithLimit(
        callIndexToReject: number,
      ): void {
        itemsResponder = (body, callIndex) => {
          if (callIndex === callIndexToReject) {
            throw createFetchError(
              422,
              'Knowledge item limit reached',
              limitWhy,
              limitFix,
            )
          }

          return defaultItemsResponder(body)
        }
      }

      it('stops the run and keeps the message, why and fix', async () => {
        const { upload } = createUpload()

        rejectWithLimit(0)

        await prepareAndStart(upload, createTextSources(30))

        expect(upload.phase.value).toBe('error')
        expect(upload.error.value).toEqual({
          message: 'Knowledge item limit reached',
          why: limitWhy,
          fix: limitFix,
          status: 422,
        })
        expect(upload.entries.value[0]?.status).toBe('failed')
        expect(upload.entries.value[0]?.error)
          .toBe('Knowledge item limit reached')
        expect(upload.entries.value[29]?.status).toBe('queued')
        expect(commitCalls()).toHaveLength(0)
      })

      it('keeps the created files when a later batch hits the limit', async () => {
        const { upload } = createUpload()

        rejectWithLimit(1)

        await prepareAndStart(upload, createTextSources(26))

        const statuses = upload.entries.value.map(entry => entry.status)

        expect(upload.phase.value).toBe('error')
        expect(upload.error.value?.status).toBe(422)
        expect(upload.error.value?.fix).toBe(limitFix)
        expect(statuses.slice(0, 25).every(status => status === 'ready'))
          .toBe(true)
        expect(statuses[25]).toBe('failed')
      })

      it('leaves the fix empty when the server sends none', async () => {
        const { upload } = createUpload()

        itemsResponder = () => {
          throw createFetchError(422, 'Knowledge item limit reached', limitWhy)
        }

        await prepareAndStart(upload, [createSource('a.md')])

        expect(upload.error.value?.why).toBe(limitWhy)
        expect(upload.error.value?.fix).toBeUndefined()
      })
    })

    it('stops the run when the original upload is out of storage', async () => {
      const { upload } = createUpload()

      mocks.uploadWithProgress.mockRejectedValue(
        createStatusError(400, 'Not enough storage space. Delete some files.'),
      )

      await prepareAndStart(upload, [
        createSource('a.md'),
        createSource('b.pdf'),
        createSource('c.md'),
      ])

      expect(upload.phase.value).toBe('error')
      expect(upload.error.value?.status).toBe(400)
      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'ready',
        'failed',
        'queued',
      ])
      expect(itemCalls()[0]?.body?.items).toHaveLength(1)
      expect(itemCalls()[0]?.body?.commit).toBe(true)
    })

    it('continues after a non-fatal original upload failure', async () => {
      const { upload } = createUpload()

      mocks.uploadWithProgress.mockRejectedValueOnce(
        createStatusError(400, 'File type must be one of: application/pdf'),
      )

      await prepareAndStart(upload, [
        createSource('a.png'),
        createSource('b.md'),
      ])

      expect(upload.phase.value).toBe('done')
      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'failed',
        'ready',
      ])
    })
  })

  describe('cancel and retry', () => {
    it('cancels extraction, keeps created items and commits them', async () => {
      const { upload } = createUpload()
      const sources = createTextSources(3)
      const signals: Array<AbortSignal | undefined> = []

      mocks.extractFile.mockImplementation((
        file: File,
        options: UploadFileOptions,
      ) => {
        signals.push(options.signal)

        if (file.name !== 'file-2.md') {
          return Promise.resolve(defaultExtraction(file))
        }

        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      })
      planSources(sources)
      await upload.prepare(sources)

      const running = upload.start()

      await flushAsync()
      upload.cancel()
      await running

      expect(signals[1]?.aborted).toBe(true)
      expect(upload.phase.value).toBe('done')
      expect(upload.wasCancelled.value).toBe(true)
      expect(upload.error.value).toBeNull()
      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'ready',
        'queued',
        'queued',
      ])
      expect(itemCalls()).toHaveLength(1)
      expect(itemCalls()[0]?.body?.items).toHaveLength(1)
      expect(itemCalls()[0]?.body?.commit).toBe(true)
      expect(mocks.extractFile).toHaveBeenCalledTimes(2)
    })

    it('aborts an in-flight original upload', async () => {
      const { upload } = createUpload()

      mocks.uploadWithProgress.mockImplementation((
        options: UploadFileOptions,
      ) => {
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(createStatusError(0, 'Upload was cancelled'))
          })
        })
      })
      planSources([createSource('a.pdf')])
      await upload.prepare([createSource('a.pdf')])

      const running = upload.start()

      await flushAsync()

      expect(upload.entries.value[0]?.status).toBe('uploading-original')

      upload.cancel()
      await running

      expect(upload.entries.value[0]?.status).toBe('queued')
      expect(upload.wasCancelled.value).toBe(true)
      expect(itemCalls()).toHaveLength(0)
    })

    it('ignores cancel when nothing is running', () => {
      const { upload } = createUpload()

      upload.cancel()

      expect(upload.wasCancelled.value).toBe(false)
      expect(upload.phase.value).toBe('idle')
    })

    it('resumes queued entries with start after a cancel', async () => {
      const { upload } = createUpload()
      const sources = createTextSources(2)
      let shouldHang = true

      mocks.extractFile.mockImplementation((
        file: File,
        options: UploadFileOptions,
      ) => {
        if (file.name !== 'file-2.md' || !shouldHang) {
          return Promise.resolve(defaultExtraction(file))
        }

        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      })
      planSources(sources)
      await upload.prepare(sources)

      const running = upload.start()

      await flushAsync()
      upload.cancel()
      await running

      shouldHang = false

      await upload.start()

      expect(upload.wasCancelled.value).toBe(false)
      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'ready',
        'ready',
      ])
    })

    it('retries only failed entries', async () => {
      const { upload } = createUpload()

      extractionOverrides.set('b.md', new Error('Worker crashed'))

      await prepareAndStart(upload, [
        createSource('a.md'),
        createSource('b.md'),
      ])

      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'ready',
        'failed',
      ])

      extractionOverrides.clear()
      mocks.extractFile.mockClear()
      recordedCalls.length = 0

      await upload.retryFailed()

      expect(mocks.extractFile).toHaveBeenCalledTimes(1)
      expect(mocks.extractFile.mock.calls[0]?.[0].name).toBe('b.md')
      expect(itemCalls()[0]?.body?.items).toHaveLength(1)
      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'ready',
        'ready',
      ])
      expect(upload.error.value).toBeNull()
    })

    it('ignores retry when nothing failed', async () => {
      const { upload } = createUpload()

      await prepareAndStart(upload, [createSource('a.md')])
      recordedCalls.length = 0
      mocks.extractFile.mockClear()

      await upload.retryFailed()

      expect(mocks.extractFile).not.toHaveBeenCalled()
      expect(recordedCalls).toHaveLength(0)
    })

    it('retries after a quota error without re-uploading originals', async () => {
      const { upload } = createUpload()
      let shouldReject = true

      itemsResponder = (body) => {
        if (shouldReject) {
          throw createFetchError(413, 'Not enough storage space')
        }

        return defaultItemsResponder(body)
      }

      await prepareAndStart(upload, [
        createSource('a.pdf'),
        createSource('b.md'),
      ])

      expect(upload.phase.value).toBe('error')
      expect(mocks.uploadWithProgress).toHaveBeenCalledTimes(1)

      shouldReject = false
      recordedCalls.length = 0

      await upload.retryFailed()

      expect(mocks.uploadWithProgress).toHaveBeenCalledTimes(1)
      expect(itemCalls()[0]?.body?.items[0].fileId).toBe('file-a.pdf')
      expect(upload.phase.value).toBe('done')
      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'ready',
        'ready',
      ])
    })

    it('continues queued entries after a stop when retrying', async () => {
      const { upload } = createUpload()
      let shouldReject = true

      itemsResponder = (body) => {
        if (shouldReject) {
          throw createFetchError(413, 'Not enough storage space')
        }

        return defaultItemsResponder(body)
      }

      await prepareAndStart(upload, createTextSources(26))

      shouldReject = false
      recordedCalls.length = 0

      await upload.retryFailed()

      expect(batchSizes()).toEqual([25, 1])
      expect(upload.entries.value.every(entry => entry.status === 'ready'))
        .toBe(true)
    })
  })

  describe('dispose', () => {
    it('aborts the run and disposes the extraction worker', async () => {
      const { upload } = createUpload()
      let capturedSignal: AbortSignal | undefined

      mocks.extractFile.mockImplementation((
        _file: File,
        options: UploadFileOptions,
      ) => {
        capturedSignal = options.signal

        return new Promise(() => {})
      })
      planSources([createSource('a.md')])
      await upload.prepare([createSource('a.md')])
      upload.start()
      await flushAsync()

      upload.dispose()

      expect(capturedSignal?.aborted).toBe(true)
      expect(mocks.disposeExtraction).toHaveBeenCalledTimes(1)
      expect(upload.phase.value).toBe('idle')
    })

    it('disposes when the owning scope stops', async () => {
      const { upload } = createUpload()

      await prepareAndStart(upload, [createSource('a.md')])
      scopes.splice(0).forEach(scope => scope.stop())

      expect(mocks.disposeExtraction).toHaveBeenCalledTimes(1)
    })
  })

  describe('syncFolder', () => {
    const existing = [
      { id: 'old-a', relativePath: 'a.md', contentHash: 'hash-a-1' },
      { id: 'old-b', relativePath: 'b.md', contentHash: 'hash-b-1' },
      { id: 'old-c', relativePath: 'c.md', contentHash: 'hash-c-1' },
    ]

    function createIncoming() {
      return [
        createSource('a.md', 'a.md'),
        createSource('b.md', 'b.md'),
        createSource('d.md', 'd.md'),
      ]
    }

    function planIncoming(incoming: ReturnType<typeof createIncoming>) {
      planSources(incoming, {
        'a.md': 'hash-a-1',
        'b.md': 'hash-b-2',
        'd.md': 'hash-d-1',
      })
    }

    it('previews the diff before touching the network', async () => {
      const { upload } = createUpload()
      const incoming = createIncoming()

      planIncoming(incoming)
      await upload.syncFolder({
        folderId: 'folder1',
        incoming,
        existing,
        walkedPaths: walkedPathsOf(incoming),
      })

      expect(upload.phase.value).toBe('preview')
      expect(upload.syncSummary.value).toMatchObject({
        added: 1,
        replaced: 1,
        removed: 1,
        unchanged: 1,
      })
      expect(upload.entries.value.map(entry => entry.name)).toEqual([
        'd.md',
        'b.md',
      ])
      expect(mocks.fetchMock).not.toHaveBeenCalled()
    })

    it('adds and replaces files, then commits once with the removals', async () => {
      const { upload } = createUpload()
      const incoming = createIncoming()

      planIncoming(incoming)
      await upload.syncFolder({
        folderId: 'folder1',
        incoming,
        existing,
        walkedPaths: walkedPathsOf(incoming),
      })
      await upload.start()

      expect(batchSizes()).toEqual([2])
      expect(itemCalls()[0]?.body?.commit).toBeUndefined()
      expect(itemCalls()[0]?.body?.items.map((item: any) => item.title))
        .toEqual(['d.md', 'b.md'])
      expect(itemCalls()[0]?.body?.items.every((item: any) => {
        return item.folderId === 'folder1'
          && item.relativePath === item.title
      })).toBe(true)
      expect(commitCalls()).toHaveLength(1)

      const commitBody = commitCalls()[0]?.body

      expect(commitBody?.folderId).toBe('folder1')
      expect([...(commitBody?.remove ?? [])].sort()).toEqual(['old-b', 'old-c'])
      expect(knowledgeCommitSchema.safeParse(commitBody).success).toBe(true)
      expect(upload.phase.value).toBe('done')
    })

    it('keeps the old version of a file whose replacement failed', async () => {
      const { upload } = createUpload()
      const incoming = createIncoming()

      extractionOverrides.set('b.md', new Error('Worker crashed'))
      planIncoming(incoming)
      await upload.syncFolder({
        folderId: 'folder1',
        incoming,
        existing,
        walkedPaths: walkedPathsOf(incoming),
      })
      await upload.start()

      expect(commitCalls()).toHaveLength(1)
      expect(commitCalls()[0]?.body?.remove).toEqual(['old-c'])
      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'ready',
        'failed',
      ])
    })

    it('only commits removals when nothing needs uploading', async () => {
      const { upload } = createUpload()
      const incoming = [createSource('a.md', 'a.md')]

      planSources(incoming, { 'a.md': 'hash-a-1' })
      await upload.syncFolder({
        folderId: 'folder1',
        incoming,
        existing,
        walkedPaths: walkedPathsOf(incoming),
      })
      await upload.start()

      expect(itemCalls()).toHaveLength(0)
      expect(mocks.extractFile).not.toHaveBeenCalled()
      expect(commitCalls()).toHaveLength(1)
      expect([...(commitCalls()[0]?.body?.remove ?? [])].sort()).toEqual([
        'old-b',
        'old-c',
      ])
    })

    it('does nothing when the folder is unchanged', async () => {
      const { upload } = createUpload()
      const incoming = [
        createSource('a.md', 'a.md'),
        createSource('b.md', 'b.md'),
        createSource('c.md', 'c.md'),
      ]

      planSources(incoming, {
        'a.md': 'hash-a-1',
        'b.md': 'hash-b-1',
        'c.md': 'hash-c-1',
      })
      await upload.syncFolder({
        folderId: 'folder1',
        incoming,
        existing,
        walkedPaths: walkedPathsOf(incoming),
      })
      await upload.start()

      expect(upload.syncSummary.value).toMatchObject({ unchanged: 3 })
      expect(mocks.fetchMock).not.toHaveBeenCalled()
      expect(upload.phase.value).toBe('done')
    })

    it('does not remove anything when the upload stops on an error', async () => {
      const { upload } = createUpload()
      const incoming = createIncoming()

      itemsResponder = () => {
        throw createFetchError(413, 'Not enough storage space')
      }
      planIncoming(incoming)
      await upload.syncFolder({
        folderId: 'folder1',
        incoming,
        existing,
        walkedPaths: walkedPathsOf(incoming),
      })
      await upload.start()

      expect(upload.phase.value).toBe('error')
      expect(commitCalls()).toHaveLength(0)
    })

    it('removes pure deletions after a retry completes the sync', async () => {
      const { upload } = createUpload()
      const incoming = createIncoming()
      let shouldReject = true

      itemsResponder = (body) => {
        if (shouldReject) {
          throw createFetchError(413, 'Not enough storage space')
        }

        return defaultItemsResponder(body)
      }
      planIncoming(incoming)
      await upload.syncFolder({
        folderId: 'folder1',
        incoming,
        existing,
        walkedPaths: walkedPathsOf(incoming),
      })
      await upload.start()

      shouldReject = false
      await upload.retryFailed()

      expect(commitCalls()).toHaveLength(1)
      expect([...(commitCalls()[0]?.body?.remove ?? [])].sort()).toEqual([
        'old-b',
        'old-c',
      ])
    })

    describe('with unknown stored hashes', () => {
      const unknownExisting = [
        { id: 'old-a', relativePath: 'a.md', contentHash: '', folderId: 'folder1' },
        { id: 'old-b', relativePath: 'b.md', contentHash: '', folderId: 'folder1' },
        { id: 'old-c', relativePath: 'c.md', contentHash: '', folderId: 'folder1' },
      ]

      function simulateServer(storedHashes: string[]) {
        const knownHashes = new Set<string>(storedHashes)

        itemsResponder = (body) => {
          versionCounter += 1

          const items: KnowledgeItem[] = []
          const skipped: Array<{ index: number, reason: 'duplicate' }> = []

          body.items.forEach((payload: Record<string, any>, index: number) => {
            if (knownHashes.has(payload.contentHash)) {
              skipped.push({ index, reason: 'duplicate' })

              return
            }

            knownHashes.add(payload.contentHash)
            items.push(createKnowledgeItem(payload))
          })

          return {
            items,
            skipped,
            version: versionCounter,
            packVersion: body.commit ? versionCounter : null,
          }
        }
      }

      function sameContentAs(name: string, otherName: string) {
        extractionOverrides.set(name, { contentHash: hashFor(otherName) })
      }

      async function runSync(
        incoming: ReturnType<typeof createSource>[],
        existingItems = unknownExisting,
        folderId = 'folder1',
      ) {
        const { upload } = createUpload()

        planSources(incoming)
        await upload.syncFolder({
          folderId,
          incoming,
          existing: existingItems,
          walkedPaths: walkedPathsOf(incoming),
        })
        await upload.start()

        return upload
      }

      it('keeps an unchanged file instead of removing its old item', async () => {
        simulateServer([hashFor('a.md')])

        const upload = await runSync(
          [createSource('a.md', 'a.md')],
          [unknownExisting[0]!],
        )

        expect(upload.entries.value.map(entry => entry.status)).toEqual([
          'skipped-duplicate',
        ])
        expect(commitCalls()).toHaveLength(0)
        expect(upload.syncResult.value).toMatchObject({
          uploaded: 0,
          skippedAsDuplicate: 1,
          kept: 0,
          removed: 0,
          unchangedUnknown: 1,
          notices: [],
        })
        expect(upload.phase.value).toBe('done')
      })

      it('replaces a changed file and removes only its old item', async () => {
        simulateServer([hashFor('a.md')])
        extractionOverrides.set('a.md', { contentHash: hashFor('a.md:v2') })

        const upload = await runSync(
          [createSource('a.md', 'a.md')],
          [unknownExisting[0]!],
        )

        expect(commitCalls()).toHaveLength(1)
        expect(commitCalls()[0]?.body).toEqual({
          folderId: 'folder1',
          remove: ['old-a'],
        })
        expect(upload.syncResult.value).toMatchObject({
          uploaded: 1,
          skippedAsDuplicate: 0,
          removed: 1,
          unchangedUnknown: 0,
        })
      })

      it('keeps the old path of a renamed identical file and says so', async () => {
        simulateServer([hashFor('a.md')])
        sameContentAs('a2.md', 'a.md')

        const upload = await runSync(
          [createSource('a2.md', 'a2.md')],
          [unknownExisting[0]!],
        )

        expect(upload.entries.value.map(entry => entry.status)).toEqual([
          'skipped-duplicate',
        ])
        expect(commitCalls()).toHaveLength(0)
        expect(upload.syncResult.value).toMatchObject({
          uploaded: 0,
          skippedAsDuplicate: 1,
          kept: 1,
          removed: 0,
          notices: [
            '1 file kept under its old name — it looks like a renamed copy.',
          ],
        })
      })

      it('removes a deleted file when nothing was skipped as a rename', async () => {
        simulateServer([
          hashFor('a.md'),
          hashFor('b.md'),
        ])

        const upload = await runSync(
          [createSource('a.md', 'a.md')],
          [unknownExisting[0]!, unknownExisting[1]!],
        )

        expect(commitCalls()).toHaveLength(1)
        expect(commitCalls()[0]?.body).toEqual({
          folderId: 'folder1',
          remove: ['old-b'],
        })
        expect(upload.syncResult.value).toMatchObject({
          uploaded: 0,
          removed: 1,
          unchangedUnknown: 1,
          kept: 0,
        })
      })

      it('handles unchanged, changed, new, renamed and deleted together', async () => {
        simulateServer([
          hashFor('a.md'),
          hashFor('b.md'),
          hashFor('c.md'),
          hashFor('e.md'),
        ])
        extractionOverrides.set('b.md', { contentHash: hashFor('b.md:v2') })
        sameContentAs('e2.md', 'e.md')

        const upload = await runSync(
          [
            createSource('a.md', 'a.md'),
            createSource('b.md', 'b.md'),
            createSource('d.md', 'd.md'),
            createSource('e2.md', 'e2.md'),
          ],
          [
            ...unknownExisting,
            {
              id: 'old-e',
              relativePath: 'e.md',
              contentHash: '',
              folderId: 'folder1',
            },
          ],
        )

        expect(commitCalls()).toHaveLength(1)
        expect(commitCalls()[0]?.body).toEqual({
          folderId: 'folder1',
          remove: ['old-b'],
        })
        expect(upload.syncResult.value).toMatchObject({
          uploaded: 2,
          skippedAsDuplicate: 2,
          unchangedUnknown: 1,
          kept: 2,
          removed: 1,
        })
        expect(upload.syncResult.value?.notices).toEqual([
          '2 files kept under their old name — they look like renamed copies.',
        ])
      })

      it('sends one bare commit when files were only added', async () => {
        simulateServer([])

        const upload = await runSync([createSource('d.md', 'd.md')], [])

        expect(commitCalls()).toHaveLength(1)
        expect(commitCalls()[0]?.body).toEqual({})
        expect(itemCalls()[0]?.body?.commit).toBeUndefined()
        expect(knowledgeCommitSchema.safeParse(commitCalls()[0]?.body).success)
          .toBe(true)
        expect(upload.syncResult.value).toMatchObject({
          uploaded: 1,
          removed: 0,
        })
      })

      it('creates items with the folder id that the commit later uses', async () => {
        simulateServer([hashFor('a.md')])
        extractionOverrides.set('a.md', { contentHash: hashFor('a.md:v2') })

        await runSync([createSource('a.md', 'a.md')], [unknownExisting[0]!])

        const createdFolderIds = itemCalls().flatMap((call) => {
          return call.body?.items.map((item: any) => item.folderId)
        })

        expect(createdFolderIds).toEqual(['folder1'])
        expect(commitCalls()[0]?.body?.folderId).toBe('folder1')
      })

      it('never removes items that belong to another folder', async () => {
        simulateServer([hashFor('a.md')])

        const upload = await runSync(
          [createSource('a.md', 'a.md')],
          [
            unknownExisting[0]!,
            {
              id: 'foreign',
              relativePath: 'z.md',
              contentHash: '',
              folderId: 'other-folder',
            },
            {
              id: 'loose',
              relativePath: 'y.md',
              contentHash: '',
              folderId: null,
            },
          ],
        )

        expect(commitCalls()).toHaveLength(0)
        expect(upload.syncResult.value).toMatchObject({
          kept: 2,
          removed: 0,
          notices: ['2 items belong to a different folder and was kept.'],
        })
      })

      it('reports ids the server could not remove as a notice', async () => {
        simulateServer([hashFor('a.md'), hashFor('c.md')])
        commitExtras = { skipped: ['old-b'] }
        extractionOverrides.set('b.md', { contentHash: hashFor('b.md:v2') })

        const upload = await runSync(
          [createSource('b.md', 'b.md')],
          [unknownExisting[1]!, unknownExisting[2]!],
        )

        expect([...(commitCalls()[0]?.body?.remove ?? [])].sort()).toEqual([
          'old-b',
          'old-c',
        ])
        expect(upload.syncResult.value).toMatchObject({
          removed: 1,
          couldNotRemove: 1,
          notices: ['1 item could not be removed.'],
        })
        expect(upload.phase.value).toBe('done')
      })

      it('stops without removals when a batch fails', async () => {
        itemsResponder = () => {
          throw createFetchError(500, 'Boom')
        }

        const upload = await runSync(
          [createSource('b.md', 'b.md'), createSource('d.md', 'd.md')],
          [unknownExisting[1]!, unknownExisting[2]!],
        )

        expect(upload.phase.value).toBe('error')
        expect(commitCalls()).toHaveLength(0)
        expect(upload.syncResult.value).toMatchObject({
          uploaded: 0,
          removed: 0,
        })
      })

      it('rejects a folder id the server would refuse', async () => {
        const { upload } = createUpload()
        const incoming = [createSource('a.md', 'a.md')]

        planSources(incoming)
        await upload.syncFolder({
          folderId: 'bad id!',
          incoming,
          existing: [],
          walkedPaths: walkedPathsOf(incoming),
        })

        expect(upload.phase.value).toBe('error')
        expect(upload.error.value?.status).toBe(400)
        expect(mocks.fetchMock).not.toHaveBeenCalled()
      })
    })

    describe('with stored hashes exposed by the server', () => {
      function storedItem(name: string, relativePath = name) {
        return {
          id: `old-${name}`,
          relativePath,
          contentHash: hashFor(name),
          folderId: 'folder1',
        }
      }

      function simulateServer(storedNames: string[]) {
        const knownHashes = new Set<string>(storedNames.map(hashFor))

        itemsResponder = (body) => {
          versionCounter += 1

          const items: KnowledgeItem[] = []
          const skipped: Array<{ index: number, reason: 'duplicate' }> = []

          body.items.forEach((payload: Record<string, any>, index: number) => {
            if (knownHashes.has(payload.contentHash)) {
              skipped.push({ index, reason: 'duplicate' })

              return
            }

            knownHashes.add(payload.contentHash)
            items.push(createKnowledgeItem(payload))
          })

          return {
            items,
            skipped,
            version: versionCounter,
            packVersion: body.commit ? versionCounter : null,
          }
        }
      }

      function sameContentAs(name: string, otherName: string) {
        hashesByName.set(name, hashFor(otherName))
      }

      async function runSync(
        incoming: ReturnType<typeof createSource>[],
        existingItems: ReturnType<typeof storedItem>[],
      ) {
        const { upload } = createUpload()
        const plannedHashes = Object.fromEntries(
          incoming.map(source => [source.file.name, hashFor(source.file.name)]),
        )

        planSources(incoming, plannedHashes)
        await upload.syncFolder({
          folderId: 'folder1',
          incoming,
          existing: existingItems,
          walkedPaths: walkedPathsOf(incoming),
        })
        await upload.start()

        return upload
      }

      it('skips unchanged files without extracting or uploading them', async () => {
        simulateServer(['a.md', 'b.md'])
        extractionOverrides.set('b.md', { contentHash: hashFor('b.md:v2') })

        const incoming = [
          createSource('a.md', 'a.md'),
          createSource('b.md', 'b.md'),
        ]
        const { upload } = createUpload()

        planSources(incoming, {
          'a.md': hashFor('a.md'),
          'b.md': hashFor('b.md:v2'),
        })
        await upload.syncFolder({
          folderId: 'folder1',
          incoming,
          existing: [storedItem('a.md'), storedItem('b.md')],
          walkedPaths: walkedPathsOf(incoming),
        })
        await upload.start()

        expect(upload.syncSummary.value).toMatchObject({
          added: 0,
          replaced: 1,
          removed: 0,
          unchanged: 1,
        })
        expect(mocks.extractFile).toHaveBeenCalledTimes(1)
        expect(itemCalls()).toHaveLength(1)
        expect(itemCalls()[0]?.body?.items.map((item: any) => item.title))
          .toEqual(['b.md'])
        expect(commitCalls()[0]?.body).toEqual({
          folderId: 'folder1',
          remove: ['old-b.md'],
        })
      })

      it('does not touch the network when every file is unchanged', async () => {
        simulateServer(['a.md', 'b.md'])

        const upload = await runSync(
          [createSource('a.md', 'a.md'), createSource('b.md', 'b.md')],
          [storedItem('a.md'), storedItem('b.md')],
        )

        expect(mocks.extractFile).not.toHaveBeenCalled()
        expect(mocks.fetchMock).not.toHaveBeenCalled()
        expect(upload.syncSummary.value).toMatchObject({ unchanged: 2 })
        expect(upload.phase.value).toBe('done')
      })

      it('removes a deleted file although an unrelated add was skipped as a duplicate', async () => {
        simulateServer(['a.md', 'c.md', 'elsewhere.md'])
        sameContentAs('d.md', 'elsewhere.md')

        const upload = await runSync(
          [createSource('a.md', 'a.md'), createSource('d.md', 'd.md')],
          [storedItem('a.md'), storedItem('c.md')],
        )

        expect(commitCalls()).toHaveLength(1)
        expect(commitCalls()[0]?.body).toEqual({
          folderId: 'folder1',
          remove: ['old-c.md'],
        })
        expect(upload.syncResult.value).toMatchObject({
          skippedAsDuplicate: 1,
          unchanged: 1,
          removed: 1,
          kept: 0,
          notices: [],
        })
      })

      it('keeps the old item of a file whose renamed copy was skipped', async () => {
        simulateServer(['a.md', 'c.md'])
        sameContentAs('c-renamed.md', 'c.md')

        const upload = await runSync(
          [
            createSource('a.md', 'a.md'),
            createSource('c-renamed.md', 'c-renamed.md'),
          ],
          [storedItem('a.md'), storedItem('c.md')],
        )

        expect(commitCalls()).toHaveLength(0)
        expect(upload.syncResult.value).toMatchObject({
          removed: 0,
          kept: 1,
          notices: [
            '1 file kept under its old name — it looks like a renamed copy.',
          ],
        })
      })

      it('reports the removal count the server answered with', async () => {
        simulateServer(['a.md', 'b.md'])

        const upload = await runSync(
          [createSource('a.md', 'a.md')],
          [storedItem('a.md'), storedItem('b.md')],
        )

        expect(upload.syncResult.value).toMatchObject({
          removed: 1,
          couldNotRemove: 0,
        })
      })
    })
  })

  describe('orphaned uploads', () => {
    function skipFirstItem(body: Record<string, any>): ItemsResponse {
      versionCounter += 1

      return {
        items: body.items.slice(1).map(createKnowledgeItem),
        skipped: [{ index: 0, reason: 'duplicate' }],
        version: versionCounter,
        packVersion: body.commit ? versionCounter : null,
      }
    }

    it('deletes the upload of an item the server skipped as a duplicate', async () => {
      const { upload } = createUpload()

      itemsResponder = skipFirstItem
      await prepareAndStart(upload, [
        createSource('a.pdf'),
        createSource('b.pdf'),
      ])

      expect(fileDeleteCalls()).toEqual(['/api/v1/files/file-a.pdf'])
      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'skipped-duplicate',
        'ready',
      ])
      expect(upload.cleanupFailures.value).toBe(0)
    })

    it('never deletes a library file that was skipped as a duplicate', async () => {
      const { upload } = createUpload()
      const source = { ...createSource('lib.pdf'), fileId: 'library-file' }

      itemsResponder = skipFirstItem
      await prepareAndStart(upload, [source, createSource('b.pdf')])

      expect(upload.entries.value[0]?.status).toBe('skipped-duplicate')
      expect(fileDeleteCalls()).toEqual([])
    })

    it('keeps the originals of created items', async () => {
      const { upload } = createUpload()

      await prepareAndStart(upload, [
        createSource('a.pdf'),
        createSource('b.png'),
      ])
      upload.reset()
      await flushAsync()

      expect(fileDeleteCalls()).toEqual([])
    })

    it('counts the uploads it could not delete', async () => {
      const { upload } = createUpload()

      failingFileDeletes.add('/api/v1/files/file-a.pdf')
      itemsResponder = skipFirstItem
      await prepareAndStart(upload, [
        createSource('a.pdf'),
        createSource('b.pdf'),
      ])

      expect(upload.cleanupFailures.value).toBe(1)
      expect(upload.phase.value).toBe('done')
    })

    it('cleans up duplicate uploads of a folder sync and reports failures', async () => {
      const { upload } = createUpload()
      const incoming = [
        createSource('a.pdf', 'a.pdf'),
        createSource('b.pdf', 'b.pdf'),
      ]

      failingFileDeletes.add('/api/v1/files/file-b.pdf')
      itemsResponder = (body) => {
        versionCounter += 1

        return {
          items: [],
          skipped: body.items.map((_: unknown, index: number) => {
            return { index, reason: 'duplicate' }
          }),
          version: versionCounter,
          packVersion: null,
        }
      }
      planSources(incoming)
      await upload.syncFolder({
        folderId: 'folder1',
        incoming,
        existing: [
          { id: 'old-a', relativePath: 'a.pdf', contentHash: '' },
          { id: 'old-b', relativePath: 'b.pdf', contentHash: '' },
        ],
        walkedPaths: ['a.pdf', 'b.pdf'],
      })
      await upload.start()

      expect(fileDeleteCalls()).toEqual([
        '/api/v1/files/file-a.pdf',
        '/api/v1/files/file-b.pdf',
      ])
      expect(upload.syncResult.value?.cleanupFailures).toBe(1)
      expect(upload.cleanupFailures.value).toBe(1)
    })

    it('keeps uploads of failed entries for a retry, then deletes them on reset', async () => {
      const { upload } = createUpload()

      itemsResponder = () => {
        throw createFetchError(413, 'Not enough storage space')
      }
      await prepareAndStart(upload, [
        createSource('a.pdf'),
        createSource('b.md'),
      ])

      expect(upload.phase.value).toBe('error')
      expect(fileDeleteCalls()).toEqual([])

      upload.reset()
      await flushAsync()

      expect(fileDeleteCalls()).toEqual(['/api/v1/files/file-a.pdf'])
    })

    it('deletes uploads that were never sent when the run is discarded', async () => {
      const { upload } = createUpload()

      mocks.extractFile.mockImplementation(async (file: File) => {
        if (file.name === 'b.md') {
          return new Promise(() => {})
        }

        return defaultExtraction(file)
      })
      planSources([createSource('a.pdf'), createSource('b.md')])
      await upload.prepare([createSource('a.pdf'), createSource('b.md')])
      upload.start()
      await flushAsync()
      upload.reset()
      await flushAsync()

      expect(itemCalls()).toHaveLength(0)
      expect(fileDeleteCalls()).toEqual(['/api/v1/files/file-a.pdf'])
    })

    it('deletes an upload that finishes after the run was discarded', async () => {
      const { upload } = createUpload()
      let finishUpload: (() => void) | undefined

      mocks.uploadWithProgress.mockImplementation((
        options: { file: File },
      ) => {
        return new Promise((resolve) => {
          finishUpload = () => {
            resolve({ data: { id: `file-${options.file.name}` } })
          }
        })
      })
      planSources([createSource('a.pdf')])
      await upload.prepare([createSource('a.pdf')])
      upload.start()
      await flushAsync()
      upload.reset()
      finishUpload?.()
      await flushAsync()

      expect(itemCalls()).toHaveLength(0)
      expect(fileDeleteCalls()).toEqual(['/api/v1/files/file-a.pdf'])
    })

    it('keeps the originals of items created before a cancel', async () => {
      const { upload } = createUpload()

      mocks.extractFile.mockImplementation(async (
        file: File,
        options: UploadFileOptions,
      ) => {
        if (file.name === 'b.md') {
          return new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          })
        }

        return defaultExtraction(file)
      })
      planSources([createSource('a.pdf'), createSource('b.md')])
      await upload.prepare([createSource('a.pdf'), createSource('b.md')])

      const running = upload.start()

      await flushAsync()
      upload.cancel()
      await running
      upload.reset()
      await flushAsync()

      expect(itemCalls()).toHaveLength(1)
      expect(fileDeleteCalls()).toEqual([])
    })

    it('deletes stranded uploads when a new run replaces a failed one', async () => {
      const { upload } = createUpload()

      itemsResponder = () => {
        throw createFetchError(413, 'Not enough storage space')
      }
      await prepareAndStart(upload, [createSource('a.pdf')])

      planSources([createSource('c.md')])
      await upload.prepare([createSource('c.md')])
      await flushAsync()

      expect(fileDeleteCalls()).toEqual(['/api/v1/files/file-a.pdf'])
    })
  })

  describe('uncommitted batches', () => {
    function hangOn(name: string) {
      mocks.extractFile.mockImplementation(async (file: File) => {
        if (file.name === name) {
          return new Promise(() => {})
        }

        return defaultExtraction(file)
      })
    }

    async function startWithOneFlushedBatch(
      upload: ReturnType<typeof createUpload>['upload'],
    ) {
      const sources = createTextSources(27)

      hangOn('file-27.md')
      planSources(sources)
      await upload.prepare(sources)
      upload.start()
      await flushAsync()
    }

    function bareCommitUrls(): string[] {
      return commitCalls().map(call => call.url)
    }

    it('commits the flushed batches when the run is reset', async () => {
      const { upload, projectIdRef } = createUpload()

      await startWithOneFlushedBatch(upload)

      expect(batchSizes()).toEqual([25])
      expect(commitCalls()).toHaveLength(0)

      upload.reset()
      await flushAsync()

      expect(bareCommitUrls()).toEqual([
        `/api/v1/projects/${projectIdRef.value}/knowledge/commit`,
      ])
      expect(commitCalls()[0]?.body).toEqual({})
    })

    it('commits the previous project when the project changes', async () => {
      const { upload, projectIdRef } = createUpload()
      const previousProjectId = projectIdRef.value

      await startWithOneFlushedBatch(upload)
      projectIdRef.value = 'another-project'
      await flushAsync()

      expect(bareCommitUrls()).toEqual([
        `/api/v1/projects/${previousProjectId}/knowledge/commit`,
      ])
    })

    it('commits the flushed batches on dispose', async () => {
      const { upload } = createUpload()

      await startWithOneFlushedBatch(upload)
      upload.dispose()
      await flushAsync()

      expect(commitCalls()).toHaveLength(1)
    })

    it('sends no commit on reset when everything was committed', async () => {
      const { upload } = createUpload()

      await prepareAndStart(upload, createTextSources(3))
      upload.reset()
      await flushAsync()

      expect(commitCalls()).toHaveLength(0)
    })

    it('swallows a failing background commit', async () => {
      const { upload } = createUpload()

      await startWithOneFlushedBatch(upload)
      failingCommitCount = 1

      expect(() => upload.reset()).not.toThrow()
      await flushAsync()

      expect(commitCalls()).toHaveLength(1)
    })

    describe('retrying a failed final commit', () => {
      async function syncWithFailingCommit() {
        const { upload } = createUpload()
        const incoming = [createSource('d.md', 'd.md')]

        failingCommitCount = 1
        planSources(incoming)
        await upload.syncFolder({
          folderId: 'folder1',
          incoming,
          existing: [],
          walkedPaths: ['d.md'],
        })
        await upload.start()

        return upload
      }

      it('offers a retry when only the commit failed', async () => {
        const upload = await syncWithFailingCommit()

        expect(upload.phase.value).toBe('error')
        expect(upload.failedCount.value).toBe(0)
        expect(upload.canRetryCommit.value).toBe(true)
      })

      it('sends the commit again and finishes', async () => {
        const upload = await syncWithFailingCommit()

        await upload.retryCommit()

        expect(commitCalls()).toHaveLength(2)
        expect(upload.phase.value).toBe('done')
        expect(upload.error.value).toBeNull()
        expect(upload.canRetryCommit.value).toBe(false)
        expect(refreshSummary).toHaveBeenCalledTimes(2)
      })

      it('keeps offering the retry while the commit keeps failing', async () => {
        const upload = await syncWithFailingCommit()

        failingCommitCount = 1
        await upload.retryCommit()

        expect(upload.phase.value).toBe('error')
        expect(upload.canRetryCommit.value).toBe(true)
      })

      it('retries the removals of a folder sync', async () => {
        const { upload } = createUpload()
        const incoming = [createSource('d.md', 'd.md')]

        failingCommitCount = 1
        planSources(incoming)
        await upload.syncFolder({
          folderId: 'folder1',
          incoming,
          existing: [{ id: 'old-c', relativePath: 'c.md', contentHash: '' }],
          walkedPaths: ['d.md'],
        })
        await upload.start()
        await upload.retryCommit()

        expect(commitCalls()[1]?.body).toEqual({
          folderId: 'folder1',
          remove: ['old-c'],
        })
        expect(upload.syncResult.value?.removed).toBe(1)
      })

      it('does not offer it while entries failed', async () => {
        const { upload } = createUpload()

        extractionOverrides.set('file-26.md', new Error('Worker crashed'))
        await prepareAndStart(upload, createTextSources(26))

        expect(upload.failedCount.value).toBe(1)
        expect(upload.canRetryCommit.value).toBe(false)
      })

      it('ignores the retry when nothing is pending', async () => {
        const { upload } = createUpload()

        await prepareAndStart(upload, [createSource('a.md')])
        await upload.retryCommit()

        expect(commitCalls()).toHaveLength(0)
        expect(upload.canRetryCommit.value).toBe(false)
      })
    })
  })

  describe('conflicting batches', () => {
    function rejectConflicts(titles: string[]) {
      itemsResponder = (body) => {
        const hasConflict = body.items.some((item: Record<string, any>) => {
          return titles.includes(item.title)
        })

        if (body.items.length > 1 && hasConflict) {
          throw createFetchError(409, 'This file is already in the project')
        }

        const conflicting = body.items.find((item: Record<string, any>) => {
          return titles.includes(item.title)
        })

        if (conflicting) {
          throw createFetchError(409, `${conflicting.title} is already linked`)
        }

        return defaultItemsResponder(body)
      }
    }

    it('retries a rejected batch one item at a time', async () => {
      const { upload } = createUpload()

      rejectConflicts(['b.md'])
      await prepareAndStart(upload, [
        createSource('a.md'),
        createSource('b.md'),
        createSource('c.md'),
      ])

      expect(batchSizes()).toEqual([3, 1, 1, 1])
      expect(itemCalls().slice(1).every((call) => {
        return call.body?.commit === undefined
      })).toBe(true)
      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'ready',
        'failed',
        'ready',
      ])
      expect(upload.entries.value[1]?.error).toBe('b.md is already linked')
      expect(upload.phase.value).toBe('done')
      expect(upload.error.value).toBeNull()
    })

    it('commits the created items after the fallback', async () => {
      const { upload } = createUpload()

      rejectConflicts(['b.md'])
      await prepareAndStart(upload, [
        createSource('a.md'),
        createSource('b.md'),
      ])

      expect(commitCalls()).toHaveLength(1)
      expect(commitCalls()[0]?.body).toEqual({})
    })

    it('fails only the entry of a single rejected item and keeps going', async () => {
      const { upload } = createUpload()

      rejectConflicts(['a.md'])
      await prepareAndStart(upload, [createSource('a.md')])

      expect(upload.entries.value[0]).toMatchObject({
        status: 'failed',
        error: 'a.md is already linked',
      })
      expect(upload.phase.value).toBe('done')
      expect(upload.failedCount.value).toBe(1)
    })

    it('stops on a non-conflict failure during the fallback', async () => {
      const { upload } = createUpload()

      itemsResponder = (body) => {
        if (body.items.length > 1) {
          throw createFetchError(409, 'Conflict')
        }

        if (body.items[0].title === 'b.md') {
          throw createFetchError(413, 'Not enough storage space')
        }

        return defaultItemsResponder(body)
      }
      await prepareAndStart(upload, [
        createSource('a.md'),
        createSource('b.md'),
        createSource('c.md'),
      ])

      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'ready',
        'failed',
        'failed',
      ])
      expect(upload.phase.value).toBe('error')
    })
  })

  describe('PDFs this device cannot read', () => {
    function cannotReadPdf(overrides: Partial<KnowledgeExtractionResult> = {}) {
      extractionOverrides.set('scan.pdf', {
        extractStatus: 'failed',
        extractError: 'ios-update-required',
        extractor: 'client-unpdf',
        text: '',
        pageCount: null,
        needsOriginalUpload: true,
        ...overrides,
      })
    }

    it('uploads the original and creates a native PDF item without text', async () => {
      const { upload } = createUpload()

      cannotReadPdf()
      await prepareAndStart(upload, [createSource('scan.pdf')])

      const [item] = itemCalls()[0]?.body?.items ?? []

      expect(mocks.uploadWithProgress).toHaveBeenCalledTimes(1)
      expect(item).toMatchObject({
        fileId: 'file-scan.pdf',
        extractStatus: 'no-text',
        extractError: 'ios-update-required',
        extractor: 'client-unpdf',
        text: '',
      })
      expect(knowledgeItemsBatchCreateSchema.safeParse(
        itemCalls()[0]?.body,
      ).success).toBe(true)
      expect(upload.entries.value[0]?.status).toBe('no-text')
      expect(upload.phase.value).toBe('done')
    })

    it('links a library PDF without uploading it again', async () => {
      const { upload } = createUpload()
      const source = { ...createSource('scan.pdf'), fileId: 'library-file' }

      cannotReadPdf()
      await prepareAndStart(upload, [source])

      expect(mocks.uploadWithProgress).not.toHaveBeenCalled()
      expect(itemCalls()[0]?.body?.items[0]).toMatchObject({
        fileId: 'library-file',
        extractStatus: 'no-text',
      })
    })

    it('still fails other extraction errors without uploading', async () => {
      const { upload } = createUpload()

      cannotReadPdf({ extractError: 'invalid-pdf', needsOriginalUpload: false })
      await prepareAndStart(upload, [createSource('scan.pdf')])

      expect(mocks.uploadWithProgress).not.toHaveBeenCalled()
      expect(itemCalls()).toHaveLength(0)
      expect(upload.entries.value[0]?.status).toBe('failed')
    })

    it('fails the entry when the PDF cannot be uploaded as an original', async () => {
      const { upload } = createUpload()

      cannotReadPdf({ needsOriginalUpload: false })
      await prepareAndStart(upload, [createSource('scan.pdf')])

      expect(itemCalls()).toHaveLength(0)
      expect(upload.entries.value[0]?.status).toBe('failed')
    })
  })

  describe('refreshing', () => {
    it('refreshes the summary once when a run finishes', async () => {
      const { upload } = createUpload()

      await prepareAndStart(upload, createTextSources(3))

      expect(refreshSummary).toHaveBeenCalledTimes(1)
    })
  })

  describe('folder sync removals', () => {
    function syncInput(
      overrides: Partial<Parameters<
        ReturnType<typeof createUpload>['upload']['syncFolder']
      >[0]>,
    ) {
      const incoming = [createSource('a.md', 'a.md')]

      return {
        folderId: 'folder1',
        incoming,
        existing: [
          { id: 'old-a', relativePath: 'a.md', contentHash: 'hash-a-1' },
          { id: 'old-big', relativePath: 'big.bin', contentHash: '' },
          { id: 'old-c', relativePath: 'c.md', contentHash: '' },
        ],
        walkedPaths: ['a.md', 'big.bin'],
        ...overrides,
      }
    }

    it('keeps items whose file is still on disk but was skipped by the plan', async () => {
      const { upload } = createUpload()
      const input = syncInput({})

      planSources(input.incoming, { 'a.md': 'hash-a-1' })
      await upload.syncFolder(input)

      expect(upload.syncSummary.value).toMatchObject({
        removed: 1,
        unchanged: 1,
        notices: ['1 file is no longer eligible and was kept.'],
      })

      await upload.start()

      expect(commitCalls()).toHaveLength(1)
      expect(commitCalls()[0]?.body).toEqual({
        folderId: 'folder1',
        remove: ['old-c'],
      })
      expect(upload.syncResult.value?.notices).toEqual([
        '1 file is no longer eligible and was kept.',
      ])
    })

    it('removes nothing when the folder walk was truncated', async () => {
      const { upload } = createUpload()
      const input = syncInput({ truncated: true })

      planSources(input.incoming, { 'a.md': 'hash-a-1' })
      await upload.syncFolder(input)

      expect(upload.syncSummary.value).toMatchObject({ removed: 0 })
      expect(upload.syncSummary.value?.notices).toEqual([
        '1 file is no longer eligible and was kept.',
        'Your folder has more files than were read, so nothing was removed.',
      ])

      await upload.start()

      expect(commitCalls()).toHaveLength(0)
      expect(upload.syncResult.value).toMatchObject({ removed: 0 })
      expect(upload.syncResult.value?.notices).toContain(
        'Your folder has more files than were read, so nothing was removed.',
      )
      expect(upload.phase.value).toBe('done')
    })

    it('still replaces changed files when the walk was truncated', async () => {
      const { upload } = createUpload()
      const input = syncInput({ truncated: true })

      planSources(input.incoming, { 'a.md': 'hash-a-2' })
      await upload.syncFolder(input)
      await upload.start()

      expect(batchSizes()).toEqual([1])
      expect(commitCalls()[0]?.body).toEqual({
        folderId: 'folder1',
        remove: ['old-a'],
      })
    })

    it('removes only what is absent from the walked paths', async () => {
      const { upload } = createUpload()
      const input = syncInput({ walkedPaths: ['a.md'] })

      planSources(input.incoming, { 'a.md': 'hash-a-1' })
      await upload.syncFolder(input)
      await upload.start()

      expect([...(commitCalls()[0]?.body?.remove ?? [])].sort()).toEqual([
        'old-big',
        'old-c',
      ])
    })
  })

  describe('unlinked upload budget', () => {
    const megabyte = 1024 * 1024

    function createSizedPdf(name: string, megabytes: number) {
      const file = new File(['content'], name, { type: 'application/pdf' })

      Object.defineProperty(file, 'size', { value: megabytes * megabyte })

      return { file, relativePath: null }
    }

    it('flushes the pending batch before an upload would pass 10 MB', async () => {
      const { upload } = createUpload()
      const order: string[] = []

      mocks.uploadWithProgress.mockImplementation(async (
        options: { file: File },
      ) => {
        order.push(`upload:${options.file.name}`)

        return { data: { id: `file-${options.file.name}` } }
      })

      const originalImplementation = mocks.fetchMock.getMockImplementation()!

      mocks.fetchMock.mockImplementation(async (
        url: string,
        options: { method?: string } = {},
      ) => {
        if (url.endsWith('/items')) {
          order.push('post:items')
        }

        return originalImplementation(url, options)
      })
      await prepareAndStart(upload, [
        createSizedPdf('a.pdf', 6),
        createSizedPdf('b.pdf', 6),
        createSizedPdf('c.pdf', 3),
      ])

      expect(order).toEqual([
        'upload:a.pdf',
        'post:items',
        'upload:b.pdf',
        'upload:c.pdf',
        'post:items',
      ])
      expect(batchSizes()).toEqual([1, 2])
      expect(upload.phase.value).toBe('done')
    })

    it('does not flush while the unlinked uploads stay under the budget', async () => {
      const { upload } = createUpload()

      await prepareAndStart(upload, [
        createSizedPdf('a.pdf', 4),
        createSizedPdf('b.pdf', 4),
        createSizedPdf('c.pdf', 2),
      ])

      expect(batchSizes()).toEqual([3])
    })

    it('stops the run when the early flush fails', async () => {
      const { upload } = createUpload()

      itemsResponder = () => {
        throw createFetchError(413, 'Not enough storage space')
      }
      await prepareAndStart(upload, [
        createSizedPdf('a.pdf', 6),
        createSizedPdf('b.pdf', 6),
      ])

      expect(upload.phase.value).toBe('error')
      expect(mocks.uploadWithProgress).toHaveBeenCalledTimes(1)
      expect(upload.entries.value.map(entry => entry.status)).toEqual([
        'failed',
        'queued',
      ])
    })
  })
})
