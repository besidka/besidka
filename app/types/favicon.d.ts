export type FaviconSource = '/favicon.svg' | '/favicon-dark.svg'

export type FaviconTheme = 'dark' | 'light'

export type ThemePreference = 'dark' | 'light' | 'system'

export type AvailableFavicons = Record<FaviconTheme, FaviconSource>
