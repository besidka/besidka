import { describe, expect, it } from 'vitest'
import {
  GOOGLE_ENTRY_IDS,
  buildGoogleEntryPath,
  findGoogleEntriesForSearch,
  isGoogleEntryId,
} from '#shared/utils/google-connectors'

describe('google-connectors', () => {
  describe('isGoogleEntryId', () => {
    it.each(GOOGLE_ENTRY_IDS)('accepts %s', (entryId) => {
      expect(isGoogleEntryId(entryId)).toBe(true)
    })

    it.each([
      ['google'],
      ['google-docs'],
      ['GOOGLE-DRIVE'],
      [''],
      [undefined],
      [null],
      [['google-drive']],
    ])('rejects %j', (value) => {
      expect(isGoogleEntryId(value)).toBe(false)
    })
  })

  describe('buildGoogleEntryPath', () => {
    it('opens the entry panel on the Connectors page', () => {
      expect(buildGoogleEntryPath('google-gmail'))
        .toBe('/chats/connectors?panel=google-gmail')
    })
  })

  describe('findGoogleEntriesForSearch', () => {
    it.each([
      ['google', ['google-drive', 'google-gmail', 'google-calendar']],
      ['Google Drive', ['google-drive', 'google-gmail', 'google-calendar']],
      ['gmail', ['google-gmail']],
      ['gma', ['google-gmail']],
      ['calendar', ['google-calendar']],
      ['drive', ['google-drive']],
      ['docs', ['google-drive']],
      ['sheets', ['google-drive']],
      ['slides', ['google-drive']],
      ['  SLIDES  ', ['google-drive']],
    ])('finds %j', (query, expected) => {
      expect(findGoogleEntriesForSearch(query)).toEqual(expected)
    })

    it.each([
      [''],
      ['   '],
      ['g'],
      ['github'],
      ['notion linear'],
      ['mail'],
    ])('finds nothing for %j', (query) => {
      expect(findGoogleEntriesForSearch(query)).toEqual([])
    })
  })
})
