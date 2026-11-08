import type { ArtifactPayload, Theme } from '@besidka/artifacts-protocol'
import { installLinkInterception } from './links.ts'
import { replaceDocument, replaceDocumentRoot } from './render/html.ts'
import { selectRenderer } from './render/index.ts'
import { renderSourcePreview } from './render/partial.ts'
import {
  clearErrorPanel,
  installGlobalErrorHandlers,
  reportError,
  resetReportBudget,
} from './report.ts'
import { ROOT_ELEMENT_ID, createShellDocument } from './shell.ts'
import { observeDocumentSize } from './size.ts'
import { applyThemeToDocument, getTheme, setTheme } from './theme.ts'

const DEFAULT_TITLE = 'Besidka artifact'

let renderSequence = 0
let documentReplaced = false
let reactMounted = false
let lastPayload: ArtifactPayload | null = null
let pendingPartial: ArtifactPayload | null = null
let partialFrame = 0

export function installDocumentHooks() {
  applyThemeToDocument()
  installGlobalErrorHandlers()
  installLinkInterception()
  observeDocumentSize()
}

function markDocumentAsGenerated() {
  if (!document.head) {
    return
  }

  if (document.head.querySelector('meta[name="ai-generated"]')) {
    return
  }

  const meta = document.createElement('meta')

  meta.name = 'ai-generated'
  meta.content = 'true'
  document.head.prepend(meta)
}

function htmlPrelude() {
  installDocumentHooks()
  markDocumentAsGenerated()
}

function restoreShell() {
  replaceDocumentRoot(createShellDocument(getTheme()), installDocumentHooks)
  documentReplaced = false
}

function getRoot(): HTMLElement {
  const root = document.getElementById(ROOT_ELEMENT_ID)

  if (root) {
    return root
  }

  restoreShell()

  return document.getElementById(ROOT_ELEMENT_ID) as HTMLElement
}

async function unmountCurrentReact() {
  if (!reactMounted) {
    return
  }

  reactMounted = false

  const module = await import('./render/react.ts')

  module.unmountReact()
}

function cancelPartial() {
  if (partialFrame) {
    cancelAnimationFrame(partialFrame)
  }

  partialFrame = 0
  pendingPartial = null
}

function startRender(): number {
  renderSequence += 1
  resetReportBudget()
  clearErrorPanel()

  return renderSequence
}

export async function renderArtifact(payload: ArtifactPayload) {
  cancelPartial()

  const sequence = startRender()
  const isCurrent = () => {
    return sequence === renderSequence
  }

  lastPayload = payload

  try {
    await unmountCurrentReact()

    if (payload.kind === 'html') {
      documentReplaced = true
      await replaceDocument(payload.content, htmlPrelude)

      if (!document.title) {
        document.title = payload.title || DEFAULT_TITLE
      }

      return
    }

    if (documentReplaced) {
      restoreShell()
    }

    const root = getRoot()
    const renderer = await selectRenderer(payload.kind).load()

    document.title = payload.title || DEFAULT_TITLE

    if (!isCurrent()) {
      return
    }

    await renderer(payload, { root, theme: getTheme(), isCurrent })
    reactMounted = payload.kind === 'react'
  } catch (exception) {
    if (isCurrent()) {
      reportError(exception)
    }
  } finally {
    if (isCurrent()) {
      observeDocumentSize()
    }
  }
}

async function flushPartial() {
  partialFrame = 0

  const payload = pendingPartial

  pendingPartial = null

  if (!payload) {
    return
  }

  const sequence = startRender()

  try {
    await unmountCurrentReact()

    if (documentReplaced) {
      restoreShell()
    }

    const root = getRoot()

    if (payload.kind !== 'markdown') {
      renderSourcePreview(payload, root)

      return
    }

    const renderer = await selectRenderer('markdown').load()

    if (sequence !== renderSequence) {
      return
    }

    await renderer(payload, {
      root,
      theme: getTheme(),
      isCurrent: () => {
        return sequence === renderSequence
      },
    })
  } catch (exception) {
    reportError(exception, { level: 'warning', showPanel: false })
  } finally {
    observeDocumentSize()
  }
}

export function renderPartial(payload: ArtifactPayload) {
  pendingPartial = payload

  if (partialFrame) {
    return
  }

  partialFrame = requestAnimationFrame(() => {
    flushPartial()
  })
}

export function changeTheme(theme: Theme) {
  const changed = setTheme(theme)

  if (changed && lastPayload?.kind === 'mermaid') {
    renderArtifact(lastPayload)
  }
}
