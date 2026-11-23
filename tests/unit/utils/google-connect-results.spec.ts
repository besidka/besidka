import { describe, expect, it } from 'vitest'
import { GOOGLE_CONNECT_RESULTS } from '#shared/utils/google-connections'
import {
  GOOGLE_CONNECT_RESULT_MESSAGES,
  getGoogleConnectResultMessage,
} from '../../../app/utils/google-connect-results'

describe('google-connect-results', () => {
  it.each(['besidka', 'byo'] as const)(
    'words every result for the %s client',
    (clientMode) => {
      for (const result of GOOGLE_CONNECT_RESULTS) {
        const message = GOOGLE_CONNECT_RESULT_MESSAGES[clientMode][result]

        expect(message.title, result).not.toBe('')
      }
    },
  )

  it('never points at a card or a page the result is not shown on', () => {
    for (const messages of Object.values(GOOGLE_CONNECT_RESULT_MESSAGES)) {
      for (const message of Object.values(messages)) {
        expect(message.description ?? '').not.toMatch(/this (card|page)/)
      }
    }
  })

  it('separates the Google Drive wording from the own-client wording', () => {
    expect(getGoogleConnectResultMessage('besidka', 'connected').title)
      .toBe('Google Drive connected')
    expect(getGoogleConnectResultMessage('byo', 'connected').title)
      .toBe('Google connected with your client')
  })
})
