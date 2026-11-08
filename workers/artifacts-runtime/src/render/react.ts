import { reportError } from '../report.ts'
import {
  describeDisallowedImports,
  findDisallowedImports,
  transpileReactSource,
} from './react-source.ts'
import { ArtifactRenderError } from './types.ts'
import type { Renderer } from './types.ts'

interface ReactRoot {
  render: (element: unknown) => void
  unmount: () => void
}

interface ReactModule {
  createElement: (type: unknown, props?: unknown) => unknown
}

interface ReactDomClientModule {
  createRoot: (container: Element, options?: unknown) => ReactRoot
}

const REACT_SPECIFIER = 'react'

const REACT_DOM_CLIENT_SPECIFIER = 'react-dom/client'

const REACT_ELEMENT_TYPES = new Set([
  'react.forward_ref',
  'react.memo',
  'react.lazy',
])

let currentRoot: ReactRoot | null = null

function loadSharedModule<Module>(specifier: string): Promise<Module> {
  return import(specifier)
}

function isComponent(value: unknown): boolean {
  if (typeof value === 'function') {
    return true
  }

  if (typeof value !== 'object' || value === null) {
    return false
  }

  const marker = (value as { $$typeof?: unknown }).$$typeof

  return typeof marker === 'symbol'
    && REACT_ELEMENT_TYPES.has(marker.description ?? '')
}

async function importArtifactModule(code: string) {
  const url = URL.createObjectURL(
    new Blob([code], { type: 'text/javascript' }),
  )

  try {
    return await loadSharedModule<{ default?: unknown }>(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function unmountReact() {
  currentRoot?.unmount()
  currentRoot = null
}

export const renderReact: Renderer = async (payload, context) => {
  let code: string

  try {
    code = transpileReactSource(payload.content)
  } catch (exception) {
    const message = exception instanceof Error
      ? exception.message
      : String(exception)

    throw new ArtifactRenderError(`The React code could not be compiled: ${message}`)
  }

  const disallowedImports = await findDisallowedImports(code)

  if (disallowedImports.length > 0) {
    throw new ArtifactRenderError(describeDisallowedImports(disallowedImports))
  }

  const [artifactModule, react, reactDomClient] = await Promise.all([
    importArtifactModule(code),
    loadSharedModule<ReactModule>(REACT_SPECIFIER),
    loadSharedModule<ReactDomClientModule>(REACT_DOM_CLIENT_SPECIFIER),
  ])

  if (!context.isCurrent()) {
    return
  }

  if (!isComponent(artifactModule.default)) {
    throw new ArtifactRenderError(
      'The artifact must export a React component as its default export.',
    )
  }

  unmountReact()

  const container = document.createElement('div')

  context.root.replaceChildren(container)
  currentRoot = reactDomClient.createRoot(container, {
    onUncaughtError: (error: unknown) => {
      reportError(error)
    },
    onCaughtError: (error: unknown) => {
      reportError(error, { level: 'warning', showPanel: false })
    },
    onRecoverableError: (error: unknown) => {
      reportError(error, { level: 'warning', showPanel: false })
    },
  })
  currentRoot.render(react.createElement(artifactModule.default))
}
