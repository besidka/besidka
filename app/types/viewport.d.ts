import type { MaybeRefOrGetter } from 'vue'

export type ViewportType
  = | 'isMobileSmall'
    | 'isMobile'
    | 'isMobileOrTablet'
    | 'isTablet'
    | 'isDesktopOrTablet'
    | 'isDesktop'

export type Viewport = {
  [K in ViewportType]: MaybeRefOrGetter<boolean | Ref<boolean>>
}
