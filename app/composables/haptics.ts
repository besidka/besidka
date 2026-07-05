import { useWebHaptics } from 'web-haptics/vue'

/**
 * @docs https://haptics.lochie.me/
 */
export function useHaptics() {
  const { isDesktop } = useDevice()

  const { trigger } = useWebHaptics({
    debug: isDesktop,
  })

  return {
    hapticSuccess: () => trigger('success'),
    hapticWarning: () => trigger('warning'),
    hapticError: () => trigger('error'),
    hapticLight: () => trigger('light'),
    hapticMedium: () => trigger('medium'),
    hapticHeavy: () => trigger('heavy'),
    hapticSoft: () => trigger('soft'),
    hapticRigid: () => trigger('rigid'),
    haptic: trigger,
  }
}
