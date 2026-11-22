import { afterEach, describe, expect, it, vi } from 'vitest'
import { getClientTimeZoneField } from '../../../app/utils/client-time-zone'

function stubResolvedTimeZone(timeZone: string | undefined) {
  vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () {
    return {
      resolvedOptions: () => ({ timeZone }),
    } as unknown as Intl.DateTimeFormat
  } as unknown as typeof Intl.DateTimeFormat)
}

describe('getClientTimeZoneField', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the zone the browser resolves', () => {
    stubResolvedTimeZone('Pacific/Auckland')

    expect(getClientTimeZoneField()).toEqual({ timeZone: 'Pacific/Auckland' })
  })

  it('returns the same zone on every call', () => {
    stubResolvedTimeZone('America/New_York')

    expect(getClientTimeZoneField()).toEqual(getClientTimeZoneField())
  })

  it('returns no field when the browser resolves no zone', () => {
    stubResolvedTimeZone(undefined)

    expect(getClientTimeZoneField()).toEqual({})
  })

  it('reads a real zone name from the runtime', () => {
    const field = getClientTimeZoneField()

    expect(typeof field.timeZone).toBe('string')
    expect(field.timeZone!.length).toBeGreaterThan(0)
  })
})
