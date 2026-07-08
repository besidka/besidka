import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  formatResearchElapsed,
  hasResearchMetaPart,
} from '../../../app/utils/research'

describe('app/utils/research', () => {
  describe('formatResearchElapsed', () => {
    it('formats zero as 0:00', () => {
      expect(formatResearchElapsed(0)).toBe('0:00')
    })

    it('formats sub-minute durations', () => {
      expect(formatResearchElapsed(45_000)).toBe('0:45')
    })

    it('formats minutes with zero-padded seconds', () => {
      expect(formatResearchElapsed(65_000)).toBe('1:05')
    })

    it('formats durations over an hour in minutes', () => {
      expect(formatResearchElapsed(90 * 60_000)).toBe('90:00')
    })

    it('clamps negative durations to 0:00', () => {
      expect(formatResearchElapsed(-1000)).toBe('0:00')
    })
  })

  describe('hasResearchMetaPart', () => {
    function createMessage(parts: UIMessage['parts']): UIMessage {
      return {
        id: 'msg-1',
        role: 'assistant',
        parts,
      } as UIMessage
    }

    it('is false when there is no data-research part', () => {
      expect(hasResearchMetaPart(createMessage([
        { type: 'text', text: 'hello' },
      ]))).toBe(false)
    })

    it('is true when a data-research part is present', () => {
      expect(hasResearchMetaPart(createMessage([
        {
          type: 'data-research',
          data: {
            provider: 'openai',
            level: 'quick',
            modelId: 'o4-mini-deep-research',
          },
        } as unknown as UIMessage['parts'][number],
      ]))).toBe(true)
    })
  })
})
