import type { ArtifactKind } from '@besidka/artifacts-protocol'
import { reportError } from '../report.ts'
import { DESIGN_STYLE_ATTRIBUTE, withLayerOrder } from './layers.ts'
import type { DesignCompiler } from './system.ts'

export const DESIGN_SYSTEM_KINDS: ReadonlySet<ArtifactKind> = new Set([
  'html',
  'react',
])

const CLASS_SELECTOR = '[class]'

export const DESIGN_COMPILE_MEASURE = 'besidka-design-compile'

export const DESIGN_BUILD_MEASURE = 'besidka-design-build'

let compilerPromise: Promise<DesignCompiler | null> | null = null
let compiler: DesignCompiler | null = null
let observer: MutationObserver | null = null
let styleElement: HTMLStyleElement | null = null
let compiledCss = ''

const seenCandidates = new Set<string>()

export function usesDesignSystem(kind: ArtifactKind): boolean {
  return DESIGN_SYSTEM_KINDS.has(kind)
}

async function createCompiler(): Promise<DesignCompiler | null> {
  const startedAt = performance.now()

  try {
    const module = await import('./system.ts')
    const created = await module.createDesignCompiler()

    performance.measure(DESIGN_COMPILE_MEASURE, { start: startedAt })

    return created
  } catch (exception) {
    reportError(exception, { level: 'warning', showPanel: false })
    compilerPromise = null

    return null
  }
}

/**
 * Loads and compiles the design system once per frame (a lazy chunk, only
 * for html and react artifacts). Resolves to `false` when it could not be
 * loaded; the artifact then renders without it.
 */
export async function prepareDesignSystem(): Promise<boolean> {
  compilerPromise ??= createCompiler()
  compiler = await compilerPromise

  return compiler !== null
}

function addCandidates(element: Element, candidates: string[]) {
  for (const candidate of element.classList) {
    if (!seenCandidates.has(candidate)) {
      seenCandidates.add(candidate)
      candidates.push(candidate)
    }
  }
}

function collectFromTree(root: Element, candidates: string[]) {
  addCandidates(root, candidates)

  for (const element of root.querySelectorAll(CLASS_SELECTOR)) {
    addCandidates(element, candidates)
  }
}

function writeStyle() {
  if (styleElement && styleElement.textContent !== compiledCss) {
    styleElement.textContent = compiledCss
  }
}

function buildCandidates(candidates: string[]) {
  if (!compiler || candidates.length === 0) {
    return
  }

  const startedAt = performance.now()

  try {
    compiledCss = withLayerOrder(compiler.build(candidates))
    performance.measure(DESIGN_BUILD_MEASURE, {
      start: startedAt,
      detail: { candidates: candidates.length },
    })
  } catch (exception) {
    reportError(exception, { level: 'warning', showPanel: false })

    return
  }

  writeStyle()
}

function handleMutations(records: MutationRecord[]) {
  const candidates: string[] = []

  for (const record of records) {
    if (record.type === 'attributes' && record.target instanceof Element) {
      addCandidates(record.target, candidates)

      continue
    }

    for (const node of record.addedNodes) {
      if (node instanceof Element) {
        collectFromTree(node, candidates)
      }
    }
  }

  buildCandidates(candidates)
}

function ensureStyleElement(): HTMLStyleElement | null {
  const head = document.head

  if (!head) {
    return null
  }

  if (!styleElement) {
    styleElement = document.createElement('style')
    styleElement.setAttribute(DESIGN_STYLE_ATTRIBUTE, '')
  }

  if (styleElement.parentNode !== head) {
    head.prepend(styleElement)
  }

  writeStyle()

  return styleElement
}

/**
 * Puts the compiled design CSS into the current document's head (before the
 * artifact's own styles), builds CSS for every class already in the
 * document and watches the document for new classes. Runs synchronously,
 * so on a replaced HTML document nothing paints before the styles exist,
 * and classes that artifact code adds later are compiled in the mutation
 * callback, before the next paint.
 */
export function attachDesignSystem() {
  observer?.disconnect()

  const root = document.documentElement

  if (!compiler || !root || !ensureStyleElement()) {
    return
  }

  const candidates: string[] = []

  collectFromTree(root, candidates)
  buildCandidates(candidates)
  observer ??= new MutationObserver(handleMutations)
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class'],
  })
}

export function detachDesignSystem() {
  observer?.disconnect()
  styleElement?.remove()
}
