import type { Theme } from '@besidka/artifacts-protocol'
import { reportError } from './report.ts'

type ThemeListener = (theme: Theme) => void

const themeListeners = new Set<ThemeListener>()

let currentTheme: Theme = 'light'

export function getTheme(): Theme {
  return currentTheme
}

export function applyThemeToDocument() {
  const root = document.documentElement

  if (!root) {
    return
  }

  root.dataset.theme = currentTheme
  root.style.colorScheme = currentTheme
}

export function setTheme(theme: Theme): boolean {
  if (theme === currentTheme) {
    applyThemeToDocument()

    return false
  }

  currentTheme = theme
  applyThemeToDocument()

  for (const listener of themeListeners) {
    try {
      listener(theme)
    } catch (exception) {
      reportError(exception)
    }
  }

  return true
}

export function onThemeChange(listener: ThemeListener): () => void {
  themeListeners.add(listener)

  return () => {
    themeListeners.delete(listener)
  }
}
