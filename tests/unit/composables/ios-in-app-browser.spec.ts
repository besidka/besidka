import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isIosExternalBrowser,
  isIosInAppBrowser,
} from '../../../app/composables/ios-in-app-browser'

const IPHONE_SAFARI_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like'
  + ' Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0'
  + ' Mobile/15E148 Safari/604.1'
const IPHONE_IN_APP_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like'
  + ' Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const DESKTOP_CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
  + ' AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

function stubBrowser(options: {
  userAgent: string
  platform?: string
  maxTouchPoints?: number
  displayModeStandalone?: boolean
  navigatorStandalone?: boolean
}) {
  vi.stubGlobal('navigator', {
    userAgent: options.userAgent,
    platform: options.platform ?? 'iPhone',
    maxTouchPoints: options.maxTouchPoints ?? 0,
    standalone: options.navigatorStandalone ?? false,
  })
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: options.displayModeStandalone ?? false,
  })))
}

describe('ios-in-app-browser', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('detects an iOS in-app browser without the Safari token', () => {
    stubBrowser({ userAgent: IPHONE_IN_APP_UA })

    expect(isIosInAppBrowser()).toBe(true)
    expect(isIosExternalBrowser()).toBe(true)
  })

  it('treats iPhone Safari as external browser but not in-app', () => {
    stubBrowser({ userAgent: IPHONE_SAFARI_UA })

    expect(isIosInAppBrowser()).toBe(false)
    expect(isIosExternalBrowser()).toBe(true)
  })

  it('returns false for both inside the standalone PWA', () => {
    stubBrowser({
      userAgent: IPHONE_SAFARI_UA,
      displayModeStandalone: true,
    })

    expect(isIosInAppBrowser()).toBe(false)
    expect(isIosExternalBrowser()).toBe(false)
  })

  it('respects the legacy navigator.standalone flag', () => {
    stubBrowser({
      userAgent: IPHONE_SAFARI_UA,
      navigatorStandalone: true,
    })

    expect(isIosExternalBrowser()).toBe(false)
  })

  it('returns false for both on non-iOS browsers', () => {
    stubBrowser({
      userAgent: DESKTOP_CHROME_UA,
      platform: 'MacIntel',
      maxTouchPoints: 0,
    })

    expect(isIosInAppBrowser()).toBe(false)
    expect(isIosExternalBrowser()).toBe(false)
  })

  it('treats iPadOS masquerading as macOS as an iOS device', () => {
    stubBrowser({
      userAgent: DESKTOP_CHROME_UA,
      platform: 'MacIntel',
      maxTouchPoints: 5,
    })

    expect(isIosExternalBrowser()).toBe(true)
  })
})
