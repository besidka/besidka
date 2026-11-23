import { describe, expect, it } from 'vitest'
import { isGoogleTabVisible } from '../../../app/utils/google-keys-tab'

const NONE = {
  isConnectorsActive: false,
  isDriveActive: false,
  hasConnection: false,
  hasByoStatus: false,
}

describe('isGoogleTabVisible', () => {
  it('shows the tab whenever the status carries the own client', () => {
    expect(isGoogleTabVisible({ ...NONE, hasByoStatus: true })).toBe(true)
    expect(isGoogleTabVisible({
      ...NONE,
      isConnectorsActive: true,
      hasByoStatus: true,
    })).toBe(true)
  })

  it('hides the tab with the Connectors page when there is no own client',
    () => {
      expect(isGoogleTabVisible({
        ...NONE,
        isConnectorsActive: true,
        isDriveActive: true,
        hasConnection: true,
      })).toBe(false)
    })

  it('keeps the Drive card reachable without the Connectors page', () => {
    expect(isGoogleTabVisible({ ...NONE, isDriveActive: true })).toBe(true)
    expect(isGoogleTabVisible({ ...NONE, hasConnection: true })).toBe(true)
    expect(isGoogleTabVisible(NONE)).toBe(false)
  })
})
