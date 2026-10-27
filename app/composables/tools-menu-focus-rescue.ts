import type { MaybeRefOrGetter } from 'vue'

export const TOOLS_MENU_CONTENT_SELECTOR = '.js-tools-content'
export const TOOLS_MENU_SECTION_SELECTOR = '[data-section]'

const CHECKED_RADIO_SELECTOR = 'input[type="radio"]:checked:not(:disabled)'

const CHECKED_LEVEL_SELECTORS = [
  '.js-reasoning-level-group input:checked:not(:disabled)',
  CHECKED_RADIO_SELECTOR,
]

interface RestoreFocusOptions {
  force?: boolean
  near?: Element | null
}

export function isFocusLost(): boolean {
  const activeElement = document.activeElement

  return !activeElement
    || !activeElement.isConnected
    || activeElement === document.body
    || activeElement instanceof HTMLDialogElement
}

function findCheckedRadioInSection(
  section: Element,
  vanishingElement: Element,
): HTMLInputElement | undefined {
  const candidates = section.querySelectorAll<HTMLInputElement>(
    CHECKED_RADIO_SELECTOR,
  )

  return Array.from(candidates).find((candidate) => {
    return !vanishingElement.contains(candidate)
      && !candidate.closest('[inert]')
  })
}

/**
 * A control that disappears while it holds focus drops focus to the document
 * body. The nearest stable control is the checked radio of the section the
 * vanishing element belongs to (the web search provider group for the Exa
 * depth row), then the checked radio of the level group, so keyboard users
 * keep their place in the menu. Without `force` it acts only when focus is
 * really lost. `near` is read before the next tick, while its section is
 * still reachable.
 */
export async function restoreToolsMenuFocus(
  content: Element,
  options: RestoreFocusOptions = {},
) {
  const nearSection = options.near?.closest(TOOLS_MENU_SECTION_SELECTOR)

  await nextTick()

  if (!content.isConnected || (!options.force && !isFocusLost())) {
    return
  }

  const sectionTarget = nearSection?.isConnected && options.near
    ? findCheckedRadioInSection(nearSection, options.near)
    : undefined

  if (sectionTarget) {
    sectionTarget.focus({ preventScroll: true })

    return
  }

  for (const selector of CHECKED_LEVEL_SELECTORS) {
    const target = content.querySelector<HTMLInputElement>(selector)

    if (target) {
      target.focus({ preventScroll: true })

      return
    }
  }
}

export function useToolsMenuFocusRescue(
  element: MaybeRefOrGetter<HTMLElement | null | undefined>,
) {
  onBeforeUnmount(() => {
    const unmountingElement = toValue(element)
    const content = unmountingElement?.closest(TOOLS_MENU_CONTENT_SELECTOR)

    if (
      !unmountingElement
      || !content
      || !unmountingElement.contains(document.activeElement)
    ) {
      return
    }

    restoreToolsMenuFocus(content, { near: unmountingElement })
  })
}
