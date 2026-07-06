const iosDevicePattern = /\b(iPhone|iPad|iPod)\b/i
const safariTokenPattern = /\bSafari\b/i

interface StandaloneNavigator extends Navigator {
  standalone?: boolean
}

function isIosDevice(userAgent: string): boolean {
  if (iosDevicePattern.test(userAgent)) {
    return true
  }

  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

function isStandaloneDisplay(): boolean {
  const isDisplayModeStandalone = window
    .matchMedia('(display-mode: standalone)')
    .matches

  const isNavigatorStandalone = (navigator as StandaloneNavigator)
    .standalone === true

  return isDisplayModeStandalone || isNavigatorStandalone
}

export function isIosInAppBrowser(): boolean {
  if (!import.meta.client) {
    return false
  }

  const userAgent = navigator.userAgent

  if (!isIosDevice(userAgent)) {
    return false
  }

  if (isStandaloneDisplay()) {
    return false
  }

  return !safariTokenPattern.test(userAgent)
}

export function isIosExternalBrowser(): boolean {
  if (!import.meta.client) {
    return false
  }

  if (!isIosDevice(navigator.userAgent)) {
    return false
  }

  return !isStandaloneDisplay()
}

export function isExternalBrowserContext(): boolean {
  if (!import.meta.client) {
    return false
  }

  return !isStandaloneDisplay()
}
