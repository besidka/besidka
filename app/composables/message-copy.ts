async function writeTextFallback(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)

    return true
  } catch {
    return false
  }
}

function execCommandCopyTextarea(text: string): boolean {
  const textarea = document.createElement('textarea')

  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()

  let succeeded: boolean

  try {
    succeeded = document.execCommand('copy')
  } catch {
    succeeded = false
  }

  document.body.removeChild(textarea)

  return succeeded
}

function execCommandCopyHtml(html: string): boolean {
  const container = document.createElement('div')

  container.contentEditable = 'true'
  container.style.position = 'fixed'
  container.style.opacity = '0'
  container.innerHTML = html
  document.body.appendChild(container)

  const range = document.createRange()

  range.selectNodeContents(container)

  const selection = window.getSelection()

  selection?.removeAllRanges()
  selection?.addRange(range)

  let succeeded: boolean

  try {
    succeeded = document.execCommand('copy')
  } catch {
    succeeded = false
  }

  selection?.removeAllRanges()
  document.body.removeChild(container)

  return succeeded
}

async function tryRichWrite(html: string, text: string): Promise<boolean> {
  if (
    typeof ClipboardItem === 'undefined'
    || typeof navigator.clipboard?.write !== 'function'
    || !window.isSecureContext
  ) {
    return false
  }

  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      }),
    ])

    return true
  } catch {
    return false
  }
}

export function useMessageCopy() {
  async function copyRich(
    { html, text }: { html: string, text: string },
  ): Promise<boolean> {
    if (await tryRichWrite(html, text)) {
      return true
    }

    if (await writeTextFallback(text)) {
      return true
    }

    return execCommandCopyHtml(html)
  }

  async function copyPlain(text: string): Promise<boolean> {
    if (await writeTextFallback(text)) {
      return true
    }

    return execCommandCopyTextarea(text)
  }

  return {
    copyRich,
    copyPlain,
  }
}
