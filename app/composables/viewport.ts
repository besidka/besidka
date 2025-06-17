import { breakpointsTailwind, useBreakpoints } from '@vueuse/core'
import type { Viewport } from '~/types/viewport.d'

/**
 * Breakpoints for Tailwind CSS
 * Docs:
 * - https://vueuse.org/core/useBreakpoints/#usebreakpoints
 * - https://tailwindcss.com/docs/responsive-design
 */
export const useViewport = (): Viewport => {
  const { smaller, greater, between } = useBreakpoints(breakpointsTailwind)

  return {
    isMobileSmall: smaller('sm'),
    isMobile: smaller('md'),
    isMobileOrTablet: smaller('lg'),
    isTablet: between('md', 'lg'),
    isDesktopOrTablet: greater('md'),
    isDesktop: greater('lg'),
  }
}
