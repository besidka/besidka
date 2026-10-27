import type { MaybeRefOrGetter } from 'vue'

export const TOOLS_MENU_CONTENT_SELECTOR = '.js-tools-content'

const CHECKED_LEVEL_SELECTORS = [
  '.js-reasoning-level-group input:checked:not(:disabled)',
  'input[type="radio"]:checked:not(:disabled)',
]

interface RestoreFocusOptions {
  force?: boolean
}

function isFocusLost(): boolean {
  const activeElement = document.activeElement

  return !activeElement
    || !activeElement.isConnected
    || activeElement === document.body
    || activeElement instanceof HTMLDialogElement
}

/**
 * A control that disappears while it holds focus drops focus to the document
 * body. The checked radio of the level group is the nearest stable control,
 * so keyboard users keep their place in the menu. Without `force` it acts
 * only when focus is really lost.
 */
export async function restoreToolsMenuFocus(
  content: Element,
  options: RestoreFocusOptions = {},
) {
  await nextTick()

  if (!content.isConnected || (!options.force && !isFocusLost())) {
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

    restoreToolsMenuFocus(content)
  })
}
