import { describe, expect, it } from 'vitest'
import {
  SHARE_PII_GENERIC_REMINDER,
  describeSharePiiKinds,
} from '#shared/utils/share-pii'

describe('describeSharePiiKinds', () => {
  it('lists each label once in the order found', () => {
    expect(describeSharePiiKinds([
      { kind: 'email', source: 'detector' },
      { kind: 'phone', source: 'detector' },
      { kind: 'email', source: 'detector' },
    ])).toEqual({ labels: ['email', 'phone'], hasMore: false })
  })

  it('leaves out personal details when a specific kind is listed', () => {
    expect(describeSharePiiKinds([
      { kind: 'email', source: 'detector' },
      { kind: 'personal-data', source: 'typesafe' },
    ])).toEqual({ labels: ['email'], hasMore: false })
  })

  it('names personal details when it is the only finding', () => {
    expect(describeSharePiiKinds([
      { kind: 'personal-data', source: 'typesafe' },
    ])).toEqual({ labels: ['personal details'], hasMore: false })
  })

  it('caps the list at three labels and says there are more', () => {
    expect(describeSharePiiKinds([
      { kind: 'email', source: 'detector' },
      { kind: 'phone', source: 'detector' },
      { kind: 'payment-card', source: 'detector' },
      { kind: 'iban', source: 'detector' },
    ])).toEqual({
      labels: ['email', 'phone', 'card number'],
      hasMore: true,
    })
  })

  it('has no labels without warnings', () => {
    expect(describeSharePiiKinds([])).toEqual({ labels: [], hasMore: false })
  })
})

describe('SHARE_PII_GENERIC_REMINDER', () => {
  it('is the fixed reminder wording', () => {
    expect(SHARE_PII_GENERIC_REMINDER)
      .toBe('Check the chat for personal data before sharing.')
  })
})
