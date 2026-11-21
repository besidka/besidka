import { parseError } from 'evlog'

const COPIED_RESET_MS = 2000
const LOAD_FAILED_TITLE = 'Could not copy debug info'

function describeLoadFailure(exception: unknown): string | undefined {
  const parsedException = parseError(exception)

  if (parsedException.why) {
    return parsedException.why
  }

  const isFetchSummary = parsedException.message.startsWith('[')

  if (parsedException.message && !isFetchSummary) {
    return parsedException.message
  }

  const status = parsedException.status

  return status
    ? `The request was refused with status ${status}. Try again later.`
    : undefined
}

async function writeToClipboard(reportPromise: Promise<string>) {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    const blobPromise = reportPromise.then((report) => {
      return new Blob([report], { type: 'text/plain' })
    })

    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': blobPromise }),
      ])

      return
    } catch {
      await navigator.clipboard.writeText(await reportPromise)

      return
    }
  }

  await navigator.clipboard.writeText(await reportPromise)
}

export function useChatDebugInfo() {
  const isCopying = shallowRef<boolean>(false)
  const copied = refAutoReset<boolean>(false, COPIED_RESET_MS)
  const fallbackReport = shallowRef<string>('')

  function clearFallbackReport() {
    fallbackReport.value = ''
  }

  async function copyDebugInfo(slug: string): Promise<boolean> {
    if (isCopying.value) {
      return false
    }

    isCopying.value = true
    fallbackReport.value = ''

    const reportPromise = $fetch(`/api/v1/chats/${slug}/support-info`)
      .then((response) => {
        return response.report
      })

    try {
      await writeToClipboard(reportPromise)
      copied.value = true

      return true
    } catch {
      try {
        fallbackReport.value = await reportPromise
      } catch (exception) {
        useErrorMessage(LOAD_FAILED_TITLE, describeLoadFailure(exception))

        return false
      }

      useErrorMessage(
        'Could not copy automatically',
        'Select the text below and copy it.',
      )

      return false
    } finally {
      isCopying.value = false
    }
  }

  return {
    isCopying,
    copied,
    fallbackReport,
    copyDebugInfo,
    clearFallbackReport,
  }
}
