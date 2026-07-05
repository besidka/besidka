import { describe, expect, it } from 'vitest'
import { shallowRef } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useChatInput } from '../../../app/composables/chat-input'

const userModelMock = shallowRef<string>('')

mockNuxtImport('useUserModel', () => {
  return () => ({
    userModel: userModelMock,
  })
})

describe('useChatInput', () => {
  describe('isDeepResearchSupported', () => {
    it('is false when no model is selected', () => {
      userModelMock.value = ''

      const { isDeepResearchSupported } = useChatInput()

      expect(isDeepResearchSupported.value).toBe(false)
    })

    it('is false for a model without the deep_research tool', () => {
      userModelMock.value = 'gpt-5-nano'

      const { isDeepResearchSupported } = useChatInput()

      expect(isDeepResearchSupported.value).toBe(false)
    })

    it('is true for a model with the deep_research tool', () => {
      userModelMock.value = 'gpt-5'

      const { isDeepResearchSupported } = useChatInput()

      expect(isDeepResearchSupported.value).toBe(true)
    })
  })
})
