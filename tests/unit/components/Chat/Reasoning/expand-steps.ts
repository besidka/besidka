import type { VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'

/**
 * Opens the collapsed steps box: its content renders only while open.
 */
export async function expandReasoningSteps(wrapper: VueWrapper) {
  const header = wrapper.find('[data-testid="reasoning-header"]')

  if (!header.exists() || header.element.parentElement?.hasAttribute('open')) {
    return
  }

  await header.trigger('click')
  await nextTick()
}
