import type {
  SkillImportWorkerRequest,
  SkillImportWorkerResponse,
  SkillImportWorkerResult,
} from '~/types/skill-import.d'

export const SKILL_ARCHIVE_INSPECT_TIMEOUT_MS = 30_000

/**
 * Checks a skill archive in a worker before it is uploaded, with the same
 * rules the server applies, so a bad archive is refused instantly and
 * without a round trip. It returns `null` when no worker can run (an old
 * browser, a test), and the upload then goes straight to the server, which
 * never trusts this result anyway.
 */
export function useSkillArchiveInspector() {
  let requestId = 0

  async function inspect(file: File): Promise<SkillImportWorkerResult | null> {
    if (!import.meta.client || typeof Worker === 'undefined') {
      return null
    }

    let worker: Worker

    try {
      worker = new Worker(
        new URL('../workers/skill-import.ts', import.meta.url),
        { type: 'module' },
      )
    } catch {
      return null
    }

    const id = ++requestId
    const bytes = await file.arrayBuffer()

    return await new Promise<SkillImportWorkerResult | null>((resolve) => {
      const timeout = setTimeout(
        () => finish(null),
        SKILL_ARCHIVE_INSPECT_TIMEOUT_MS,
      )

      function finish(result: SkillImportWorkerResult | null) {
        clearTimeout(timeout)
        worker.terminate()
        resolve(result)
      }

      worker.onmessage = (event: MessageEvent<SkillImportWorkerResponse>) => {
        if (event.data?.id !== id) {
          return
        }

        const { id: _id, ...result } = event.data

        finish(result)
      }
      worker.onerror = () => finish(null)
      worker.onmessageerror = () => finish(null)

      const request: SkillImportWorkerRequest = {
        id,
        name: file.name,
        bytes,
      }

      worker.postMessage(request, [bytes])
    })
  }

  return { inspect }
}
