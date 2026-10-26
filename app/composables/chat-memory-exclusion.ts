import { parseError } from 'evlog'

export function useChatMemoryExclusion() {
  const excludedBySlug = useState<Record<string, boolean>>(
    'chat-memory-exclusion:excluded-by-slug',
    () => ({}),
  )
  const savingSlug = useState<string | null>(
    'chat-memory-exclusion:saving-slug',
    () => null,
  )

  function isChatMemoryExcluded(
    slug: string,
    loadedValue?: boolean | null,
  ): boolean {
    return excludedBySlug.value[slug] ?? !!loadedValue
  }

  function rememberChatMemoryExcluded(
    slug: string,
    loadedValue: boolean | null | undefined,
  ) {
    if (slug in excludedBySlug.value) {
      return
    }

    excludedBySlug.value = { ...excludedBySlug.value, [slug]: !!loadedValue }
  }

  async function confirmExclusion(): Promise<boolean> {
    const result = await useConfirm({
      text: `${CHAT_MEMORY_EXCLUSION_LABEL}?`,
      subtitle: CHAT_MEMORY_EXCLUSION_CONFIRM_SUBTITLE,
      actions: ['Don\'t use for memory'],
    })

    return !!result
  }

  async function setChatMemoryExcluded(
    slug: string,
    excluded: boolean,
  ): Promise<boolean> {
    if (savingSlug.value === slug) {
      return false
    }

    if (excluded && !await confirmExclusion()) {
      return false
    }

    savingSlug.value = slug

    try {
      const response = await $fetch(`/api/v1/chats/${slug}/memory`, {
        method: 'PATCH',
        body: { excluded },
      })

      excludedBySlug.value = {
        ...excludedBySlug.value,
        [slug]: response.memoryExcluded,
      }
      setHistoryChatMemoryExcludedBySlug(slug, response.memoryExcluded)

      return true
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Something went wrong',
        parsedException.why,
      )

      return false
    } finally {
      savingSlug.value = null
    }
  }

  return {
    savingSlug,
    isChatMemoryExcluded,
    rememberChatMemoryExcluded,
    setChatMemoryExcluded,
  }
}
