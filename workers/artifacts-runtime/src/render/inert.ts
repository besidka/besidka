const NAVIGATING_ELEMENTS = 'meta[http-equiv], noscript'

export function removeNavigatingElements(root: ParentNode) {
  for (const element of root.querySelectorAll(NAVIGATING_ELEMENTS)) {
    element.remove()
  }
}

export function setMarkup(container: Element, html: string) {
  const template = document.createElement('template')

  template.innerHTML = html
  removeNavigatingElements(template.content)
  container.replaceChildren(template.content)
}
