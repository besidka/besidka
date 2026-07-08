import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import type { ProviderResearchCapability } from '#shared/types/research.d'
import {
  formatResearchElapsed,
  getResearchLevelEntries,
  getResearchProviderConfig,
  hasResearchMetaPart,
} from '../../../app/utils/research'

const capability: ProviderResearchCapability = {
  assistModel: 'gpt-5.4-nano',
  levels: {
    quick: {
      modelId: 'o4-mini-deep-research',
      label: 'Quick',
      costEstimate: '~$1',
      timeEstimate: '5-15 min',
    },
    thorough: {
      modelId: 'o3-deep-research',
      label: 'Thorough',
      costEstimate: '~$10',
      timeEstimate: '10-30 min',
    },
  },
}

describe('app/utils/research', () => {
  describe('getResearchLevelEntries', () => {
    it('returns an empty array for a null capability', () => {
      expect(getResearchLevelEntries(null)).toEqual([])
    })

    it('returns entries ordered quick then thorough', () => {
      const entries = getResearchLevelEntries(capability)

      expect(entries.map(entry => entry.level)).toEqual([
        'quick',
        'thorough',
      ])
      expect(entries[0]?.config.modelId).toBe('o4-mini-deep-research')
      expect(entries[1]?.config.modelId).toBe('o3-deep-research')
    })
  })

  describe('getResearchProviderConfig', () => {
    it('resolves the level config for a real provider', () => {
      const config = getResearchProviderConfig('openai', 'quick')

      expect(config?.label).toBe('Quick')
      expect(config?.modelId).toBeTruthy()
    })

    it('resolves the level config for google too', () => {
      const config = getResearchProviderConfig('google', 'thorough')

      expect(config?.label).toBe('Thorough')
    })
  })

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
