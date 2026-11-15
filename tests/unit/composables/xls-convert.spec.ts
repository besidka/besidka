import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { useXlsConversion } from '~/composables/xls-convert'
import type {
  XlsWorkerRequest,
  XlsWorkerResponse,
} from '~/types/xls-convert.d'
import {
  CFB_SIGNATURE,
  XLSX_MEDIA_TYPE,
  XLS_CONVERT_MAX_INPUT_BYTES,
  XLS_CONVERT_TIMEOUT_MS,
} from '~/utils/xls-convert'

class FakeWorker {
  static instances: FakeWorker[] = []

  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  posted: Array<{ request: XlsWorkerRequest, transfer: unknown[] }> = []
  terminate = vi.fn()

  constructor(
    public url: URL,
    public options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this)
  }

  postMessage(request: XlsWorkerRequest, transfer: unknown[]): void {
    this.posted.push({ request, transfer })
  }

  reply(response: Partial<XlsWorkerResponse> = {}): void {
    this.onmessage?.({
      data: {
        id: this.posted[0]?.request.id,
        ok: true,
        bytes: new Uint8Array([0x50, 0x4B]).buffer,
        ...response,
      },
    })
  }
}

function cfbFile(name: string, extraBytes: number = 16): File {
  const bytes = new Uint8Array(CFB_SIGNATURE.length + extraBytes)

  bytes.set(CFB_SIGNATURE)

  return new File([bytes], name, { type: 'application/vnd.ms-excel' })
}

function withSize(file: File, size: number): File {
  Object.defineProperty(file, 'size', { value: size })

  return file
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

async function waitForWorker(index: number = 0): Promise<FakeWorker> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (FakeWorker.instances[index]?.posted.length === 1) {
      return FakeWorker.instances[index]!
    }

    await nextMacrotask()
  }

  throw new Error('The worker never received the request')
}

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useXlsConversion', () => {
  describe('before parsing', () => {
    it('refuses a file without the compound file signature', async () => {
      const { convertXlsFile } = useXlsConversion()
      const html = new File(['<html><table></table></html>'], 'jira.xls')

      expect(await convertXlsFile(html)).toEqual({
        status: 'failed',
        reason: 'not-cfb',
      })
      expect(FakeWorker.instances).toHaveLength(0)
    })

    it('refuses a file shorter than the signature', async () => {
      const { convertXlsFile } = useXlsConversion()
      const short = new File([new Uint8Array([0xD0, 0xCF, 0x11])], 'a.xls')

      expect(await convertXlsFile(short)).toEqual({
        status: 'failed',
        reason: 'not-cfb',
      })
      expect(FakeWorker.instances).toHaveLength(0)
    })

    it('refuses a file that only starts like the signature', async () => {
      const { convertXlsFile } = useXlsConversion()
      const almost = new Uint8Array(CFB_SIGNATURE.length + 8)

      almost.set(CFB_SIGNATURE)
      almost[7] = 0x00

      expect(
        await convertXlsFile(new File([almost], 'almost.xls')),
      ).toEqual({ status: 'failed', reason: 'not-cfb' })
    })

    it('refuses a file over the input cap without reading it', async () => {
      const { convertXlsFile } = useXlsConversion()
      const oversized = withSize(
        cfbFile('big.xls'),
        XLS_CONVERT_MAX_INPUT_BYTES + 1,
      )
      const readBytes = vi.spyOn(oversized, 'arrayBuffer')

      expect(await convertXlsFile(oversized)).toEqual({
        status: 'failed',
        reason: 'too-large',
      })
      expect(readBytes).not.toHaveBeenCalled()
      expect(FakeWorker.instances).toHaveLength(0)
    })

    it('accepts a file exactly at the input cap', async () => {
      const { convertXlsFile } = useXlsConversion()
      const atCap = withSize(cfbFile('edge.xls'), XLS_CONVERT_MAX_INPUT_BYTES)
      const conversion = convertXlsFile(atCap)

      const worker = await waitForWorker()

      worker.reply()

      expect(await conversion).toMatchObject({ status: 'converted' })
    })

    it('fails with worker-unavailable when there is no Worker', async () => {
      vi.stubGlobal('Worker', undefined)

      const { convertXlsFile } = useXlsConversion()

      expect(await convertXlsFile(cfbFile('a.xls'))).toEqual({
        status: 'failed',
        reason: 'worker-unavailable',
      })
    })
  })

  describe('conversion', () => {
    it('creates a module worker lazily and transfers the buffer', async () => {
      const { convertXlsFile } = useXlsConversion()

      expect(FakeWorker.instances).toHaveLength(0)

      const conversion = convertXlsFile(cfbFile('report.xls'))
      const worker = await waitForWorker()

      expect(worker.options).toEqual({ type: 'module' })
      expect(String(worker.url)).toContain('xls-convert')
      expect(worker.posted[0]!.transfer).toEqual([
        worker.posted[0]!.request.bytes,
      ])

      worker.reply()
      await conversion
    })

    it('names the result after the original and sets the XLSX type',
      async () => {
        const { convertXlsFile } = useXlsConversion()
        const conversion = convertXlsFile(cfbFile('Jira Export.XLS'))
        const worker = await waitForWorker()

        worker.reply()

        const result = await conversion

        expect(result.status).toBe('converted')

        if (result.status !== 'converted') {
          return
        }

        expect(result.file.name).toBe('Jira Export.xlsx')
        expect(result.file.type).toBe(XLSX_MEDIA_TYPE)
        expect(new Uint8Array(await result.file.arrayBuffer()))
          .toEqual(new Uint8Array([0x50, 0x4B]))
      })

    it('keeps dots inside the base name', async () => {
      const { convertXlsFile } = useXlsConversion()
      const conversion = convertXlsFile(cfbFile('q3.final.report.xls'))
      const worker = await waitForWorker()

      worker.reply()

      const result = await conversion

      expect(result.status === 'converted' && result.file.name)
        .toBe('q3.final.report.xlsx')
    })

    it('terminates the worker after each file and uses a new one for the next',
      async () => {
        const { convertXlsFile } = useXlsConversion()
        const first = convertXlsFile(cfbFile('one.xls'))
        const firstWorker = await waitForWorker(0)

        firstWorker.reply()
        await first

        expect(firstWorker.terminate).toHaveBeenCalledTimes(1)

        const second = convertXlsFile(cfbFile('two.xls'))
        const secondWorker = await waitForWorker(1)

        secondWorker.reply()
        await second

        expect(FakeWorker.instances).toHaveLength(2)
        expect(secondWorker.terminate).toHaveBeenCalledTimes(1)
      })

    it('ignores a reply for another request', async () => {
      const { convertXlsFile } = useXlsConversion()
      const conversion = convertXlsFile(cfbFile('a.xls'))
      const worker = await waitForWorker()

      worker.reply({ id: 999, ok: false, reason: 'convert-failed' })
      worker.reply()

      expect(await conversion).toMatchObject({ status: 'converted' })
    })
  })

  describe('failures fall back to the hint', () => {
    it('passes a worker failure reason through and terminates the worker',
      async () => {
        const { convertXlsFile } = useXlsConversion()
        const conversion = convertXlsFile(cfbFile('locked.xls'))
        const worker = await waitForWorker()

        worker.reply({ ok: false, reason: 'convert-failed' } as never)

        expect(await conversion).toEqual({
          status: 'failed',
          reason: 'convert-failed',
        })
        expect(worker.terminate).toHaveBeenCalledTimes(1)
      })

    it('fails on a worker error event', async () => {
      const { convertXlsFile } = useXlsConversion()
      const conversion = convertXlsFile(cfbFile('a.xls'))
      const worker = await waitForWorker()

      worker.onerror?.()

      expect(await conversion).toEqual({
        status: 'failed',
        reason: 'worker-error',
      })
      expect(worker.terminate).toHaveBeenCalledTimes(1)
    })

    it('fails on a message error event', async () => {
      const { convertXlsFile } = useXlsConversion()
      const conversion = convertXlsFile(cfbFile('a.xls'))
      const worker = await waitForWorker()

      worker.onmessageerror?.()

      expect(await conversion).toEqual({
        status: 'failed',
        reason: 'worker-error',
      })
    })

    it('never rejects when the worker cannot be built', async () => {
      vi.stubGlobal('Worker', vi.fn(function ThrowingWorker() {
        throw new Error('blocked by CSP')
      }))

      const { convertXlsFile } = useXlsConversion()

      expect(await convertXlsFile(cfbFile('a.xls'))).toEqual({
        status: 'failed',
        reason: 'worker-unavailable',
      })
    })

    it('times out after 30 seconds and terminates the worker', async () => {
      expect(XLS_CONVERT_TIMEOUT_MS).toBe(30_000)

      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const { convertXlsFile } = useXlsConversion()
      const conversion = convertXlsFile(cfbFile('slow.xls'))
      const worker = await waitForWorker()

      await vi.advanceTimersByTimeAsync(XLS_CONVERT_TIMEOUT_MS - 1)

      expect(worker.terminate).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)

      expect(await conversion).toEqual({
        status: 'failed',
        reason: 'timeout',
      })
      expect(worker.terminate).toHaveBeenCalledTimes(1)
    })

    it('does not time out after a reply', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const { convertXlsFile } = useXlsConversion()
      const conversion = convertXlsFile(cfbFile('fast.xls'))
      const worker = await waitForWorker()

      worker.reply()

      expect(await conversion).toMatchObject({ status: 'converted' })
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  describe('scope disposal', () => {
    it('terminates a running worker and settles the file as failed',
      async () => {
        const scope = effectScope()
        const { convertXlsFile } = scope.run(() => useXlsConversion())!
        const conversion = convertXlsFile(cfbFile('a.xls'))
        const worker = await waitForWorker()

        scope.stop()

        expect(await conversion).toEqual({
          status: 'failed',
          reason: 'worker-error',
        })
        expect(worker.terminate).toHaveBeenCalled()
      })
  })
})
