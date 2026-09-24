import { describe, expect, it } from 'vitest'
import {
  getPersistedEmptyAnswerFailureText,
  isPersistedEmptyAnswerFailureText,
} from '../../../shared/utils/chat-failure-text'

describe('empty-answer failure text', () => {
  it('recognizes the exact persisted text', () => {
    const text = getPersistedEmptyAnswerFailureText()

    expect(isPersistedEmptyAnswerFailureText(text)).toBe(true)
  })

  it('does not match unrelated assistant text', () => {
    expect(isPersistedEmptyAnswerFailureText('Here is the answer.'))
      .toBe(false)
  })

  it('does not match a real answer that merely mentions searching', () => {
    expect(isPersistedEmptyAnswerFailureText(
      'I searched the web and found the answer.',
    )).toBe(false)
  })
})
