import type { Renderer } from './types.ts'

export const renderSvg: Renderer = (payload, context) => {
  const container = document.createElement('main')

  container.className = 'besidka-svg'
  container.innerHTML = payload.content
  context.root.replaceChildren(container)
}
