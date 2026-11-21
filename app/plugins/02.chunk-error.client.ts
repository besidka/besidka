export default defineNuxtPlugin({
  name: 'chunk-error-recovery',
  setup(nuxtApp) {
    const isReplyInProgress = useState<boolean>(
      REPLY_IN_PROGRESS_STATE_KEY,
      () => false,
    )
    const prefStorage = usePreferenceStorage()
    let isWaitingForReply = false
    let isReloading = false
    let hasNotified = false

    function readSessionStorage(): Storage | undefined {
      try {
        return window.sessionStorage
      } catch {
        return undefined
      }
    }

    function notifyOnce(title: string): void {
      if (hasNotified) {
        return
      }

      hasNotified = true
      useInfoMessage(title)
    }

    function recover(): void {
      if (isReloading) {
        return
      }

      const path = window.location.pathname + window.location.search
      const outcome = recoverFromChunkLoadError({
        isReplyInProgress: isReplyInProgress.value,
        hasUnsentDraft: !!prefStorage.getItem('chat_input')?.trim(),
        storage: readSessionStorage(),
        path,
        reload: () => {
          isReloading = true
          reloadNuxtApp({ path, ttl: CHUNK_RELOAD_GUARD_MS })
        },
      })

      if (outcome === 'blocked') {
        notifyOnce('Besidka was updated. Reload the page to continue.')

        return
      }

      if (outcome !== 'deferred' || isWaitingForReply) {
        return
      }

      isWaitingForReply = true
      notifyOnce(
        'Besidka was updated. The page reloads when this reply finishes.',
      )

      const stopWatching = watch(isReplyInProgress, (inProgress) => {
        if (inProgress) {
          return
        }

        stopWatching()
        isWaitingForReply = false
        hasNotified = false
        recover()
      })
    }

    nuxtApp.hook('app:chunkError', ({ error }) => {
      if (!isChunkLoadError(error)) {
        return
      }

      recover()
    })

    return {
      provide: { recoverFromChunkError: recover },
    }
  },
})
