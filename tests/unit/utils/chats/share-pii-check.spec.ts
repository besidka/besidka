import { describe, expect, it } from 'vitest'
import { estimateMemoryTokens } from '#shared/utils/memory-tokens'
import {
  chunkSharePiiSegments,
  collectSharedChatSegments,
  detectSharePii,
} from '~~/server/utils/chats/share-pii-check'

function kindsOf(text: string) {
  return detectSharePii([text]).kinds
}

describe('detectSharePii', () => {
  it.each([
    ['an email', 'Write to anna.kowalska@gmail.com please', 'email'],
    ['a Cyrillic address', 'пиши на іван.петренко@пошта.укр', 'email'],
    ['an international phone', 'Call +48 601 234 567 today', 'phone'],
    ['a Ukrainian phone', 'Мій номер +380 50 123 45 67', 'phone'],
    ['a US phone', 'Reach me on (415) 555-2671', 'phone'],
    ['a grouped Polish phone', 'Dzwoń 601 234 567', 'phone'],
    ['a Luhn-valid card', 'Card 4111 1111 1111 1111', 'payment-card'],
    ['an IBAN', 'Send to PL61 1090 1014 0000 0712 1981 2874', 'iban'],
    ['a PESEL', 'PESEL 44051401359', 'national-id'],
    ['a keyword-gated РНОКПП', 'РНОКПП 2345678902', 'tax-id'],
  ])('flags %s', (_label, text, kind) => {
    expect(kindsOf(text)).toContain(kind)
  })

  it.each([
    ['a reserved example domain', 'seed: user@example.com'],
    ['a .test address', 'admin@mail.test'],
    ['an IP address', 'server at 192.168.100.100 responds'],
    ['an ISO date', 'released 2026-10-26'],
    ['a version number', 'upgrade to 12.34.5678'],
    ['a card that fails Luhn', 'order 4111 1111 1111 1112'],
    ['an @-mention without a domain', 'thanks @anna for the review'],
    ['numeric table rows', 'Q3 totals: 2024 100 2500 and 1200 350 4500'],
    ['plain prose', 'How long do I boil an egg?'],
  ])('does not flag %s', (_label, text) => {
    expect(kindsOf(text)).toEqual([])
  })

  it('returns each kind once in a fixed order, across segments', () => {
    const { kinds } = detectSharePii([
      'a@b.pl and c@d.pl',
      'Card 4111 1111 1111 1111',
      'Call +48 601 234 567',
    ])

    expect(kinds).toEqual(['email', 'phone', 'payment-card'])
  })

  it('replaces every match so no value is left to send', () => {
    const { redactedSegments } = detectSharePii([
      'Mail anna@gmail.com, call +48 601 234 567, card 4111 1111 1111 1111.',
    ])

    expect(redactedSegments[0]).toBe(
      'Mail [redacted], call [redacted], card [redacted].',
    )
  })

  it('keeps text without matches unchanged', () => {
    const { redactedSegments } = detectSharePii(['Plain text only'])

    expect(redactedSegments).toEqual(['Plain text only'])
  })
})

describe('collectSharedChatSegments', () => {
  const filePart = {
    type: 'file' as const,
    mediaType: 'image/png',
    filename: 'scan.png',
    url: 'https://example.test/scan.png',
  }

  it('labels the title and each persisted message, text and reasoning only',
    () => {
      const segments = collectSharedChatSegments({
        title: 'My chat',
        showFiles: true,
        messages: [
          { role: 'user', parts: [{ type: 'text', text: 'Hello' }] },
          {
            role: 'assistant',
            parts: [
              { type: 'reasoning', text: 'Thinking' },
              { type: 'text', text: 'Hi' },
              {
                type: 'tool-web_search',
                toolCallId: 'call-1',
                state: 'output-available',
                input: { query: 'hidden' },
                output: [],
              },
            ],
          },
          { role: 'system', parts: [{ type: 'text', text: 'ignored' }] },
        ],
      })

      expect(segments).toEqual([
        'Title: My chat',
        'User: Hello',
        'Assistant: Thinking\nHi',
      ])
    })

  it('includes file names only when the share shows files', () => {
    const messages = [{ role: 'user', parts: [filePart] }]

    expect(collectSharedChatSegments({
      title: null,
      messages,
      showFiles: true,
    })).toEqual(['User: scan.png'])
    expect(collectSharedChatSegments({
      title: null,
      messages,
      showFiles: false,
    })).toEqual([])
  })

  it('skips an empty title and empty messages', () => {
    expect(collectSharedChatSegments({
      title: '  ',
      showFiles: true,
      messages: [{ role: 'user', parts: [{ type: 'text', text: ' ' }] }],
    })).toEqual([])
  })
})

describe('chunkSharePiiSegments', () => {
  it('keeps everything in one chunk under the cap', () => {
    expect(chunkSharePiiSegments(['one', 'two'], 100)).toEqual(['one\n\ntwo'])
  })

  it('packs whole segments into chunks that stay under the cap', () => {
    const segment = 'word '.repeat(200)
    const chunks = chunkSharePiiSegments(
      [segment, segment, segment],
      estimateMemoryTokens(segment) * 2,
    )

    expect(chunks).toHaveLength(2)

    for (const chunk of chunks) {
      expect(estimateMemoryTokens(chunk))
        .toBeLessThanOrEqual(estimateMemoryTokens(segment) * 2 + 2)
    }
  })

  it('splits one oversized segment, Cyrillic included, without losing text',
    () => {
      const segment = 'Привіт, як справи? '.repeat(400)
      const cap = 500
      const chunks = chunkSharePiiSegments([segment], cap)

      expect(chunks.length).toBeGreaterThan(1)

      for (const chunk of chunks) {
        expect(estimateMemoryTokens(chunk)).toBeLessThanOrEqual(cap)
      }

      expect(chunks.join('').replace(/\n\n/g, '')).toBe(segment)
    })

  it('returns no chunks for no segments', () => {
    expect(chunkSharePiiSegments([], 100)).toEqual([])
  })
})
