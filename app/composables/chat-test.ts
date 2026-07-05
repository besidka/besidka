import type { Chat } from '#shared/types/chats.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import { isChatTestErrorId } from '#shared/utils/chat-test-errors'
import type { Ref } from 'vue'

export function useChatTest(
  chat: Chat,
  reasoning: Ref<ReasoningLevel>,
) {
  const route = useRoute()
  const router = useRouter()

  const isTestChat = computed<boolean>(() => {
    return import.meta.dev && route.path === '/chats/test'
  })

  const query = computed(() => {
    if (!isTestChat.value) {
      return {
        scenario: undefined,
        messages: undefined,
        effort: undefined,
        depth: undefined,
        error: undefined,
      }
    }

    let scenario = route.query.scenario as string
    let effort = route.query.effort as string
    let depth = route.query.depth as string
    const error = (
      typeof route.query.error === 'string'
      && isChatTestErrorId(route.query.error)
    )
      ? route.query.error
      : undefined

    if (!['short', 'long', 'reasoning', 'deep-research'].includes(scenario)) {
      scenario = 'short'
    }

    if (!['off', 'low', 'medium', 'high'].includes(effort)) {
      effort = 'medium'
    }

    if (!['quick', 'standard', 'thorough'].includes(depth)) {
      depth = 'standard'
    }

    return {
      scenario,
      messages: route.query.messages as string || '1',
      effort,
      depth,
      error,
    }
  })

  const api = computed<string>(() => {
    if (!isTestChat.value) {
      return `/api/v1/chats/${chat.slug}`
    }

    const searchParams = new URLSearchParams()

    searchParams.set('scenario', query.value.scenario ?? 'short')
    searchParams.set('messages', query.value.messages ?? '1')

    if (query.value.scenario === 'reasoning') {
      searchParams.set('effort', query.value.effort ?? 'medium')
    }

    if (query.value.scenario === 'deep-research') {
      searchParams.set('depth', query.value.depth ?? 'standard')
    }

    if (query.value.error) {
      searchParams.set('error', query.value.error)
    }

    const paramsString = searchParams.toString()

    return `/api/v1/chats/test${paramsString ? `?${paramsString}` : ''}`
  })

  const shouldAutoRegenerate = computed<boolean>(() => {
    if (!isTestChat.value) {
      return true
    }

    return 'regenerate' in route.query
  })

  watch(() => {
    if (!isTestChat.value || typeof route.query.effort !== 'string') {
      return undefined
    }

    return route.query.effort
  }, (effort) => {
    if (!effort) {
      return
    }

    const normalizedReasoningLevel = normalizeReasoningLevel(effort)

    if (reasoning.value === normalizedReasoningLevel) {
      return
    }

    reasoning.value = normalizedReasoningLevel
  }, {
    immediate: true,
    flush: 'post',
  })

  watch(reasoning, async (level) => {
    if (!isTestChat.value) {
      return
    }

    const currentEffort = typeof route.query.effort === 'string'
      ? route.query.effort
      : ''

    if (currentEffort === level) {
      return
    }

    await router.replace({
      query: {
        ...route.query,
        effort: level,
      },
    })
  }, {
    flush: 'post',
  })

  return {
    api,
    isTestChat,
    shouldAutoRegenerate,
  }
}
