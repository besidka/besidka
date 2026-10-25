import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import {
  KNOWLEDGE_EXTRACTION_TIMEOUT_MS,
  KNOWLEDGE_WORKER_IDLE_MS,
  useKnowledgeExtraction,
} from '~/composables/knowledge-extract'
import type {
  KnowledgeWorkerRequest,
  KnowledgeWorkerResult,
} from '~/types/knowledge-extract.d'

const HASH = 'a'.repeat(64)

class FakeWorker {
  static instances: FakeWorker[] = []

  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  posted: Array<{ request: KnowledgeWorkerRequest, transfer: unknown[] }> = []
  terminate = vi.fn()

  constructor(
    public url: URL,
    public options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this)
  }

  postMessage(request: KnowledgeWorkerRequest, transfer: unknown[]): void {
    this.posted.push({ request, transfer })
  }

  reply(index: number, result: Partial<KnowledgeWorkerResult> = {}): void {
    const posted = this.posted[index]

    this.onmessage?.({
      data: {
        id: posted?.request.id,
        extractor: 'text',
        extractStatus: 'ready',
        extractError: null,
        text: 'extracted',
        pageCount: null,
        contentHash: HASH,
        ...result,
      },
    })
  }
}

function textFile(name: string, content: string = 'hello'): File {
  return new File([content], name)
}

async function waitForPosts(worker: FakeWorker, count: number) {
  await vi.waitFor(() => expect(worker.posted).toHaveLength(count))
}

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useKnowledgeExtraction worker protocol', () => {
  it('creates the module worker lazily and transfers the file buffer', async () => {
    const { extractFile } = useKnowledgeExtraction()

    expect(FakeWorker.instances).toHaveLength(0)

    const extraction = extractFile(textFile('notes.md'))

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const worker = FakeWorker.instances[0]!

    await waitForPosts(worker, 1)

    expect(worker.options).toEqual({ type: 'module' })
    expect(worker.posted[0]?.request.name).toBe('notes.md')
    expect(worker.posted[0]?.transfer).toEqual([
      worker.posted[0]?.request.bytes,
    ])

    worker.reply(0)

    const result = await extraction

    expect(result).toEqual({
      extractor: 'text',
      extractStatus: 'ready',
      extractError: null,
      text: 'extracted',
      pageCount: null,
      contentHash: HASH,
      mediaType: 'text/markdown',
      sizeBytes: 5,
      needsOriginalUpload: false,
    })
  })

  it('processes strictly one file at a time and reports isBusy', async () => {
    const { extractFile, isBusy } = useKnowledgeExtraction()

    const first = extractFile(textFile('a.txt'))
    const second = extractFile(textFile('b.txt'))

    expect(isBusy.value).toBe(true)

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const worker = FakeWorker.instances[0]!

    await waitForPosts(worker, 1)
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(worker.posted).toHaveLength(1)
    expect(worker.posted[0]?.request.name).toBe('a.txt')

    worker.reply(0, { text: 'first' })

    expect((await first).text).toBe('first')

    await waitForPosts(worker, 2)

    expect(worker.posted[1]?.request.name).toBe('b.txt')
    expect(isBusy.value).toBe(true)

    worker.reply(1, { text: 'second' })

    expect((await second).text).toBe('second')
    expect(isBusy.value).toBe(false)
    expect(FakeWorker.instances).toHaveLength(1)
  })

  it('ignores responses for other request ids', async () => {
    const { extractFile } = useKnowledgeExtraction()
    const extraction = extractFile(textFile('a.txt'))

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const worker = FakeWorker.instances[0]!

    await waitForPosts(worker, 1)
    worker.onmessage?.({ data: { id: 9999, text: 'stale' } })
    worker.reply(0, { text: 'right' })

    expect((await extraction).text).toBe('right')
  })

  it('maps a worker error to a failed result and replaces the worker', async () => {
    const { extractFile } = useKnowledgeExtraction()
    const extraction = extractFile(textFile('a.txt'))

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const worker = FakeWorker.instances[0]!

    await waitForPosts(worker, 1)
    worker.onerror?.()

    const result = await extraction

    expect(result.extractStatus).toBe('failed')
    expect(result.extractError).toBe('worker-error')
    expect(worker.terminate).toHaveBeenCalledTimes(1)

    const next = extractFile(textFile('b.txt'))

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
    await waitForPosts(FakeWorker.instances[1]!, 1)
    FakeWorker.instances[1]!.reply(0)
    await next
  })
})

describe('useKnowledgeExtraction result shaping', () => {
  async function extractWith(
    file: File,
    result: Partial<KnowledgeWorkerResult>,
  ) {
    FakeWorker.instances = []

    const { extractFile, dispose } = useKnowledgeExtraction()
    const extraction = extractFile(file)

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const worker = FakeWorker.instances[0]!

    await waitForPosts(worker, 1)
    worker.reply(0, result)

    const extracted = await extraction

    dispose()

    return extracted
  }

  it('requests original upload for PDFs that were read or are scanned', async () => {
    const pdf = new File(['%PDF'], 'doc.pdf')

    const ready = await extractWith(pdf, {
      extractor: 'client-unpdf',
      pageCount: 3,
    })
    const scanned = await extractWith(pdf, {
      extractor: 'client-unpdf',
      extractStatus: 'no-text',
      text: '',
      pageCount: 3,
    })
    const oldIos = await extractWith(pdf, {
      extractStatus: 'failed',
      extractError: 'ios-update-required',
      text: '',
    })
    const tooLarge = await extractWith(pdf, {
      extractStatus: 'failed',
      extractError: 'too-many-pages',
      text: '',
    })

    expect(ready.needsOriginalUpload).toBe(true)
    expect(ready.mediaType).toBe('application/pdf')
    expect(ready.pageCount).toBe(3)
    expect(scanned.needsOriginalUpload).toBe(true)
    expect(oldIos.needsOriginalUpload).toBe(true)
    expect(tooLarge.needsOriginalUpload).toBe(false)
  })

  it('hashes images without extracting and requests the upload', async () => {
    const result = await extractWith(
      new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }),
      { extractStatus: 'no-text', text: '' },
    )

    expect(result.extractStatus).toBe('no-text')
    expect(result.extractor).toBe('text')
    expect(result.needsOriginalUpload).toBe(true)
    expect(result.mediaType).toBe('image/png')
    expect(result.contentHash).toBe(HASH)
  })

  it('does not request an original upload for text, DOCX and XLSX', async () => {
    const docx = await extractWith(new File(['x'], 'a.docx'), {
      extractor: 'client-mammoth',
      html: '<p>text</p>',
      text: '',
    })
    const xlsx = await extractWith(new File(['x'], 'a.xlsx'), {
      extractor: 'client-xlsx',
    })

    expect(docx.needsOriginalUpload).toBe(false)
    expect(xlsx.needsOriginalUpload).toBe(false)
  })

  it('converts DOCX HTML to Markdown on the main thread', async () => {
    const result = await extractWith(new File(['x'], 'a.docx'), {
      extractor: 'client-mammoth',
      html: '<h1>Plan</h1><p>Ship <strong>it</strong></p>',
      text: '',
    })

    expect(result.extractStatus).toBe('ready')
    expect(result.text).toBe('# Plan\n\nShip **it**')
  })

  it('turns DOCX HTML without text into no-text', async () => {
    const result = await extractWith(new File(['x'], 'a.docx'), {
      extractor: 'client-mammoth',
      html: '<p><img src="" alt=""></p>',
      text: '',
    })

    expect(result.extractStatus).toBe('no-text')
    expect(result.text).toBe('')
  })

  it('fails text over the 2 MB item cap with too-large', async () => {
    const result = await extractWith(new File(['x'], 'a.xlsx'), {
      extractor: 'client-xlsx',
      text: 'a'.repeat(2 * 1024 * 1024 + 1),
    })

    expect(result.extractStatus).toBe('failed')
    expect(result.extractError).toBe('too-large')
    expect(result.text).toBe('')
  })

  it('accepts text exactly at the 2 MB item cap', async () => {
    const result = await extractWith(new File(['x'], 'a.xlsx'), {
      extractor: 'client-xlsx',
      text: 'a'.repeat(2 * 1024 * 1024),
    })

    expect(result.extractStatus).toBe('ready')
  })

  it('rejects files over 30 MB without touching the worker', async () => {
    const { extractFile } = useKnowledgeExtraction()

    const result = await extractFile(
      new File([new ArrayBuffer(30 * 1024 * 1024 + 1)], 'huge.pdf'),
    )

    expect(result.extractStatus).toBe('failed')
    expect(result.extractError).toBe('too-large')
    expect(result.needsOriginalUpload).toBe(false)
    expect(FakeWorker.instances).toHaveLength(0)
  })

  it('prefers the browser MIME type and falls back to the extension', async () => {
    const declared = await extractWith(
      new File(['x'], 'data.csv', { type: 'application/vnd.ms-excel' }),
      {},
    )
    const inferred = await extractWith(new File(['x'], 'main.ts'), {})

    expect(declared.mediaType).toBe('application/vnd.ms-excel')
    expect(inferred.mediaType).toBe('text/plain')
  })
})

describe('useKnowledgeExtraction cancellation', () => {
  it('terminates the worker and rejects on abort, then recreates it', async () => {
    const { extractFile } = useKnowledgeExtraction()
    const controller = new AbortController()
    const extraction = extractFile(textFile('a.txt'), {
      signal: controller.signal,
    })
    const rejection = expect(extraction).rejects.toMatchObject({
      name: 'AbortError',
    })

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    await waitForPosts(FakeWorker.instances[0]!, 1)

    controller.abort()
    await rejection

    expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledTimes(1)

    const next = extractFile(textFile('b.txt'))

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
    await waitForPosts(FakeWorker.instances[1]!, 1)
    FakeWorker.instances[1]!.reply(0)

    expect((await next).extractStatus).toBe('ready')
  })

  it('rejects an already aborted signal without starting a worker', async () => {
    const { extractFile, isBusy } = useKnowledgeExtraction()
    const controller = new AbortController()

    controller.abort()

    await expect(extractFile(textFile('a.txt'), {
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(FakeWorker.instances).toHaveLength(0)
    expect(isBusy.value).toBe(false)
  })

  it('skips queued files that were aborted before their turn', async () => {
    const { extractFile } = useKnowledgeExtraction()
    const controller = new AbortController()
    const first = extractFile(textFile('a.txt'))
    const second = extractFile(textFile('b.txt'), {
      signal: controller.signal,
    })
    const secondRejection = expect(second).rejects.toMatchObject({
      name: 'AbortError',
    })

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const worker = FakeWorker.instances[0]!

    await waitForPosts(worker, 1)
    controller.abort()
    worker.reply(0)
    await first
    await secondRejection

    expect(worker.posted).toHaveLength(1)
  })

  it('resolves failed with timeout after 60 seconds and terminates', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const { extractFile } = useKnowledgeExtraction()
    const extraction = extractFile(textFile('a.txt'))

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    await waitForPosts(FakeWorker.instances[0]!, 1)

    await vi.advanceTimersByTimeAsync(KNOWLEDGE_EXTRACTION_TIMEOUT_MS - 5000)
    expect(FakeWorker.instances[0]?.terminate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(10_000)

    const result = await extraction

    expect(KNOWLEDGE_EXTRACTION_TIMEOUT_MS).toBe(60_000)
    expect(result.extractStatus).toBe('failed')
    expect(result.extractError).toBe('timeout')
    expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledTimes(1)
  })

  it('rejects in-flight work and terminates the worker on dispose', async () => {
    const { extractFile, dispose, isBusy } = useKnowledgeExtraction()
    const extraction = extractFile(textFile('a.txt'))
    const rejection = expect(extraction).rejects.toMatchObject({
      name: 'AbortError',
    })

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    await waitForPosts(FakeWorker.instances[0]!, 1)

    dispose()
    await rejection

    expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalled()
    expect(isBusy.value).toBe(false)
  })

  it('disposes with the owning effect scope', async () => {
    const scope = effectScope()
    const extraction = scope.run(() => useKnowledgeExtraction())!
    const pending = extraction.extractFile(textFile('a.txt'))
    const rejection = expect(pending).rejects.toMatchObject({
      name: 'AbortError',
    })

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))
    await waitForPosts(FakeWorker.instances[0]!, 1)

    scope.stop()
    await rejection

    expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalled()
  })
})

describe('useKnowledgeExtraction idle termination', () => {
  it('terminates the idle worker after 30 seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const { extractFile } = useKnowledgeExtraction()
    const extraction = extractFile(textFile('a.txt'))

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const worker = FakeWorker.instances[0]!

    await waitForPosts(worker, 1)
    worker.reply(0)
    await extraction

    await vi.advanceTimersByTimeAsync(KNOWLEDGE_WORKER_IDLE_MS - 1)
    expect(worker.terminate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(KNOWLEDGE_WORKER_IDLE_MS).toBe(30_000)
    expect(worker.terminate).toHaveBeenCalledTimes(1)

    const next = extractFile(textFile('b.txt'))

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))
    await waitForPosts(FakeWorker.instances[1]!, 1)
    FakeWorker.instances[1]!.reply(0)
    await next
  })

  it('keeps the worker while another extraction restarts the idle clock', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

    const { extractFile } = useKnowledgeExtraction()
    const first = extractFile(textFile('a.txt'))

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const worker = FakeWorker.instances[0]!

    await waitForPosts(worker, 1)
    worker.reply(0)
    await first
    await vi.advanceTimersByTimeAsync(KNOWLEDGE_WORKER_IDLE_MS - 5000)

    const second = extractFile(textFile('b.txt'))

    await waitForPosts(worker, 2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(worker.terminate).not.toHaveBeenCalled()

    worker.reply(1)
    await second
    await vi.advanceTimersByTimeAsync(KNOWLEDGE_WORKER_IDLE_MS)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(FakeWorker.instances).toHaveLength(1)
  })
})

describe('useKnowledgeExtraction main-thread fallback', () => {
  it('extracts directly when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined)

    const { extractFile } = useKnowledgeExtraction()

    const result = await extractFile(textFile('notes.md', '# Fallback'))

    expect(FakeWorker.instances).toHaveLength(0)
    expect(result.extractStatus).toBe('ready')
    expect(result.text).toBe('# Fallback')
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/)
    expect(result.mediaType).toBe('text/markdown')
  })

  it('falls back when constructing the worker throws', async () => {
    vi.stubGlobal('Worker', vi.fn(function BlockedWorker() {
      throw new Error('blocked')
    }))

    const { extractFile } = useKnowledgeExtraction()

    const result = await extractFile(textFile('a.txt', 'plain'))

    expect(result.extractStatus).toBe('ready')
    expect(result.text).toBe('plain')
  })

  it('maps an unsupported extension to a failed result', async () => {
    vi.stubGlobal('Worker', undefined)

    const { extractFile } = useKnowledgeExtraction()

    const result = await extractFile(textFile('archive.zip'))

    expect(result.extractStatus).toBe('failed')
    expect(result.extractError).toBe('unsupported')
  })
})
