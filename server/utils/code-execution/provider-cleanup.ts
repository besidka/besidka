import type { CodeExecutionProvider } from '#shared/utils/code-execution'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { buildAuthHeaders } from '~~/server/utils/code-execution/container-files'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export const PROVIDER_CLEANUP_TIMEOUT_MS = 15_000

const PROVIDER_FILES_URLS: Record<CodeExecutionProvider, string | null> = {
  anthropic: 'https://api.anthropic.com/v1/files',
  openai: 'https://api.openai.com/v1/files',
  google: null,
}
const OPENAI_CONTAINERS_URL = 'https://api.openai.com/v1/containers'
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,200}$/
const NOT_FOUND_STATUS = 404

export interface ProviderCleanupSummary {
  deleted: number
  alreadyGone: number
  failed: number
}

export interface ProviderResourceTracker {
  trackFile: (fileId: string) => void
  trackContainer: (containerId: string) => void
  hasPending: () => boolean
  cleanup: () => Promise<ProviderCleanupSummary>
}

export interface CreateProviderResourceTrackerInput {
  provider: CodeExecutionProvider
  apiKey: string
  logger: LoggerLike
  fetcher?: typeof fetch
}

/**
 * Remembers every object Besidka created at the provider for one send (input
 * files it uploaded, output files it downloaded, the OpenAI container) and
 * deletes them with the user's own key. `cleanup()` is safe to call from both
 * the end of the stream and a `finally`: it drains the list, never throws,
 * and logs counts only, never ids or file contents.
 */
export function createProviderResourceTracker(
  input: CreateProviderResourceTrackerInput,
): ProviderResourceTracker {
  const fetcher = input.fetcher ?? fetch
  const fileIds = new Set<string>()
  const containerIds = new Set<string>()

  async function deleteResource(url: string): Promise<
    'deleted' | 'already-gone' | 'failed'
  > {
    try {
      const response = await fetcher(url, {
        method: 'DELETE',
        headers: buildAuthHeaders(input.provider, input.apiKey),
        redirect: 'manual',
        signal: AbortSignal.timeout(PROVIDER_CLEANUP_TIMEOUT_MS),
      })

      await response.body?.cancel()

      if (response.status === NOT_FOUND_STATUS) {
        return 'already-gone'
      }

      return response.ok ? 'deleted' : 'failed'
    } catch (exception) {
      input.logger.set({
        attributes: {
          codeExecutionCleanup: {
            provider: input.provider,
            error: exceptionMessage(exception),
          },
        },
      })

      return 'failed'
    }
  }

  return {
    trackFile(fileId) {
      if (SAFE_ID_PATTERN.test(fileId)) {
        fileIds.add(fileId)
      }
    },
    trackContainer(containerId) {
      if (input.provider === 'openai' && SAFE_ID_PATTERN.test(containerId)) {
        containerIds.add(containerId)
      }
    },
    hasPending() {
      return fileIds.size > 0 || containerIds.size > 0
    },
    async cleanup() {
      const summary: ProviderCleanupSummary = {
        deleted: 0,
        alreadyGone: 0,
        failed: 0,
      }
      const filesUrl = PROVIDER_FILES_URLS[input.provider]
      const targets = [
        ...(filesUrl
          ? [...fileIds].map(fileId => `${filesUrl}/${fileId}`)
          : []),
        ...[...containerIds].map((containerId) => {
          return `${OPENAI_CONTAINERS_URL}/${containerId}`
        }),
      ]

      fileIds.clear()
      containerIds.clear()

      for (const target of targets) {
        const outcome = await deleteResource(target)

        if (outcome === 'deleted') {
          summary.deleted += 1
        } else if (outcome === 'already-gone') {
          summary.alreadyGone += 1
        } else {
          summary.failed += 1
        }
      }

      if (targets.length > 0) {
        input.logger.set({
          attributes: {
            codeExecutionCleanup: {
              provider: input.provider,
              ...summary,
            },
          },
        })
      }

      return summary
    },
  }
}
