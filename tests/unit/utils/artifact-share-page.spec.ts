import { describe, expect, it } from 'vitest'
import {
  isArtifactShareTakenDownError,
  resolveArtifactSharePageState,
} from '../../../app/utils/artifact-share-page'

function fetchError(statusCode: number, data?: unknown) {
  return { statusCode, data }
}

describe('resolveArtifactSharePageState', () => {
  it.each([
    ['idle', 'loading'],
    ['pending', 'loading'],
    ['success', 'error'],
  ] as const)('is %s without data → %s', (status, expected) => {
    expect(resolveArtifactSharePageState({
      status,
      hasData: false,
      error: null,
    })).toBe(expected)
  })

  it('is ready with data', () => {
    expect(resolveArtifactSharePageState({
      status: 'success',
      hasData: true,
      error: null,
    })).toBe('ready')
  })

  it('treats 404 as a link that is not available', () => {
    expect(resolveArtifactSharePageState({
      status: 'error',
      hasData: false,
      error: fetchError(404),
    })).toBe('not-found')
  })

  it('treats a 410 with takenDown as a takedown', () => {
    expect(resolveArtifactSharePageState({
      status: 'error',
      hasData: false,
      error: fetchError(410, {
        statusCode: 410,
        data: { takenDown: true },
      }),
    })).toBe('taken-down')
  })

  it('treats a 410 for missing content as a load error', () => {
    expect(resolveArtifactSharePageState({
      status: 'error',
      hasData: false,
      error: fetchError(410, { statusCode: 410 }),
    })).toBe('error')
  })

  it.each([500, 503, 0])('treats status %i as a load error', (status) => {
    expect(resolveArtifactSharePageState({
      status: 'error',
      hasData: false,
      error: fetchError(status),
    })).toBe('error')
  })
})

describe('isArtifactShareTakenDownError', () => {
  it.each([
    [{ data: { takenDown: true } }],
    [{ takenDown: true }],
    [{ code: 'artifact_taken_down' }],
  ])('accepts the takedown body %j', (data) => {
    expect(isArtifactShareTakenDownError(fetchError(410, data))).toBe(true)
  })

  it('needs status 410', () => {
    expect(isArtifactShareTakenDownError(
      fetchError(404, { data: { takenDown: true } }),
    )).toBe(false)
  })

  it('reads the status from `status` too', () => {
    expect(isArtifactShareTakenDownError({
      status: 410,
      data: { data: { takenDown: true } },
    })).toBe(true)
  })
})
