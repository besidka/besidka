import type {
  ArtifactPayload,
  RenderedParams,
  Theme,
} from '@besidka/artifacts-protocol'
import {
  attachDesignSystem,
  detachDesignSystem,
  prepareDesignSystem,
  usesDesignSystem,
} from './design/index.ts'
import { upgradeCodeBlocks } from './kit/upgrade.ts'
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
import {
  applyVisibility,
  hideDocument,
  nextFrame,
  revealDocument,
  waitForFinalPaint,
} from './reveal.ts'
import { ROOT_ELEMENT_ID, createShellDocument } from './shell.ts'
import { observeDocumentSize } from './size.ts'
import { applyThemeToDocument, getTheme, setTheme } from './theme.ts'

const DEFAULT_TITLE = 'Besidka artifact'

let renderSequence = 0
let documentReplaced = false
let reactMounted = false
let pendingPartial: ArtifactPayload | null = null
let partialFrame = 0
let renderedNotifier: (params: RenderedParams) => void = () => {}

export function setRenderedNotifier(
  notifier: (params: RenderedParams) => void,
) {
  renderedNotifier = notifier
}

export function installDocumentHooks() {
  applyVisibility()
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
  attachDesignSystem()
  upgradeCodeBlocks(document)
}

function restoreShell() {
  detachDesignSystem()
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

async function renderArtifactContent(
  payload: ArtifactPayload,
  isCurrent: () => boolean,
) {
  try {
    await unmountCurrentReact()

    if (!isCurrent()) {
      return
    }

    if (usesDesignSystem(payload.kind)) {
      await prepareDesignSystem()

      if (!isCurrent()) {
        return
      }
    } else {
      detachDesignSystem()
    }

    if (payload.kind === 'html') {
      documentReplaced = true
      await replaceDocument(payload.content, htmlPrelude, isCurrent)

      if (isCurrent() && !document.title) {
        document.title = payload.title || DEFAULT_TITLE
      }

      return
    }

    if (documentReplaced) {
      restoreShell()
    }

    const root = getRoot()
    const renderer = await selectRenderer(payload.kind).load()

    if (!isCurrent()) {
      return
    }

    document.title = payload.title || DEFAULT_TITLE

    if (usesDesignSystem(payload.kind)) {
      attachDesignSystem()
    }

    reactMounted = payload.kind === 'react'
    await renderer(payload, { root, theme: getTheme(), isCurrent })
  } catch (exception) {
    if (isCurrent()) {
      reportError(exception)
    }
  }
}

export async function renderArtifact(payload: ArtifactPayload) {
  cancelPartial()

  const sequence = startRender()
  const isCurrent = () => {
    return sequence === renderSequence
  }

  hideDocument()
  await renderArtifactContent(payload, isCurrent)

  if (!isCurrent()) {
    return
  }

  await waitForFinalPaint()

  if (!isCurrent()) {
    return
  }

  revealDocument()
  observeDocumentSize()
  await nextFrame()

  if (isCurrent()) {
    renderedNotifier({ kind: payload.kind, partial: false })
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
  const isCurrent = () => {
    return sequence === renderSequence
  }

  revealDocument()

  try {
    await unmountCurrentReact()

    if (!isCurrent()) {
      return
    }

    if (documentReplaced) {
      restoreShell()
    }

    detachDesignSystem()

    const root = getRoot()

    if (payload.kind !== 'markdown') {
      renderSourcePreview(payload, root)
      renderedNotifier({ kind: payload.kind, partial: true })

      return
    }

    const renderer = await selectRenderer('markdown').load()

    if (!isCurrent()) {
      return
    }

    await renderer(payload, {
      root,
      theme: getTheme(),
      isCurrent,
      partial: true,
    })

    if (isCurrent()) {
      renderedNotifier({ kind: payload.kind, partial: true })
    }
  } catch (exception) {
    reportError(exception, { level: 'warning', showPanel: false })

    if (isCurrent()) {
      renderedNotifier({ kind: payload.kind, partial: true })
    }
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
  setTheme(theme)
}
