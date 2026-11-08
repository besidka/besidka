type LinkOpener = (url: string) => void

const EXTERNAL_LINK_PATTERN = /^https?:\/\//i

const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'

let openLink: LinkOpener | null = null

export function resolveExternalLink(href: string | null): string | null {
  if (!href || !EXTERNAL_LINK_PATTERN.test(href.trim())) {
    return null
  }

  try {
    return new URL(href.trim()).toString()
  } catch {
    return null
  }
}

function handleClick(event: MouseEvent) {
  const target = event.target

  if (!(target instanceof Element)) {
    return
  }

  const anchor = target.closest('a, area')

  if (!anchor) {
    return
  }

  const href = anchor.getAttribute('href')
    ?? anchor.getAttributeNS(XLINK_NAMESPACE, 'href')

  if (href === null || href.startsWith('#')) {
    return
  }

  event.preventDefault()

  const url = resolveExternalLink(href)

  if (url) {
    openLink?.(url)
  }
}

/**
 * Every link click is cancelled, so a link never navigates the frame (the
 * host treats any frame navigation as a compromise). External http(s) links
 * are handed to the host, which shows the address and opens it only after
 * the viewer clicks.
 */
export function installLinkInterception(opener?: LinkOpener) {
  if (opener) {
    openLink = opener
  }

  document.addEventListener('click', handleClick, true)
}
