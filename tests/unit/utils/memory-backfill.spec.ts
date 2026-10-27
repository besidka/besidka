import { describe, expect, it } from 'vitest'
import type { MemoryBackfillProgress } from '#shared/types/memory-backfill.d'
import {
  MEMORY_BACKFILL_COOLDOWN_MS,
  countBackfillEntries,
  describeBackfillDroppedReason,
  describeBackfillError,
  formatBackfillCost,
  getBackfillRetryAfterMs,
  isBackfillJobFinished,
} from '~/utils/memory-backfill'

function createJob(
  overrides: Partial<MemoryBackfillProgress> = {},
): MemoryBackfillProgress {
  return {
    id: 'job-1',
    status: 'running',
    startedAt: '2026-10-25T10:00:00.000Z',
    finishedAt: null,
    totalChats: 48,
    processedChats: 12,
    createdEntries: 3,
    updatedEntries: 1,
    skippedChats: 0,
    failedChats: 0,
    inputTokens: 0,
    outputTokens: 0,
    failureReason: null,
    dropped: {},
    model: null,
    estimate: null,
    ...overrides,
  }
}

function createRejection(
  statusCode: number,
  message: string,
  why: string,
  retryAfterHeader: string | null = null,
) {
  return Object.assign(new Error('Request failed'), {
    data: { statusCode, message, data: { why } },
    response: {
      headers: {
        get: (name: string) => {
          return name.toLowerCase() === 'retry-after' ? retryAfterHeader : null
        },
      },
    },
  })
}

describe('memory backfill utils', () => {
  describe('formatBackfillCost', () => {
    it.each([
      [null, 'price unknown'],
      [0, '$0.00'],
      [0.0001, '< $0.01'],
      [0.004, '< $0.01'],
      [0.01, '$0.01'],
      [0.516, '$0.52'],
      [12, '$12.00'],
    ])('formats %s as %s', (costUsd, expected) => {
      expect(formatBackfillCost(costUsd)).toBe(expected)
    })
  })

  describe('describeBackfillDroppedReason', () => {
    it.each([
      ['sensitive-topic', 'Sensitive topics (never saved)'],
      ['never-store', 'Private data (never saved)'],
      ['duplicate', 'Already remembered'],
      ['ungrounded', 'No supporting quote'],
      ['cap-reached', 'cap-reached'],
    ])('labels %s', (reason, expected) => {
      expect(describeBackfillDroppedReason(reason)).toBe(expected)
    })
  })

  describe('job helpers', () => {
    it('counts created and updated entries', () => {
      expect(countBackfillEntries(createJob())).toBe(4)
      expect(countBackfillEntries(null)).toBe(0)
    })

    it('knows when a job is finished', () => {
      expect(isBackfillJobFinished(null)).toBe(false)
      expect(isBackfillJobFinished(createJob())).toBe(false)
      expect(isBackfillJobFinished(createJob({ status: 'failed' })))
        .toBe(true)
    })
  })

  describe('getBackfillRetryAfterMs', () => {
    it('defaults to the three second drive cooldown', () => {
      expect(getBackfillRetryAfterMs(createRejection(429, 'Slow', 'x')))
        .toBe(MEMORY_BACKFILL_COOLDOWN_MS)
      expect(MEMORY_BACKFILL_COOLDOWN_MS).toBe(3_000)
    })

    it('honours a Retry-After header in seconds', () => {
      expect(getBackfillRetryAfterMs(
        createRejection(429, 'Slow', 'x', '7'),
      )).toBe(7000)
    })

    it('ignores a Retry-After header it cannot read', () => {
      expect(getBackfillRetryAfterMs(
        createRejection(429, 'Slow', 'x', 'soon'),
      )).toBe(MEMORY_BACKFILL_COOLDOWN_MS)
    })

    it('honours a retryAfter number in the error payload', () => {
      const exception = {
        data: {
          statusCode: 429,
          message: 'Slow',
          data: { retryAfter: 5 },
        },
      }

      expect(getBackfillRetryAfterMs(exception)).toBe(5000)
    })
  })

  describe('describeBackfillError', () => {
    it('uses the cooldown copy for a 429', () => {
      expect(describeBackfillError(
        createRejection(429, 'Backfill was requested moments ago', 'x'),
        'fallback',
      )).toEqual({
        message: 'Please wait a moment',
        why: 'Try again in a few seconds.',
        status: 429,
      })
    })

    it('passes the server message and reason through for a 409', () => {
      expect(describeBackfillError(
        createRejection(409, 'No model available', 'Add a key first.'),
        'fallback',
      )).toEqual({
        message: 'No model available',
        why: 'Add a key first.',
        status: 409,
      })
    })

    it('reads the message of a plain error', () => {
      expect(describeBackfillError(new Error('Network down'), 'Failed.'))
        .toMatchObject({ message: 'Network down' })
    })
  })
})
