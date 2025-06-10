import type { FaviconTheme, AvailableFavicons } from '~/types/favicon.d'

const availableFavicons: AvailableFavicons = {
  light: '/favicon.svg',
  dark: '/favicon-dark.svg',
}

export const useThemeFavicon = () => {
  const activeFavicon = useFavicon(availableFavicons.light)

  return {
    setFavicon: (theme: FaviconTheme) => {
      activeFavicon.value = availableFavicons[theme]
    },
  }
}
