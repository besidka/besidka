import { useWebHaptics } from 'web-haptics/vue'

/**
 * @docs https://haptics.lochie.me/
 */
export function useHaptics() {
  const { trigger } = useWebHaptics({
    debug: true,
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
