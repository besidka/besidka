import { describe, expect, it } from 'vitest'
import { useChatFormat } from '../../../app/composables/chat-format'
import A from '../../../app/components/prose/A.vue'
import Img from '../../../app/components/prose/Img.vue'

describe('useChatFormat', () => {
  it('overrides img with the external-image-blocking component', () => {
    const { messageComponents, components, imageComponents } = useChatFormat()

    expect(messageComponents.img).toBe(Img)
    expect(components.img).toBe(Img)
    expect(imageComponents.img).toBe(Img)
  })

  it('keeps the anchor override on message components only', () => {
    const { messageComponents, components } = useChatFormat()

    expect(messageComponents.a).toBe(A)
    expect('a' in components).toBe(false)
  })

  it('unwraps tables for assistant messages and pre for user messages',
    () => {
      const { getUnwrap } = useChatFormat()

      expect(getUnwrap('assistant')).toBe('strong,details,table')
      expect(getUnwrap('user')).toBe('strong,details,pre')
    })
})
