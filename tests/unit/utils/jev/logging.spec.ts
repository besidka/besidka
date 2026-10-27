import { describe, expect, it } from 'vitest'
import {
  JEV_MAX_LOGGED_SCORES,
  jevRoleLogKey,
  recordJevRoleLog,
} from '~~/server/utils/jev/logging'

function createLogger() {
  const fields: Array<Record<string, any>> = []

  return {
    fields,
    logger: {
      set: (value: Record<string, unknown>) => {
        fields.push(value)
      },
      getContext: () => fields.at(-1) ?? {},
    },
  }
}

describe('jevRoleLogKey', () => {
  it('keeps memoryJev for memory checks and <role>Jev for the others', () => {
    expect(jevRoleLogKey('memoryChecks')).toBe('memoryJev')
    expect(jevRoleLogKey('autoWebSearch')).toBe('autoWebSearchJev')
    expect(jevRoleLogKey('extractionPrefilter')).toBe('extractionPrefilterJev')
    expect(jevRoleLogKey('injectionScreening')).toBe('injectionScreeningJev')
    expect(jevRoleLogKey('rerank')).toBe('rerankJev')
    expect(jevRoleLogKey('sharePiiCheck')).toBe('sharePiiCheckJev')
    expect(jevRoleLogKey('pastChatRetrieval')).toBe('pastChatRetrievalJev')
  })
})

describe('recordJevRoleLog', () => {
  it('logs counts, rounded scores, status and latency under the role key',
    () => {
      const { fields, logger } = createLogger()

      recordJevRoleLog('autoWebSearch', {
        status: 'ok',
        calls: 1,
        questions: 2,
        inputTokens: 548,
        latencyMs: 175,
        counts: { searched: 1 },
        scores: [0.81234, 0.1],
      }, logger)

      expect(fields).toEqual([{
        attributes: {
          autoWebSearchJev: {
            model: 'jev-1.14.0',
            status: 'ok',
            calls: 1,
            questions: 2,
            inputTokens: 548,
            latencyMs: 175,
            counts: { searched: 1 },
            scores: [0.81, 0.1],
          },
        },
      }])
    })

  it('adds up repeated calls in one request and keeps the last status',
    () => {
      const { fields, logger } = createLogger()

      recordJevRoleLog('rerank', {
        status: 'ok',
        calls: 1,
        latencyMs: 200,
        counts: { reordered: 1 },
      }, logger)
      recordJevRoleLog('rerank', {
        status: 'timeout',
        calls: 1,
        latencyMs: 800,
        counts: { reordered: 0, fallback: 1 },
      }, logger)

      expect(fields.at(-1)?.attributes.rerankJev).toEqual({
        model: 'jev-1.14.0',
        status: 'timeout',
        calls: 2,
        latencyMs: 1000,
        counts: { reordered: 1, fallback: 1 },
      })
    })

  it('caps the logged scores', () => {
    const { fields, logger } = createLogger()

    recordJevRoleLog('rerank', {
      status: 'ok',
      scores: Array.from({ length: 50 }, () => 0.5),
    }, logger)

    expect(fields[0]?.attributes.rerankJev.scores)
      .toHaveLength(JEV_MAX_LOGGED_SCORES)
  })

  it('logs a key error with no other fields', () => {
    const { fields, logger } = createLogger()

    recordJevRoleLog('memoryChecks', { status: 'key-error' }, logger)

    expect(fields).toEqual([{
      attributes: { memoryJev: { model: 'jev-1.14.0', status: 'key-error' } },
    }])
  })

  it('never logs text, even when a caller smuggles it in', () => {
    const { fields, logger } = createLogger()
    const secret = 'my home address is Main Street 5'

    recordJevRoleLog('sharePiiCheck', {
      status: 'ok',
      calls: 1,
      scores: [0.9],
      ...({ text: secret, state: { chat: secret } } as object),
    }, logger)

    expect(JSON.stringify(fields)).not.toContain('Main Street')
  })

  it('does nothing without a logger', () => {
    expect(() => {
      recordJevRoleLog('rerank', { status: 'ok' }, undefined)
    }).not.toThrow()
  })
})
