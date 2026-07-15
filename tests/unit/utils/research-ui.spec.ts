import { describe, expect, it } from 'vitest'
import type { UIMessage } from 'ai'
import {
  formatResearchElapsed,
  formatResearchLinkLabel,
  hasResearchMetaPart,
  parseResearchStepText,
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

  describe('parseResearchStepText', () => {
    it('splits a leading double-asterisk title from its description', () => {
      const result = parseResearchStepText(
        '**Assessing kettle features and compatibility** I need to'
        + ' determine...',
      )

      expect(result).toEqual({
        title: 'Assessing kettle features and compatibility',
        description: 'I need to determine...',
      })
    })

    it('splits a leading single-asterisk title from its description', () => {
      expect(parseResearchStepText('*Quick note* checking the spec.'))
        .toEqual({
          title: 'Quick note',
          description: 'checking the spec.',
        })
    })

    it('splits a leading double-underscore title from its description', () => {
      expect(parseResearchStepText('__Bold title__ body text here.'))
        .toEqual({
          title: 'Bold title',
          description: 'body text here.',
        })
    })

    it('splits a leading single-underscore title from its description', () => {
      expect(parseResearchStepText('_Emphasis_ remainder.')).toEqual({
        title: 'Emphasis',
        description: 'remainder.',
      })
    })

    it('falls back to the first sentence as the title when there is no leading emphasis', () => {
      const result = parseResearchStepText(
        'I need to determine the best options. Then I will compare them.',
      )

      expect(result).toEqual({
        title: 'I need to determine the best options.',
        description: 'Then I will compare them.',
      })
    })

    it('is not expandable when the text has no sentence terminator', () => {
      expect(parseResearchStepText('best espresso machines 2026')).toEqual({
        title: 'best espresso machines 2026',
        description: '',
      })
    })

    it('does not split on a decimal inside a sentence', () => {
      const result = parseResearchStepText(
        'The kettle holds 1.7 liters and boils in 3 minutes.'
        + ' It is efficient.',
      )

      expect(result).toEqual({
        title: 'The kettle holds 1.7 liters and boils in 3 minutes.',
        description: 'It is efficient.',
      })
    })

    it('does not split on a decimal at the start of a sentence', () => {
      expect(parseResearchStepText('Version 2.0 shipped. Users upgraded.'))
        .toEqual({
          title: 'Version 2.0 shipped.',
          description: 'Users upgraded.',
        })
    })

    it('does not split a URL on its path dots', () => {
      const url = 'https://example.com/path/to/page'

      expect(parseResearchStepText(url)).toEqual({
        title: url,
        description: '',
      })
    })

    it('strips a stray interior emphasis marker from the title', () => {
      const result = parseResearchStepText(
        '**Assessing *kettle* features** details.',
      )

      expect(result).toEqual({
        title: 'Assessing kettle features',
        description: 'details.',
      })
    })

    it('returns empty title and description for whitespace-only text', () => {
      expect(parseResearchStepText('   ')).toEqual({
        title: '',
        description: '',
      })
    })

    it('returns an empty description for a title-only entry', () => {
      expect(parseResearchStepText('**All done**')).toEqual({
        title: 'All done',
        description: '',
      })
    })

    it('preserves paragraph breaks in the description', () => {
      const result = parseResearchStepText(
        '**Plan** First para.\n\nSecond para.',
      )

      expect(result).toEqual({
        title: 'Plan',
        description: 'First para.\n\nSecond para.',
      })
    })

    it('trims extra whitespace between the title marker and the body', () => {
      expect(parseResearchStepText('**Title**    body.')).toEqual({
        title: 'Title',
        description: 'body.',
      })
    })

    it('splits on a multilingual sentence boundary without a trailing space', () => {
      const result = parseResearchStepText('分析请求。给出答案。')

      expect(result).toEqual({
        title: '分析请求。',
        description: '给出答案。',
      })
    })
  })

  describe('formatResearchLinkLabel', () => {
    it('returns the hostname without a www prefix', () => {
      expect(formatResearchLinkLabel('https://www.example.com/path'))
        .toBe('example.com')
    })

    it('returns the hostname as-is when there is no www prefix', () => {
      expect(formatResearchLinkLabel('https://example.com/research/crdt'))
        .toBe('example.com')
    })

    it('returns the raw input when it is not a valid URL', () => {
      expect(formatResearchLinkLabel('not a url')).toBe('not a url')
    })
  })
})
