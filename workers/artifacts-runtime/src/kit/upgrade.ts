import { CODE_ELEMENT_NAME, MERMAID_ELEMENT_NAME } from './elements.ts'

export const RAW_ATTRIBUTE = 'data-besidka-raw'

const LANGUAGE_CLASS_PATTERN = /(?:^|\s)lang(?:uage)?-([\w#+.-]+)/i

export interface UpgradeOptions {
  includeUnlabelled?: boolean
}

function readLanguage(code: Element): string | null {
  const match = LANGUAGE_CLASS_PATTERN.exec(code.getAttribute('class') ?? '')

  return match?.[1]?.toLowerCase() ?? null
}

function isOptedOut(pre: Element, code: Element): boolean {
  return pre.hasAttribute(RAW_ATTRIBUTE)
    || code.hasAttribute(RAW_ATTRIBUTE)
    || pre.closest(`[${RAW_ATTRIBUTE}]`) !== null
}

function createReplacement(
  ownerDocument: Document,
  language: string | null,
  source: string,
): HTMLElement {
  if (language === 'mermaid') {
    const element = ownerDocument.createElement(MERMAID_ELEMENT_NAME)

    element.textContent = source

    return element
  }

  const element = ownerDocument.createElement(CODE_ELEMENT_NAME)

  if (language) {
    element.setAttribute('lang', language)
  }

  element.textContent = source

  return element
}

/**
 * Replaces `<pre><code class="language-*">` blocks under `root` with
 * `<besidka-code>` (or `<besidka-mermaid>` for `language-mermaid`). Markdown
 * passes `includeUnlabelled`, because every fenced block is code there; in
 * HTML a plain `<pre><code>` is left alone. `data-besidka-raw` on the
 * `<pre>`, the `<code>` or an ancestor keeps a block as written. This runs
 * once per render; blocks added later by artifact scripts stay as they are.
 */
export function upgradeCodeBlocks(
  root: ParentNode,
  options: UpgradeOptions = {},
): number {
  let upgraded = 0

  for (const code of root.querySelectorAll('pre > code')) {
    const pre = code.parentElement

    if (!pre || pre.children.length !== 1 || isOptedOut(pre, code)) {
      continue
    }

    const language = readLanguage(code)

    if (!language && !options.includeUnlabelled) {
      continue
    }

    pre.replaceWith(createReplacement(
      pre.ownerDocument,
      language,
      code.textContent ?? '',
    ))
    upgraded += 1
  }

  return upgraded
}
