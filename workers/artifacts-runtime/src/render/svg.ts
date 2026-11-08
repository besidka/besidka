import { setMarkup } from './inert.ts'
import type { Renderer } from './types.ts'

export const renderSvg: Renderer = (payload, context) => {
  const container = document.createElement('main')

  container.className = 'besidka-svg'
  setMarkup(container, payload.content)
  context.root.replaceChildren(container)
}
